import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const P8_PUBLIC_AUDIT_SCHEMA_VERSION = 2;
export const DEFAULT_INITIAL_LOAD_BUDGET_BYTES = 15 * 1024 * 1024;

const ENTRYPOINTS = [
  { name: "game", path: "index.html", manifestSource: "index.html" },
  { name: "candidate", path: "candidate.html", manifestSource: null },
];
const VITE_MANIFEST_PATHS = [".vite/manifest.json"];
const MANIFEST_ARRAY_FIELDS = ["css", "assets", "imports", "dynamicImports"];

function slashPath(value) {
  return value.split(sep).join("/");
}

function normalizeRelativePath(value) {
  return slashPath(normalize(value)).replace(/^\.\/+/, "");
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];

  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function withoutUrlSuffix(value) {
  return String(value).split(/[?#]/, 1)[0].trim();
}

function isLocalAssetReference(value) {
  const cleanValue = String(value ?? "").trim();
  return Boolean(cleanValue)
    && !cleanValue.startsWith("#")
    && !cleanValue.startsWith("data:")
    && !cleanValue.startsWith("blob:")
    && !cleanValue.startsWith("//")
    && !/^[a-z][a-z\d+.-]*:/i.test(cleanValue);
}

function resolveAssetReference(fromPath, reference) {
  const cleanReference = withoutUrlSuffix(reference);
  if (!isLocalAssetReference(cleanReference)) return null;

  const candidate = cleanReference.startsWith("/")
    ? cleanReference.slice(1)
    : join(dirname(fromPath), cleanReference);
  return normalizeRelativePath(candidate);
}

function extractSrcsetReferences(value) {
  const cleanValue = String(value).trim();
  if (!cleanValue) return [];

  const references = [];
  let cursor = 0;
  while (cursor < cleanValue.length) {
    while (cursor < cleanValue.length && /[\s,]/.test(cleanValue[cursor])) cursor++;
    if (cursor >= cleanValue.length) break;

    const remainder = cleanValue.slice(cursor);
    if (/^data:/i.test(remainder)) {
      const candidateSeparator = remainder.search(
        /,(?=\s*(?:\.\.?\/|\/|[A-Za-z0-9_.-]+(?:[?#][^\s,]*)?|[A-Za-z][A-Za-z\d+.-]*:|data:))/i,
      );
      if (candidateSeparator !== -1) {
        const dataReference = cleanValue.slice(cursor, cursor + candidateSeparator).trim();
        if (dataReference) references.push(dataReference);
        cursor += candidateSeparator + 1;
        continue;
      }

      const descriptorOffset = remainder.search(/\s/);
      const urlEnd = descriptorOffset === -1
        ? cleanValue.length
        : cursor + descriptorOffset;
      const dataReference = cleanValue.slice(cursor, urlEnd).trim();
      if (dataReference) references.push(dataReference);
      if (descriptorOffset === -1) break;
      const nextComma = cleanValue.indexOf(",", urlEnd);
      cursor = nextComma === -1 ? cleanValue.length : nextComma + 1;
      continue;
    }

    const nextComma = cleanValue.indexOf(",", cursor);
    const candidate = cleanValue.slice(
      cursor,
      nextComma === -1 ? cleanValue.length : nextComma,
    );
    const reference = candidate.trim().split(/\s+/)[0];
    if (reference) references.push(reference);
    cursor = nextComma === -1 ? cleanValue.length : nextComma + 1;
  }
  return references;
}

function extractHtmlAssetReferences(content) {
  const references = [];
  const pattern = /\b(src|href|poster|srcset|imagesrcset|xlink:href)\s*=\s*(["'])(.*?)\2/gi;
  for (const match of content.matchAll(pattern)) {
    const attribute = match[1].toLowerCase();
    const reference = match[3];
    if (attribute === "href" && [".", "./"].includes(withoutUrlSuffix(reference))) continue;
    if (attribute.endsWith("srcset")) {
      references.push(...extractSrcsetReferences(reference));
    } else {
      references.push(reference);
    }
  }
  return references;
}

function extractCssAssetReferences(content) {
  const references = [];
  const urlPattern = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
  for (const match of content.matchAll(urlPattern)) references.push(match[2]);
  const importPattern = /@import\s+(["'])(.*?)\1/gi;
  for (const match of content.matchAll(importPattern)) references.push(match[2]);
  return references;
}

function extractJavaScriptAssetReferences(content) {
  const references = [];
  const importPattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])(.*?)\1/g;
  for (const match of content.matchAll(importPattern)) references.push(match[2]);
  const urlPattern = /new\s+URL\(\s*(["'])(.*?)\1\s*,\s*import\.meta\.url\s*\)/g;
  for (const match of content.matchAll(urlPattern)) references.push(match[2]);
  return references;
}

function referencesForFile(relativePath, content) {
  const extension = extname(relativePath).toLowerCase();
  if (extension === ".html") return extractHtmlAssetReferences(content);
  if (extension === ".svg") {
    return [...extractHtmlAssetReferences(content), ...extractCssAssetReferences(content)];
  }
  if (extension === ".css") return extractCssAssetReferences(content);
  if ([".js", ".mjs", ".cjs"].includes(extension)) {
    return extractJavaScriptAssetReferences(content);
  }
  return [];
}

function createFileInfo(distDirectory, absolutePath) {
  const path = slashPath(relative(distDirectory, absolutePath));
  const content = readFileSync(absolutePath);
  return {
    path,
    bytes: content.byteLength,
    gzipBytes: gzipSync(content, { level: 9 }).byteLength,
  };
}

function resolveBundledImport(fromPath, reference, availablePaths) {
  const resolved = resolveAssetReference(fromPath, reference);
  if (!resolved) return null;
  const candidates = [
    resolved === "." ? "index.html" : resolved,
    resolved + ".js",
    resolved + ".mjs",
    resolved + ".css",
    resolved + ".json",
    resolved + "/index.js",
  ];
  return candidates.find((candidate) => availablePaths.has(candidate)) ?? null;
}

function addMissingReference(missingReferences, seen, from, reference) {
  const key = from + "\u0000" + reference;
  if (seen.has(key)) return;
  seen.add(key);
  missingReferences.push({ from, reference });
}

function collectReachableAssets(distDirectory, entryPath, availablePaths) {
  const reachable = new Set();
  const missingReferences = [];
  const missingKeys = new Set();
  const queue = [entryPath];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (!currentPath || reachable.has(currentPath)) continue;
    if (!availablePaths.has(currentPath)) {
      addMissingReference(missingReferences, missingKeys, entryPath, currentPath);
      continue;
    }
    reachable.add(currentPath);

    const absolutePath = join(distDirectory, currentPath);
    const content = readFileSync(absolutePath, "utf8");
    for (const reference of referencesForFile(currentPath, content)) {
      if (!isLocalAssetReference(reference)) continue;
      const resolved = resolveBundledImport(currentPath, reference, availablePaths);
      if (!resolved) {
        addMissingReference(missingReferences, missingKeys, currentPath, reference);
        continue;
      }
      queue.push(resolved);
    }
  }

  return { reachable, missingReferences };
}

function validateViteManifest(manifest, manifestPath, availablePaths) {
  const failures = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["Vite manifest is not an object: " + manifestPath];
  }

  const entries = Object.entries(manifest);
  if (entries.length === 0) failures.push("Vite manifest has no entries: " + manifestPath);

  for (const [key, entry] of entries) {
    const label = "Vite manifest entry " + key;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      failures.push(label + " is not an object");
      continue;
    }
    if (typeof entry.file !== "string" || entry.file.trim() === "") {
      failures.push(label + " must define file as a non-empty string");
    }

    const assetFields = {
      file: [entry.file],
      css: Array.isArray(entry.css) ? entry.css : [],
      assets: Array.isArray(entry.assets) ? entry.assets : [],
    };
    for (const [field, assetValues] of Object.entries(assetFields)) {
      for (const assetPath of assetValues) {
        if (typeof assetPath !== "string" || assetPath.trim() === "") continue;
        const normalizedPath = normalizeRelativePath(assetPath);
        if (availablePaths && !availablePaths.has(normalizedPath)) {
          failures.push(
            "missing Vite manifest asset: "
            + key + "." + field + " -> " + normalizedPath,
          );
        }
      }
    }

    for (const field of MANIFEST_ARRAY_FIELDS) {
      if (entry[field] === undefined) continue;
      if (
        !Array.isArray(entry[field])
        || entry[field].length === 0
        || !entry[field].every((value) => typeof value === "string" && value.trim() !== "")
      ) {
        failures.push(label + " must define " + field + " as a non-empty string array");
      }
    }
    if (entry.isEntry !== undefined && typeof entry.isEntry !== "boolean") {
      failures.push(label + " isEntry must be boolean");
    }
    if (entry.src !== undefined && (typeof entry.src !== "string" || entry.src.trim() === "")) {
      failures.push(label + " src must be a non-empty string");
    }
  }

  const hasIndexEntry = Object.prototype.hasOwnProperty.call(manifest, "index.html");
  if (!hasIndexEntry) {
    failures.push("Vite manifest missing required index.html entry");
  } else if (
    !manifest["index.html"]
    || typeof manifest["index.html"] !== "object"
    || Array.isArray(manifest["index.html"])
  ) {
    failures.push("Vite manifest index.html entry is not an object");
  } else if (manifest["index.html"].isEntry !== true) {
    failures.push("Vite manifest index.html entry must have isEntry=true");
  }

  for (const [key, entry] of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    for (const field of ["imports", "dynamicImports"]) {
      if (!Array.isArray(entry[field])) continue;
      for (const importedKey of entry[field]) {
        if (!Object.prototype.hasOwnProperty.call(manifest, importedKey)) {
          failures.push("Vite manifest import target missing: " + key + " -> " + importedKey);
        }
      }
    }
  }
  return [...new Set(failures)];
}

function readViteManifest(distDirectory, availablePaths) {
  const manifestPath = VITE_MANIFEST_PATHS[0];
  const absolutePath = join(distDirectory, manifestPath);
  if (!existsSync(absolutePath)) {
    return {
      path: null,
      manifest: null,
      failures: ["missing Vite manifest: " + manifestPath],
    };
  }
  try {
    const manifest = JSON.parse(readFileSync(absolutePath, "utf8"));
    return {
      path: manifestPath,
      manifest,
      failures: validateViteManifest(manifest, manifestPath, availablePaths),
    };
  } catch (error) {
    return {
      path: manifestPath,
      manifest: null,
      failures: ["invalid Vite manifest: " + manifestPath + " (" + error.message + ")"],
    };
  }
}

function findManifestEntry(manifest, sourcePath) {
  if (!manifest) return null;
  if (manifest[sourcePath]) return { key: sourcePath, entry: manifest[sourcePath] };
  for (const [key, entry] of Object.entries(manifest)) {
    if (entry && typeof entry === "object" && (entry.src === sourcePath || entry.file === sourcePath)) {
      return { key, entry };
    }
  }
  return null;
}

function collectManifestAssets(manifest, sourcePath, availablePaths) {
  const missingReferences = [];
  const missingKeys = new Set();
  const files = new Set();
  const found = findManifestEntry(manifest, sourcePath);
  if (!found) {
    addMissingReference(missingReferences, missingKeys, "Vite manifest", sourcePath);
    return { files, missingReferences };
  }

  const queue = [found];
  const visited = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.key)) continue;
    visited.add(current.key);

    const entry = current.entry;
    if (!entry || typeof entry !== "object") {
      addMissingReference(missingReferences, missingKeys, "Vite manifest", current.key);
      continue;
    }

    const assetPaths = [
      entry.file,
      ...(Array.isArray(entry.css) ? entry.css : []),
      ...(Array.isArray(entry.assets) ? entry.assets : []),
    ];
    for (const assetPath of assetPaths) {
      if (typeof assetPath !== "string" || !assetPath) continue;
      const normalizedPath = normalizeRelativePath(assetPath);
      files.add(normalizedPath);
      if (!availablePaths.has(normalizedPath)) {
        addMissingReference(missingReferences, missingKeys, "Vite manifest", normalizedPath);
      }
    }

    for (const importedKey of [
      ...(Array.isArray(entry.imports) ? entry.imports : []),
      ...(Array.isArray(entry.dynamicImports) ? entry.dynamicImports : []),
    ]) {
      const imported = manifest[importedKey];
      if (!imported) {
        addMissingReference(missingReferences, missingKeys, "Vite manifest import", importedKey);
      } else {
        queue.push({ key: importedKey, entry: imported });
      }
    }
  }

  return { files, missingReferences };
}

export function collectBuildAudit({
  distDirectory,
  budgetBytes = DEFAULT_INITIAL_LOAD_BUDGET_BYTES,
} = {}) {
  const absoluteDistDirectory = resolve(distDirectory);
  const absoluteFiles = walkFiles(absoluteDistDirectory);
  const fileInfos = absoluteFiles.map((file) => createFileInfo(absoluteDistDirectory, file));
  const infoByPath = new Map(fileInfos.map((info) => [info.path, info]));
  const availablePaths = new Set(infoByPath.keys());
  const manifestInfo = readViteManifest(absoluteDistDirectory, availablePaths);
  const entrypoints = ENTRYPOINTS.map((entrypoint) => {
    const manualClosure = collectReachableAssets(
      absoluteDistDirectory,
      entrypoint.path,
      availablePaths,
    );
    const manifestClosure = entrypoint.manifestSource && manifestInfo.manifest
      ? collectManifestAssets(manifestInfo.manifest, entrypoint.manifestSource, availablePaths)
      : { files: new Set(), missingReferences: [] };
    const paths = new Set([...manualClosure.reachable, ...manifestClosure.files]);
    const files = [...paths].map((path) => infoByPath.get(path)).filter(Boolean);
    const missingReferences = [
      ...manualClosure.missingReferences,
      ...manifestClosure.missingReferences,
    ];
    const gzipBytes = files.reduce((total, file) => total + file.gzipBytes, 0);
    return {
      name: entrypoint.name,
      path: entrypoint.path,
      exists: availablePaths.has(entrypoint.path),
      assetSource: entrypoint.manifestSource ? "vite-manifest+static-reference-check" : "static-reference-check",
      files,
      bytes: files.reduce((total, file) => total + file.bytes, 0),
      gzipBytes,
      budgetBytes,
      withinBudget: gzipBytes <= budgetBytes,
      missingReferences,
    };
  });

  const totalBytes = fileInfos.reduce((total, file) => total + file.bytes, 0);
  const totalGzipBytes = fileInfos.reduce((total, file) => total + file.gzipBytes, 0);
  const failures = [...manifestInfo.failures];
  if (fileInfos.length === 0) failures.push("dist is empty or missing");
  for (const entrypoint of entrypoints) {
    if (!entrypoint.exists) failures.push("missing entrypoint: " + entrypoint.path);
    if (!entrypoint.withinBudget) {
      failures.push(
        "entrypoint " + entrypoint.path + " is " + entrypoint.gzipBytes
        + " bytes gzip, above the " + budgetBytes + "-byte budget",
      );
    }
    for (const missing of entrypoint.missingReferences) {
      if (missing.from === "Vite manifest" || missing.from === "Vite manifest import") {
        failures.push("missing Vite manifest asset: " + missing.from + " -> " + missing.reference);
      } else {
        failures.push("missing local asset: " + missing.from + " -> " + missing.reference);
      }
    }
  }

  return {
    budgetBytes,
    manifest: {
      path: manifestInfo.path,
      valid: Boolean(manifestInfo.manifest) && manifestInfo.failures.length === 0,
      failures: manifestInfo.failures,
    },
    fileCount: fileInfos.length,
    totalBytes,
    totalGzipBytes,
    files: fileInfos.sort((first, second) => first.path.localeCompare(second.path)),
    entrypoints,
    failures,
  };
}

function normalizeLicense(value) {
  if (typeof value === "string" && value.trim()) {
    const license = value.trim();
    if (/^(unknown|undefined|null|n\/a|not specified)$/i.test(license)) return "UNKNOWN";
    return license;
  }
  if (Array.isArray(value)) {
    const licenses = value.map(normalizeLicense).filter(Boolean);
    return licenses.length > 0 ? licenses.join(" OR ") : "UNKNOWN";
  }
  if (value && typeof value === "object") {
    return normalizeLicense(value.type ?? value.name ?? value.value);
  }
  return "UNKNOWN";
}

export { normalizeLicense };

function isUnknownLicense(value) {
  if (!value || typeof value !== "string") return true;
  return /(?:^|[^A-Za-z0-9-])(?:unknown|undefined|null|n\/a|not\s+specified|noassertion)(?=$|[^A-Za-z0-9-])/i.test(
    value.trim(),
  );
}

function repositoryValue(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.url ?? value.directory ?? null;
  return null;
}

function readPackageJson(packagePath) {
  if (!packagePath) return { manifest: null, error: "package path is unresolved" };
  const manifestPath = join(packagePath, "package.json");
  if (!existsSync(manifestPath)) {
    return { manifest: null, error: "package.json is missing" };
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      return { manifest: null, error: "package.json is not an object" };
    }
    return { manifest, error: null };
  } catch (error) {
    return { manifest: null, error: "package.json is invalid: " + error.message };
  }
}

function readCommandOutput(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.toString === "function") return value.toString();
  return "";
}

function parseJsonOutput(output) {
  if (!output.trim()) return { value: null, error: "npm ls returned no JSON output" };
  try {
    return { value: JSON.parse(output), error: null };
  } catch (error) {
    return { value: null, error: "npm ls returned invalid JSON: " + error.message };
  }
}

export function runNpmLs(rootDirectory) {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    stdout = execFileSync("npm", ["ls", "--all", "--json", "--include=dev"], {
      cwd: rootDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    stdout = readCommandOutput(error?.stdout);
    stderr = readCommandOutput(error?.stderr);
    exitCode = Number.isInteger(error?.status) ? error.status : 1;
  }

  const parsed = parseJsonOutput(stdout);
  return {
    tree: parsed.value,
    exitCode,
    stderr,
    parseError: parsed.error,
    problems: Array.isArray(parsed.value?.problems) ? parsed.value.problems : [],
  };
}

function resolveInstalledPackagePath(root, parentPath, name) {
  if (!name) return null;
  let current = resolve(parentPath ?? root);
  while (true) {
    const candidate = join(current, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isUninstalledOptionalNode(parentPath, dependencyName) {
  const parentManifest = readPackageJson(parentPath).manifest;
  if (!parentManifest || !dependencyName) return false;
  if (Object.prototype.hasOwnProperty.call(parentManifest.optionalDependencies ?? {}, dependencyName)) {
    return true;
  }
  return parentManifest.peerDependenciesMeta?.[dependencyName]?.optional === true;
}

function dependencyNames(manifest, field) {
  const value = manifest?.[field];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value);
}

function isOptionalDeclaredDependency(manifest, dependencyName) {
  const optionalDependencies = manifest?.optionalDependencies;
  if (
    optionalDependencies
    && typeof optionalDependencies === "object"
    && !Array.isArray(optionalDependencies)
    && Object.prototype.hasOwnProperty.call(optionalDependencies, dependencyName)
  ) {
    return true;
  }
  const peerMeta = manifest?.peerDependenciesMeta?.[dependencyName];
  return peerMeta?.optional === true;
}

function requiredDependencyNames(manifest) {
  const names = [
    ...dependencyNames(manifest, "dependencies"),
    ...dependencyNames(manifest, "peerDependencies"),
  ];
  return [...new Set(names)].filter(
    (dependencyName) => !isOptionalDeclaredDependency(manifest, dependencyName),
  );
}

function optionalDependencyNames(manifest) {
  const optionalPeers = dependencyNames(manifest, "peerDependencies").filter(
    (dependencyName) => manifest?.peerDependenciesMeta?.[dependencyName]?.optional === true,
  );
  return [...new Set([
    ...dependencyNames(manifest, "optionalDependencies"),
    ...optionalPeers,
  ])];
}

function resolveIndexedDependency({ root, node, nodeIndex, dependencyName }) {
  const installedPath = resolveInstalledPackagePath(root, node?.path ?? root, dependencyName);
  if (!installedPath) {
    return { installedPath: null, present: false };
  }
  const indexedNode = nodeIndex?.get(resolve(installedPath));
  const packageInfo = readPackageJson(installedPath);
  return {
    installedPath,
    present: Boolean(
      indexedNode
      && indexedNode.name === dependencyName
      && !packageInfo.error
      && packageInfo.manifest?.name === dependencyName,
    ),
  };
}

function validateRequiredDependencyEdges({
  root,
  manifest,
  node,
  nodeIndex,
  packageLabel,
  failures,
}) {
  for (const dependencyName of optionalDependencyNames(manifest)) {
    const resolved = resolveIndexedDependency({ root, node, nodeIndex, dependencyName });
    if (resolved.installedPath && !resolved.present) {
      failures.push(
        "optional dependency is missing from npm ls: "
        + packageLabel + " -> " + dependencyName,
      );
    }
  }

  const requiredNames = requiredDependencyNames(manifest);
  if (requiredNames.length === 0) return;

  const dependencyMap = node?.dependencies;
  if (dependencyMap === undefined || dependencyMap === null) {
    for (const dependencyName of requiredNames) {
      const resolved = resolveIndexedDependency({ root, node, nodeIndex, dependencyName });
      if (!resolved.present) {
        failures.push(
          "required dependency is missing from npm ls: "
          + packageLabel + " -> " + dependencyName,
        );
      }
    }
    return;
  }
  if (typeof dependencyMap !== "object" || Array.isArray(dependencyMap)) {
    failures.push("invalid dependency map for " + packageLabel);
    return;
  }

  for (const dependencyName of requiredNames) {
    const resolved = resolveIndexedDependency({ root, node, nodeIndex, dependencyName });
    if (!resolved.present) {
      failures.push(
        "required dependency is missing from npm ls: "
        + packageLabel + " -> " + dependencyName,
      );
    }
  }
}

function collectDependencyNodes(
  node,
  { root, nodes, failures, visited },
  parentPath,
  dependencyName,
) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    failures.push("invalid dependency node: " + (dependencyName ?? "root"));
    return;
  }

  if (Array.isArray(node.problems)) {
    failures.push(...node.problems.map((problem) => "npm ls problem: " + problem));
  }

  const nodePath = typeof node.path === "string" && node.path
    ? resolve(node.path)
    : dependencyName
      ? resolveInstalledPackagePath(root, parentPath, dependencyName)
      : root;
  const name = typeof node.name === "string" && node.name ? node.name : dependencyName ?? null;
  const version = typeof node.version === "string" && node.version ? node.version : null;
  const key = String(nodePath) + ":" + String(name) + ":" + String(version);
  const firstVisit = !visited.has(key);
  if (firstVisit) visited.add(key);

  if (!nodePath) {
    if (isUninstalledOptionalNode(parentPath, dependencyName)) return;
    failures.push("unresolved installed package path: " + (name ?? dependencyName ?? "unknown"));
    return;
  }

  const record = { ...node, name, version, path: nodePath };
  if (firstVisit && nodePath !== root) nodes.push(record);

  if (node.dependencies !== undefined && (
    !node.dependencies || typeof node.dependencies !== "object" || Array.isArray(node.dependencies)
  )) {
    failures.push("invalid dependency map: " + (name ?? dependencyName ?? "unknown"));
  }

  for (const [childName, child] of Object.entries(node.dependencies ?? {})) {
    collectDependencyNodes(
      child,
      { root, nodes, failures, visited },
      nodePath ?? parentPath ?? root,
      childName,
    );
  }
}

export function collectDependencyLicenses({
  rootDirectory,
  dependencyTree,
  npmLsResult,
} = {}) {
  const root = resolve(rootDirectory ?? process.cwd());
  const rootInfo = readPackageJson(root);
  const rootManifest = rootInfo.manifest ?? {};
  const failures = [];
  if (rootInfo.error) failures.push("root package manifest: " + rootInfo.error);

  const npmResult = npmLsResult ?? (dependencyTree ? null : runNpmLs(root));
  const tree = dependencyTree ?? npmResult?.tree;
  if (npmResult) {
    if (npmResult.exitCode !== 0) failures.push("npm ls exited with code " + npmResult.exitCode);
    if (npmResult.parseError) failures.push(npmResult.parseError);
    if (npmResult.problems?.length > 0) {
      failures.push(...npmResult.problems.map((problem) => "npm ls problem: " + problem));
    }
  }
  if (!tree || typeof tree !== "object" || Array.isArray(tree)) {
    failures.push("npm ls dependency tree is missing or invalid");
  }

  const directDefinitions = new Map();
  for (const [name] of Object.entries(rootManifest.dependencies ?? {})) {
    directDefinitions.set(name, "runtime-direct");
  }
  for (const [name] of Object.entries(rootManifest.optionalDependencies ?? {})) {
    directDefinitions.set(name, "runtime-optional-direct");
  }
  for (const [name] of Object.entries(rootManifest.devDependencies ?? {})) {
    directDefinitions.set(name, "development-direct");
  }

  const directPaths = new Map();
  for (const [name, scope] of directDefinitions) {
    const declaredNode = tree?.dependencies?.[name];
    if (!declaredNode) {
      if (isOptionalDeclaredDependency(rootManifest, name)) {
        const installedPath = resolveInstalledPackagePath(root, root, name);
        if (installedPath) {
          failures.push("optional dependency is missing from npm ls: " + name);
        }
        continue;
      }
      failures.push("declared dependency is missing from npm ls: " + name);
      continue;
    }
    const installedPath = resolveInstalledPackagePath(root, root, name);
    if (!installedPath) {
      if (isOptionalDeclaredDependency(rootManifest, name)) continue;
      failures.push("declared dependency manifest is unresolved: " + name);
      continue;
    }
    directPaths.set(installedPath, { name, scope });
  }

  const nodes = [];
  if (tree && typeof tree === "object" && !Array.isArray(tree)) {
    collectDependencyNodes(tree, { root, nodes, failures, visited: new Set() }, root);
  }
  const nodeIndex = new Map(nodes.map((node) => [resolve(node.path), node]));

  if (tree && typeof tree === "object" && !Array.isArray(tree)) {
    validateRequiredDependencyEdges({
      root,
      manifest: rootManifest,
      node: tree,
      nodeIndex,
      packageLabel: rootManifest.name ?? "root",
      failures,
    });
  }

  const packages = [];
  const packageKeys = new Set();
  const unknownLicenses = [];
  for (const node of nodes) {
    const packageInfo = readPackageJson(node.path);
    if (packageInfo.error) {
      failures.push(
        "dependency manifest for " + (node.name ?? "unknown") + " is invalid: " + packageInfo.error,
      );
      continue;
    }

    const manifest = packageInfo.manifest;
    if (node.name && manifest.name !== node.name) {
      failures.push(
        "dependency manifest name mismatch at " + node.path + ": npm ls=" + node.name + ", manifest=" + manifest.name,
      );
    }
    if (node.version && manifest.version !== node.version) {
      failures.push(
        "dependency manifest version mismatch at " + node.path + ": npm ls=" + node.version + ", manifest=" + manifest.version,
      );
    }

    const name = manifest.name ?? node.name;
    const version = manifest.version ?? node.version ?? "UNKNOWN";
    validateRequiredDependencyEdges({
      root,
      manifest,
      node,
      nodeIndex,
      packageLabel: name + "@" + version,
      failures,
    });
    const license = normalizeLicense(manifest.license ?? manifest.licenses);
    const packageKey = name + "@" + version + "@" + String(node.path);
    if (!packageKeys.has(packageKey)) {
      packageKeys.add(packageKey);
      const direct = directPaths.get(node.path);
      packages.push({
        name,
        version,
        path: node.path,
        scope: direct?.scope ?? "transitive",
        license,
        repository: repositoryValue(manifest.repository),
        homepage: manifest.homepage ?? null,
      });
      if (isUnknownLicense(license)) unknownLicenses.push(name + "@" + version);
    }
  }

  const entries = packages.sort((first, second) =>
    (first.name + "@" + first.version + first.path).localeCompare(
      second.name + "@" + second.version + second.path,
    ),
  );
  return {
    packageCount: entries.length,
    unknownLicenses: [...new Set(unknownLicenses)].sort(),
    packages: entries,
    failures,
    npmLs: npmResult
      ? {
          exitCode: npmResult.exitCode,
          parseError: npmResult.parseError,
          problemCount: npmResult.problems?.length ?? 0,
        }
      : null,
  };
}

function bytesInMegabytes(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(3));
}

export function renderMarkdown(report) {
  const build = report.build ?? {};
  const dependencies = report.dependencies ?? {};
  const sourceHeadSha = report.sourceHeadSha ?? report.commit ?? "ローカル実行";
  const testedMergeSha = report.testedMergeSha ?? report.commit ?? "ローカル実行";
  const lines = [
    "# P8公開前監査レポート",
    "",
    "- スキーマ: " + (report.schemaVersion ?? P8_PUBLIC_AUDIT_SCHEMA_VERSION),
    "- source head SHA: " + sourceHeadSha,
    "- tested merge SHA: " + testedMergeSha,
    "- Node.js: " + (report.environment?.node ?? "unknown"),
    "- npm: " + (report.environment?.npm ?? "unknown"),
    "",
    "## 公開ビルド",
    "",
    "- Vite manifest: " + (build.manifest?.path ?? "なし"),
    "- dist全体（参考）: " + (build.totalBytes ?? 0) + " bytes（" + bytesInMegabytes(build.totalBytes ?? 0) + " MiB）",
    "- dist全体gzip（参考）: " + (build.totalGzipBytes ?? 0) + " bytes（" + bytesInMegabytes(build.totalGzipBytes ?? 0) + " MiB）",
    "",
    "| 入口 | 資産の根拠 | 対象ファイル数 | gzip換算 | 上限 | 判定 | 欠落参照 |",
    "|---|---|---:|---:|---:|---|---:|",
  ];
  for (const entrypoint of build.entrypoints ?? []) {
    lines.push(
      "| " + entrypoint.path
      + " | " + entrypoint.assetSource
      + " | " + entrypoint.files.length
      + " | " + entrypoint.gzipBytes
      + " | " + entrypoint.budgetBytes
      + " | " + (entrypoint.withinBudget ? "within budget" : "over budget")
      + " | " + entrypoint.missingReferences.length + " |",
    );
  }
  lines.push(
    "",
    "## 依存パッケージの権利",
    "",
    "- npm ls終了コード: " + (dependencies.npmLs?.exitCode ?? "注入データまたは未実行"),
    "- npm ls問題数: " + (dependencies.npmLs?.problemCount ?? 0),
    "- パッケージ数: " + (dependencies.packageCount ?? 0),
    "- UNKNOWNライセンス: " + (dependencies.unknownLicenses?.length ?? 0),
    "",
    "| パッケージ | 版 | 区分 | ライセンス |",
    "|---|---:|---|---|",
  );
  for (const dependency of dependencies.packages ?? []) {
    lines.push(
      "| " + dependency.name + " | " + dependency.version + " | "
      + dependency.scope + " | " + dependency.license + " |",
    );
  }
  lines.push("", "## 判定", "");
  lines.push(
    report.failures?.length === 0
      ? "自動監査は成功しました。実機確認、画像、映像、公開承認は別途必要です。"
      : "自動監査は失敗しました。",
    "",
  );
  const allFailures = [
    ...(dependencies.failures ?? []),
    ...(report.failures ?? []).filter((failure) => !dependencies.failures?.includes(failure)),
  ];
  if (allFailures.length > 0) lines.push(...allFailures.map((failure) => "- " + failure), "");
  return lines.join("\n");
}

export function createReport({ rootDirectory = process.cwd(), outputDirectory } = {}) {
  const root = resolve(rootDirectory);
  const build = collectBuildAudit({ distDirectory: join(root, "dist") });
  const dependencies = collectDependencyLicenses({ rootDirectory: root });
  const npmVersion = (() => {
    try {
      return execFileSync("npm", ["--version"], { cwd: root, encoding: "utf8" }).trim();
    } catch {
      return "unknown";
    }
  })();
  const testedMergeSha = process.env.P8_TESTED_MERGE_SHA ?? process.env.GITHUB_SHA ?? null;
  const sourceHeadSha = process.env.P8_SOURCE_HEAD_SHA
    ?? process.env.GITHUB_HEAD_SHA
    ?? testedMergeSha;
  const failures = [...build.failures, ...dependencies.failures];
  if (dependencies.unknownLicenses.length > 0) {
    failures.push("unknown license metadata: " + dependencies.unknownLicenses.join(", "));
  }
  return {
    schemaVersion: P8_PUBLIC_AUDIT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repository: process.env.GITHUB_REPOSITORY ?? null,
    sourceHeadSha,
    testedMergeSha,
    commit: testedMergeSha,
    environment: {
      node: process.version,
      npm: npmVersion,
      event: process.env.GITHUB_EVENT_NAME ?? null,
    },
    build,
    dependencies,
    failures,
    outputDirectory: outputDirectory ?? join(root, "artifacts", "p8-public-audit"),
  };
}

export function writeReport(report) {
  const outputDirectory = resolve(report.outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(outputDirectory, "report.md"), renderMarkdown(report));
}

export function main() {
  const report = createReport();
  writeReport(report);
  if (report.failures.length > 0) {
    console.error(renderMarkdown(report));
    process.exitCode = 1;
    return;
  }
  console.log(renderMarkdown(report));
}

const invokedFile = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedFile && pathToFileURL(invokedFile).href === import.meta.url) main();
