import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const P8_PUBLIC_AUDIT_SCHEMA_VERSION = 1;
export const DEFAULT_INITIAL_LOAD_BUDGET_BYTES = 15 * 1024 * 1024;

const ENTRYPOINTS = [
  { name: "game", path: "index.html" },
  { name: "candidate", path: "candidate.html" },
];

function slashPath(value) {
  return value.split(sep).join("/");
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
  return value.split(/[?#]/, 1)[0];
}

function isLocalAssetReference(value) {
  return value
    && !value.startsWith("data:")
    && !value.startsWith("blob:")
    && !/^[a-z][a-z\d+.-]*:/i.test(value);
}

function resolveAssetReference(fromPath, reference) {
  const cleanReference = withoutUrlSuffix(reference);
  if (!isLocalAssetReference(cleanReference) || !cleanReference) return null;

  const fromDirectory = dirname(fromPath);
  const candidate = cleanReference.startsWith("/")
    ? cleanReference.slice(1)
    : join(fromDirectory, cleanReference);
  return slashPath(candidate).replace(/^\.\//, "");
}

function extractHtmlAssetReferences(content) {
  const references = [];
  const pattern = /<(?:script|link|img|source|video|audio)\b[^>]*?(?:src|href)=["']([^"']+)["']/gi;
  for (const match of content.matchAll(pattern)) references.push(match[1]);
  return references;
}

function extractCssAssetReferences(content) {
  const references = [];
  const pattern = /url\(\s*["']?([^\)"']+?)["']?\s*\)/gi;
  for (const match of content.matchAll(pattern)) references.push(match[1]);
  return references;
}

function extractJavaScriptAssetReferences(content) {
  const references = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g;
  for (const match of content.matchAll(pattern)) references.push(match[1]);
  return references;
}

function referencesForFile(relativePath, content) {
  const extension = extname(relativePath).toLowerCase();
  if (extension === ".html") return extractHtmlAssetReferences(content);
  if (extension === ".css") return extractCssAssetReferences(content);
  if (extension === ".js" || extension === ".mjs") return extractJavaScriptAssetReferences(content);
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
    resolved,
    resolved + ".js",
    resolved + ".mjs",
    resolved + "/index.js",
  ];
  return candidates.find((candidate) => availablePaths.has(candidate)) ?? null;
}

function collectReachableAssets(distDirectory, entryPath, availablePaths) {
  const reachable = new Set();
  const missingReferences = [];
  const queue = [entryPath];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (!currentPath || reachable.has(currentPath)) continue;
    reachable.add(currentPath);

    const absolutePath = join(distDirectory, currentPath);
    if (!existsSync(absolutePath)) {
      missingReferences.push({ from: entryPath, reference: currentPath });
      continue;
    }

    const content = readFileSync(absolutePath, "utf8");
    for (const reference of referencesForFile(currentPath, content)) {
      const resolved = resolveBundledImport(currentPath, reference, availablePaths);
      if (!resolved) {
        if (isLocalAssetReference(reference) && !withoutUrlSuffix(reference).startsWith("#")) {
          missingReferences.push({ from: currentPath, reference });
        }
        continue;
      }
      queue.push(resolved);
    }
  }

  return { reachable, missingReferences };
}

export function collectBuildAudit({ distDirectory, budgetBytes = DEFAULT_INITIAL_LOAD_BUDGET_BYTES }) {
  const absoluteDistDirectory = resolve(distDirectory);
  const absoluteFiles = walkFiles(absoluteDistDirectory);
  const fileInfos = absoluteFiles.map((file) => createFileInfo(absoluteDistDirectory, file));
  const infoByPath = new Map(fileInfos.map((info) => [info.path, info]));
  const availablePaths = new Set(infoByPath.keys());

  const entrypoints = ENTRYPOINTS.map((entrypoint) => {
    const closure = collectReachableAssets(absoluteDistDirectory, entrypoint.path, availablePaths);
    const files = [...closure.reachable]
      .map((path) => infoByPath.get(path))
      .filter(Boolean);
    return {
      ...entrypoint,
      exists: availablePaths.has(entrypoint.path),
      files,
      bytes: files.reduce((total, file) => total + file.bytes, 0),
      gzipBytes: files.reduce((total, file) => total + file.gzipBytes, 0),
      missingReferences: closure.missingReferences,
    };
  });

  const totalBytes = fileInfos.reduce((total, file) => total + file.bytes, 0);
  const totalGzipBytes = fileInfos.reduce((total, file) => total + file.gzipBytes, 0);
  const failures = [];
  if (fileInfos.length === 0) failures.push("dist is empty or missing");
  if (totalGzipBytes > budgetBytes) {
    failures.push("compressed build is " + totalGzipBytes + " bytes, above the " + budgetBytes + "-byte budget");
  }
  for (const entrypoint of entrypoints) {
    if (!entrypoint.exists) failures.push("missing entrypoint: " + entrypoint.path);
    for (const missing of entrypoint.missingReferences) {
      failures.push("missing local asset: " + missing.from + " -> " + missing.reference);
    }
  }

  return {
    budgetBytes,
    fileCount: fileInfos.length,
    totalBytes,
    totalGzipBytes,
    files: fileInfos.sort((first, second) => first.path.localeCompare(second.path)),
    entrypoints,
    failures,
  };
}

function normalizeLicense(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    return value.map(normalizeLicense).filter(Boolean).join(" OR ") || "UNKNOWN";
  }
  if (value && typeof value === "object") {
    return normalizeLicense(value.type ?? value.name ?? value.value);
  }
  return "UNKNOWN";
}

export { normalizeLicense };

function repositoryValue(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.url ?? value.directory ?? null;
  return null;
}

function readPackageJson(packagePath) {
  const manifestPath = join(packagePath, "package.json");
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function runNpmLs(rootDirectory) {
  try {
    return JSON.parse(execFileSync("npm", ["ls", "--all", "--json", "--include=dev"], {
      cwd: rootDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }));
  } catch (error) {
    const output = error?.stdout?.toString?.() ?? "";
    if (!output) throw error;
    return JSON.parse(output);
  }
}

function resolveInstalledPackagePath(root, parentPath, name) {
  let current = resolve(parentPath ?? root);
  while (true) {
    const candidate = join(current, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function collectDependencyNodes(node, nodes, visited, root, parentPath, dependencyName) {
  if (!node || typeof node !== "object") return;
  const nodePath = node.path
    ? resolve(node.path)
    : dependencyName
      ? resolveInstalledPackagePath(root, parentPath, dependencyName)
      : resolve(parentPath ?? root);
  const key = (nodePath ?? "") + ":" + (node.name ?? dependencyName ?? "") + ":" + (node.version ?? "");
  if (visited.has(key)) return;
  visited.add(key);
  if (nodePath && nodePath !== root) nodes.push({ ...node, name: node.name ?? dependencyName, path: nodePath });
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    collectDependencyNodes(child, nodes, visited, root, nodePath ?? parentPath ?? root, name);
  }
}

export function collectDependencyLicenses({ rootDirectory, dependencyTree } = {}) {
  const root = resolve(rootDirectory ?? process.cwd());
  const rootManifest = readPackageJson(root) ?? {};
  const tree = dependencyTree ?? runNpmLs(root);
  const nodes = [];
  collectDependencyNodes(tree, nodes, new Set(), root, root);
  const packages = new Map();

  for (const node of nodes) {
    const manifest = readPackageJson(node.path) ?? {};
    const name = manifest.name ?? node.name;
    const version = manifest.version ?? node.version ?? "UNKNOWN";
    const key = name + "@" + version;
    if (packages.has(key)) continue;
    const scope = rootManifest.dependencies?.[name]
      ? "runtime-direct"
      : rootManifest.devDependencies?.[name]
        ? "development-direct"
        : "transitive";
    packages.set(key, {
      name,
      version,
      scope,
      license: normalizeLicense(manifest.license ?? manifest.licenses),
      repository: repositoryValue(manifest.repository),
      homepage: manifest.homepage ?? null,
    });
  }

  const entries = [...packages.values()].sort((first, second) =>
    (first.name + "@" + first.version).localeCompare(second.name + "@" + second.version),
  );
  return {
    packageCount: entries.length,
    unknownLicenses: entries.filter((entry) => entry.license === "UNKNOWN").map((entry) => entry.name),
    packages: entries,
  };
}

function bytesInMegabytes(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(3));
}

export function renderMarkdown(report) {
  const lines = [
    "# P8公開前監査レポート",
    "",
    "- スキーマ: " + report.schemaVersion,
    "- コミット: " + (report.commit ?? "ローカル実行"),
    "- Node.js: " + report.environment.node,
    "- npm: " + report.environment.npm,
    "",
    "## 公開ビルド",
    "",
    "- ファイル数: " + report.build.fileCount,
    "- 展開後: " + report.build.totalBytes + " bytes（" + bytesInMegabytes(report.build.totalBytes) + " MiB）",
    "- gzip換算: " + report.build.totalGzipBytes + " bytes（" + bytesInMegabytes(report.build.totalGzipBytes) + " MiB）",
    "- 上限: " + report.build.budgetBytes + " bytes（gzip換算）",
    "",
    "| 入口 | 対象ファイル数 | 展開後 | gzip換算 | 欠落参照 |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const entrypoint of report.build.entrypoints) {
    lines.push(
      "| " + entrypoint.path + " | " + entrypoint.files.length + " | " + entrypoint.bytes + " | " + entrypoint.gzipBytes + " | " + entrypoint.missingReferences.length + " |",
    );
  }
  lines.push(
    "",
    "## 依存パッケージの権利",
    "",
    "- パッケージ数: " + report.dependencies.packageCount,
    "- UNKNOWNライセンス: " + report.dependencies.unknownLicenses.length,
    "",
    "| パッケージ | 版 | 区分 | ライセンス |",
    "|---|---:|---|---|",
  );
  for (const dependency of report.dependencies.packages) {
    lines.push("| " + dependency.name + " | " + dependency.version + " | " + dependency.scope + " | " + dependency.license + " |");
  }
  lines.push(
    "",
    "## 判定",
    "",
    report.failures.length === 0
      ? "自動監査は成功しました。実機確認、画像、映像、公開承認は別途必要です。"
      : "自動監査は失敗しました。",
    "",
  );
  if (report.failures.length > 0) {
    lines.push(...report.failures.map((failure) => "- " + failure), "");
  }
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
  const failures = [...build.failures];
  if (dependencies.unknownLicenses.length > 0) {
    failures.push("unknown license metadata: " + dependencies.unknownLicenses.join(", "));
  }
  return {
    schemaVersion: P8_PUBLIC_AUDIT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repository: process.env.GITHUB_REPOSITORY ?? null,
    commit: process.env.GITHUB_SHA ?? null,
    environment: { node: process.version, npm: npmVersion },
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
