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

test("collects entrypoint asset closures and gzip sizes", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-audit-"));
  const dist = join(root, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<script type=\"module\" src=\"/assets/main.js\"></script>");
  writeFileSync(join(dist, "candidate.html"), "<link rel=\"stylesheet\" href=\"./assets/candidate.css\"><img src=\"./media/hero.svg\">");
  writeFileSync(join(dist, "assets", "main.js"), "import \"./main.css\";");
  writeFileSync(join(dist, "assets", "main.css"), "body{background:url(\"../media/hero.svg\")}");
  writeFileSync(join(dist, "assets", "candidate.css"), "body{color:black}");
  mkdirSync(join(dist, "media"));
  writeFileSync(join(dist, "media", "hero.svg"), "<svg></svg>");

  const report = collectBuildAudit({ distDirectory: dist });
  assert.equal(report.failures.length, 0);
  assert.equal(report.entrypoints[0].files.map((file) => file.path).includes("assets/main.css"), true);
  assert.equal(report.entrypoints[1].files.map((file) => file.path).includes("media/hero.svg"), true);
  assert.ok(report.totalGzipBytes > 0);
});

test("reports missing local assets", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-audit-"));
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "index.html"), "<script type=\"module\" src=\"/assets/missing.js\"></script>");
  writeFileSync(join(dist, "candidate.html"), "<!doctype html>");

  const report = collectBuildAudit({ distDirectory: dist });
  assert.equal(report.failures.some((failure) => failure.includes("missing local asset")), true);
});

test("collects direct and transitive license metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  const runtimePath = join(root, "node_modules", "runtime");
  const transitivePath = join(runtimePath, "node_modules", "transitive");
  mkdirSync(transitivePath, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { runtime: "1.0.0" } }));
  writeFileSync(join(runtimePath, "package.json"), JSON.stringify({ name: "runtime", version: "1.0.0", license: "MIT" }));
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
  assert.deepEqual(report.unknownLicenses, []);
  assert.deepEqual(report.packages.map((item) => [item.name, item.scope, item.license]), [
    ["runtime", "runtime-direct", "MIT"],
    ["transitive", "transitive", "Apache-2.0"],
  ]);
  assert.equal(normalizeLicense({ type: "MIT" }), "MIT");
  const markdown = renderMarkdown({
    schemaVersion: 1,
    commit: "test",
    environment: { node: "node", npm: "npm" },
    build: { fileCount: 0, totalBytes: 0, totalGzipBytes: 0, budgetBytes: 1, entrypoints: [] },
    dependencies: report,
    failures: [],
  });
  assert.match(markdown, /自動監査は成功/);
});
