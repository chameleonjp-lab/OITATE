import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  collectBuildAudit,
  collectDependencyLicenses,
  normalizeLicense,
  renderMarkdown,
} from "./audit-public-build.mjs";

function writeManifest(dist, manifest) {
  mkdirSync(join(dist, ".vite"), { recursive: true });
  writeFileSync(join(dist, ".vite", "manifest.json"), JSON.stringify(manifest));
}

test("uses the Vite manifest and checks expanded static asset references", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-audit-"));
  const dist = join(root, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  mkdirSync(join(dist, "media"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<script type=\"module\" src=\"/assets/main.js\"></script>");
  writeFileSync(
    join(dist, "candidate.html"),
    "<link rel=\"stylesheet\" href=\"./assets/candidate.css\"><img srcset=\"./media/hero.svg 1x, ./media/hero.svg 2x\" poster=\"./media/hero.svg\">",
  );
  writeFileSync(join(dist, "assets", "main.js"), "import \"./main.css\";");
  writeFileSync(join(dist, "assets", "main.css"), "body{background:url(\"../media/hero.svg\")}");
  writeFileSync(join(dist, "assets", "candidate.css"), "@import \"./tokens.css\";");
  writeFileSync(join(dist, "assets", "tokens.css"), "body{color:black}");
  writeFileSync(join(dist, "media", "hero.svg"), "<svg><image href=\"./icon.svg\" /></svg>");
  writeFileSync(join(dist, "media", "icon.svg"), "<svg></svg>");
  writeManifest(dist, {
    "index.html": {
      src: "index.html",
      file: "assets/main.js",
      isEntry: true,
      css: ["assets/main.css"],
    },
  });

  const report = collectBuildAudit({ distDirectory: dist });
  assert.deepEqual(report.failures, []);
  assert.equal(report.manifest.valid, true);
  assert.equal(
    report.entrypoints[0].assetSource,
    "vite-manifest+static-reference-check",
  );
  assert.equal(report.entrypoints[1].files.some((file) => file.path === "assets/tokens.css"), true);
  assert.equal(report.entrypoints[1].files.some((file) => file.path === "media/icon.svg"), true);
  assert.equal(report.entrypoints[0].withinBudget, true);
  assert.ok(report.totalGzipBytes > 0);
});

test("fails on missing srcset, CSS import, poster, and SVG references", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-audit-"));
  const dist = join(root, "dist");
  mkdirSync(join(dist, ".vite"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<script src=\"/assets/missing.js\"></script>");
  writeFileSync(
    join(dist, "candidate.html"),
    "<link rel=\"stylesheet\" href=\"./assets/candidate.css\"><img src=\"./media/bad.svg\"><video poster=\"./media/missing-poster.png\"></video><img srcset=\"./media/missing-small.png 1x, ./media/missing-large.png 2x\">",
  );
  writeFileSync(join(dist, ".vite", "manifest.json"), JSON.stringify({
    "index.html": { src: "index.html", file: "assets/missing.js", isEntry: true },
  }));
  mkdirSync(join(dist, "assets"), { recursive: true });
  mkdirSync(join(dist, "media"), { recursive: true });
  writeFileSync(join(dist, "assets", "candidate.css"), "@import \"./missing.css\";");
  writeFileSync(join(dist, "media", "bad.svg"), "<svg><image href=\"./missing-icon.svg\" /></svg>");
  const report = collectBuildAudit({ distDirectory: dist });
  assert.equal(report.failures.some((failure) => failure.includes("missing local asset")), true);
  assert.equal(report.failures.some((failure) => failure.includes("missing Vite manifest asset")), true);
});

test("classifies direct and transitive packages with complete manifests", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  const runtimePath = join(root, "node_modules", "runtime");
  const transitivePath = join(runtimePath, "node_modules", "transitive");
  mkdirSync(transitivePath, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { runtime: "1.0.0" } }));
  writeFileSync(join(runtimePath, "package.json"), JSON.stringify({
    name: "runtime",
    version: "1.0.0",
    license: "MIT",
    optionalDependencies: { "runtime-linux-x64": "1.0.0" },
  }));
  writeFileSync(join(transitivePath, "package.json"), JSON.stringify({ name: "transitive", version: "2.0.0", licenses: [{ type: "Apache-2.0" }] }));

  const report = collectDependencyLicenses({
    rootDirectory: root,
    dependencyTree: {
      path: root,
      dependencies: {
        runtime: {
          name: "runtime",
          version: "1.0.0",
          path: runtimePath,
          dependencies: {
            transitive: { name: "transitive", version: "2.0.0", path: transitivePath },
          },
        },
      },
    },
  });
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.unknownLicenses, []);
  assert.deepEqual(
    report.packages.map((item) => [item.name, item.scope, item.license]),
    [
      ["runtime", "runtime-direct", "MIT"],
      ["transitive", "transitive", "Apache-2.0"],
    ],
  );
  assert.equal(normalizeLicense({ type: "MIT" }), "MIT");
});

test("fails closed on npm ls errors, problems, missing dependencies, and unknown licenses", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { runtime: "1.0.0" } }));
  const runtimePath = join(root, "node_modules", "runtime");
  mkdirSync(runtimePath, { recursive: true });
  writeFileSync(join(runtimePath, "package.json"), JSON.stringify({ name: "runtime", version: "1.0.0", license: "unknown" }));

  const report = collectDependencyLicenses({
    rootDirectory: root,
    dependencyTree: {
      path: root,
      problems: ["missing: runtime@1.0.0"],
      dependencies: {},
    },
    npmLsResult: {
      tree: null,
      exitCode: 1,
      stderr: "missing runtime",
      parseError: null,
      problems: ["missing: runtime@1.0.0"],
    },
  });
  assert.equal(report.failures.some((failure) => failure.includes("npm ls exited with code 1")), true);
  assert.equal(report.failures.some((failure) => failure.includes("npm ls problem")), true);
  assert.equal(report.failures.some((failure) => failure.includes("declared dependency is missing")), true);
});


test("ignores uninstalled optional platform packages", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  const runtimePath = join(root, "node_modules", "runtime");
  mkdirSync(runtimePath, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { runtime: "1.0.0" } }));
  writeFileSync(join(runtimePath, "package.json"), JSON.stringify({ name: "runtime", version: "1.0.0", license: "MIT" }));

  const report = collectDependencyLicenses({
    rootDirectory: root,
    dependencyTree: {
      path: root,
      dependencies: {
        runtime: {
          name: "runtime",
          version: "1.0.0",
          path: runtimePath,
          dependencies: {
            "runtime-linux-x64": {
              name: "runtime-linux-x64",
              version: "1.0.0",
            },
          },
        },
      },
    },
  });
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.packages.map((item) => item.name), ["runtime"]);
});

test("fails on manifest mismatches and unknown license variants", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  const runtimePath = join(root, "node_modules", "runtime");
  mkdirSync(runtimePath, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { runtime: "1.0.0" } }));
  writeFileSync(join(runtimePath, "package.json"), JSON.stringify({ name: "runtime", version: "2.0.0", license: "N/A" }));

  const report = collectDependencyLicenses({
    rootDirectory: root,
    dependencyTree: {
      path: root,
      dependencies: {
        runtime: { name: "runtime", version: "1.0.0", path: runtimePath },
      },
    },
  });
  assert.equal(report.failures.some((failure) => failure.includes("version mismatch")), true);
  assert.deepEqual(report.unknownLicenses, ["runtime@2.0.0"]);
});

test("renders SHA-separated markdown evidence", () => {
  const report = {
    schemaVersion: 2,
    sourceHeadSha: "head-sha",
    testedMergeSha: "merge-sha",
    environment: { node: "node", npm: "npm" },
    build: {
      manifest: { path: ".vite/manifest.json" },
      totalBytes: 0,
      totalGzipBytes: 0,
      entrypoints: [],
    },
    dependencies: { packages: [], unknownLicenses: [], failures: [] },
    failures: [],
  };
  const markdown = renderMarkdown(report);
  assert.match(markdown, /source head SHA: head-sha/);
  assert.match(markdown, /tested merge SHA: merge-sha/);
  assert.match(markdown, /自動監査は成功/);
});
