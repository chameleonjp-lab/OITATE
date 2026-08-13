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

test("fails closed on malformed Vite manifest entries and fields", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-manifest-"));
  const dist = join(root, "dist");
  mkdirSync(join(dist, ".vite"), { recursive: true });
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<script type=\"module\" src=\"/assets/main.js\"></script>");
  writeFileSync(join(dist, "candidate.html"), "<main>candidate</main>");
  writeFileSync(join(dist, "assets", "main.js"), "console.log('ok');");

  const base = { src: "index.html", file: "assets/main.js", isEntry: true };
  const cases = [
    ["missing file", { src: "index.html", isEntry: true }, "must define file"],
    ["css type", { ...base, css: "assets/main.css" }, "must define css"],
    ["assets item type", { ...base, assets: ["assets/asset.bin", 42] }, "must define assets"],
    ["imports type", { ...base, imports: "chunk.js" }, "must define imports"],
    ["dynamic imports type", { ...base, dynamicImports: ["chunk.js", null] }, "must define dynamicImports"],
    ["missing import target", { ...base, imports: ["missing-entry"] }, "import target missing"],
    ["missing output", { ...base, file: "assets/missing.js" }, "missing Vite manifest asset"],
  ];

  for (const [label, entry, expected] of cases) {
    writeManifest(dist, { "index.html": entry });
    const report = collectBuildAudit({ distDirectory: dist });
    assert.equal(
      report.failures.some((failure) => failure.includes(expected)),
      true,
      label,
    );
  }
});

test("fails on missing files in unreferenced Vite manifest entries", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-manifest-"));
  const dist = join(root, "dist");
  mkdirSync(join(dist, ".vite"), { recursive: true });
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<script type=\"module\" src=\"/assets/main.js\"></script>");
  writeFileSync(join(dist, "candidate.html"), "<main>candidate</main>");
  writeFileSync(join(dist, "assets", "main.js"), "console.log('ok');");
  writeManifest(dist, {
    "index.html": { src: "index.html", file: "assets/main.js", isEntry: true },
    "orphan.js": {
      src: "orphan.js",
      file: "assets/orphan.js",
      css: ["assets/orphan.css"],
      assets: ["media/orphan.png"],
    },
  });

  const report = collectBuildAudit({ distDirectory: dist });
  assert.equal(report.manifest.valid, false);
  assert.equal(
    report.failures.filter((failure) => failure.includes("missing Vite manifest asset")).length >= 3,
    true,
  );
});

test("fails on missing srcset, CSS import, poster, and SVG references", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-audit-"));
  const dist = join(root, "dist");
  mkdirSync(join(dist, ".vite"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<script src=\"/assets/missing.js\"></script>");
  writeFileSync(
    join(dist, "candidate.html"),
    "<link rel=\"stylesheet\" href=\"./assets/candidate.css\"><img src=\"./media/bad.svg\"><video poster=\"./media/missing-poster.png\"></video><img srcset=\"data:image/svg+xml,%3Csvg%3E 1x, ./media/missing-after-data.png 2x\"><img srcset=\"data:image/svg+xml,%3Csvg%3E, ./media/missing-descriptorless.png 2x\"><img srcset=\"data:image/svg+xml,%3Csvg%3E, missing.png 2x\"><img srcset=\"data:image/svg+xml,%3Csvg%3E, 画像.png 2x\"><img srcset=\"data:image/svg+xml,%3Csvg%3E 1x, %E7%94%BB%E5%83%8F.png 2x\"><link rel=\"preload\" imagesrcset=\"data:image/svg+xml,%3Csvg%3E, missing-image.png 2x\"><img srcset=\"https://example.test/image.png, missing-after-absolute.png 2x\"><img srcset=\"https://example.test/image,a.png, missing-after-comma.png 2x\"><link rel=\"preload\" imagesrcset=\"https://example.test/preload.png, missing-after-imagesrcset.png 2x\">",
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
  assert.equal(report.failures.some((failure) => failure.includes("missing-after-data.png")), true);
  assert.equal(report.failures.some((failure) => failure.includes("missing-descriptorless.png")), true);
  assert.equal(report.failures.some((failure) => failure.includes("missing.png")), true);
  assert.equal(report.failures.some((failure) => failure.includes("画像.png")), true);
  assert.equal(report.failures.some((failure) => failure.includes("%E7%94%BB%E5%83%8F.png")), true);
  assert.equal(report.failures.some((failure) => failure.includes("missing-image.png")), true);
  assert.equal(report.failures.some((failure) => failure.includes("missing-after-absolute.png")), true);
  assert.equal(report.failures.some((failure) => failure.includes("missing-after-comma.png")), true);
  assert.equal(report.failures.some((failure) => failure.includes("missing-after-imagesrcset.png")), true);
});

test("does not turn a standalone data URL into a local reference", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-audit-"));
  const dist = join(root, "dist");
  mkdirSync(join(dist, ".vite"), { recursive: true });
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<script type=\"module\" src=\"/assets/main.js\"></script>");
  mkdirSync(join(dist, "media"), { recursive: true });
  writeFileSync(join(dist, "media", "local.png"), "local");
  writeFileSync(join(dist, "candidate.html"), "<img srcset=\"data:image/svg+xml,%3Csvg%3E,%3Cpath%3E\"><img srcset=\"https://example.test/a,b.png 1x, ./media/local.png 2x\">");
  writeFileSync(join(dist, "assets", "main.js"), "console.log('ok');");
  writeManifest(dist, {
    "index.html": { src: "index.html", file: "assets/main.js", isEntry: true },
  });

  const report = collectBuildAudit({ distDirectory: dist });
  assert.deepEqual(report.failures, []);
  assert.equal(report.entrypoints[1].files.some((file) => file.path === "media/local.png"), true);
});

test("fails on multiline quoted and unquoted HTML asset attributes", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-audit-"));
  const dist = join(root, "dist");
  mkdirSync(join(dist, ".vite"), { recursive: true });
  mkdirSync(join(dist, "assets"), { recursive: true });
  mkdirSync(join(dist, "media"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<script type=\"module\" src=\"/assets/main.js\"></script>");
  writeFileSync(join(dist, "assets", "main.js"), "console.log('ok');");
  writeFileSync(join(dist, "media", "existing.png"), "existing");
  writeFileSync(
    join(dist, "candidate.html"),
    "<img srcset=\"./media/existing.png 1x,\n ./media/missing-multiline.png 2x\">"
      + "<link rel=\"preload\" as=\"image\" imagesrcset='./media/existing.png 1x,\n ./media/missing-preload-multiline.png 2x'>"
      + "<a href=./missing-download.pdf>download</a>"
      + "<img src=./missing-src.png>"
      + "<video poster=./missing-poster.jpg></video>",
  );
  writeManifest(dist, {
    "index.html": { src: "index.html", file: "assets/main.js", isEntry: true },
  });

  const report = collectBuildAudit({ distDirectory: dist });
  for (const missingPath of [
    "missing-multiline.png",
    "missing-preload-multiline.png",
    "missing-download.pdf",
    "missing-src.png",
    "missing-poster.jpg",
  ]) {
    assert.equal(
      report.failures.some((failure) => failure.includes(missingPath)),
      true,
      missingPath,
    );
  }
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
    dependencies: { transitive: "2.0.0" },
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

test("fails when a required transitive dependency is absent from npm ls", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  const runtimePath = join(root, "node_modules", "runtime");
  const transitivePath = join(root, "node_modules", "transitive");
  mkdirSync(runtimePath, { recursive: true });
  mkdirSync(transitivePath, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { runtime: "1.0.0" } }));
  writeFileSync(join(runtimePath, "package.json"), JSON.stringify({
    name: "runtime",
    version: "1.0.0",
    license: "MIT",
    dependencies: { transitive: "2.0.0" },
  }));
  writeFileSync(join(transitivePath, "package.json"), JSON.stringify({
    name: "transitive",
    version: "2.0.0",
    license: "UNKNOWN",
  }));

  const report = collectDependencyLicenses({
    rootDirectory: root,
    dependencyTree: {
      path: root,
      dependencies: {
        runtime: {
          name: "runtime",
          version: "1.0.0",
          path: runtimePath,
          dependencies: {},
        },
      },
    },
  });
  assert.equal(
    report.failures.some((failure) => failure.includes("required dependency is missing from npm ls: runtime@1.0.0 -> transitive")),
    true,
  );
  assert.equal(report.unknownLicenses.length, 0);
});

test("accepts a hoisted required dependency when npm ls omits a nested map", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  const runtimePath = join(root, "node_modules", "runtime");
  const transitivePath = join(root, "node_modules", "transitive");
  mkdirSync(runtimePath, { recursive: true });
  mkdirSync(transitivePath, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { runtime: "1.0.0" } }));
  writeFileSync(join(runtimePath, "package.json"), JSON.stringify({
    name: "runtime",
    version: "1.0.0",
    license: "MIT",
    dependencies: { transitive: "2.0.0" },
  }));
  writeFileSync(join(transitivePath, "package.json"), JSON.stringify({
    name: "transitive",
    version: "2.0.0",
    license: "Apache-2.0",
  }));

  const report = collectDependencyLicenses({
    rootDirectory: root,
    dependencyTree: {
      path: root,
      dependencies: {
        runtime: {
          name: "runtime",
          version: "1.0.0",
          path: runtimePath,
        },
        transitive: {
          name: "transitive",
          version: "2.0.0",
          path: transitivePath,
        },
      },
    },
  });
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.unknownLicenses, []);
  assert.deepEqual(report.packages.map((item) => item.name), ["runtime", "transitive"]);
});

test("accepts an explicitly mapped dependency resolved through a hoisted npm node", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  const runtimePath = join(root, "node_modules", "runtime");
  const transitivePath = join(root, "node_modules", "transitive");
  mkdirSync(runtimePath, { recursive: true });
  mkdirSync(transitivePath, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { runtime: "1.0.0" } }));
  writeFileSync(join(runtimePath, "package.json"), JSON.stringify({
    name: "runtime",
    version: "1.0.0",
    license: "MIT",
    dependencies: { transitive: "2.0.0" },
  }));
  writeFileSync(join(transitivePath, "package.json"), JSON.stringify({
    name: "transitive",
    version: "2.0.0",
    license: "Apache-2.0",
  }));

  const report = collectDependencyLicenses({
    rootDirectory: root,
    dependencyTree: {
      path: root,
      dependencies: {
        runtime: {
          name: "runtime",
          version: "1.0.0",
          path: runtimePath,
          dependencies: {},
        },
        transitive: {
          name: "transitive",
          version: "2.0.0",
          path: transitivePath,
        },
      },
    },
  });
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.unknownLicenses, []);
  assert.deepEqual(report.packages.map((item) => item.name), ["runtime", "transitive"]);
});

test("merges repeated npm tree stubs before validating required edges", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  const runtimePath = join(root, "node_modules", "runtime");
  const holderPath = join(root, "node_modules", "holder");
  const transitivePath = join(root, "node_modules", "transitive");
  mkdirSync(runtimePath, { recursive: true });
  mkdirSync(holderPath, { recursive: true });
  mkdirSync(transitivePath, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({
    dependencies: { runtime: "1.0.0", holder: "1.0.0" },
  }));
  writeFileSync(join(runtimePath, "package.json"), JSON.stringify({
    name: "runtime",
    version: "1.0.0",
    license: "MIT",
    dependencies: { transitive: "2.0.0" },
  }));
  writeFileSync(join(holderPath, "package.json"), JSON.stringify({
    name: "holder",
    version: "1.0.0",
    license: "MIT",
    dependencies: { runtime: "1.0.0" },
  }));
  writeFileSync(join(transitivePath, "package.json"), JSON.stringify({
    name: "transitive",
    version: "2.0.0",
    license: "Apache-2.0",
  }));

  const report = collectDependencyLicenses({
    rootDirectory: root,
    dependencyTree: {
      path: root,
      dependencies: {
        runtime: {
          name: "runtime",
          version: "1.0.0",
          path: runtimePath,
          dependencies: {},
        },
        holder: {
          name: "holder",
          version: "1.0.0",
          path: holderPath,
          dependencies: {
            runtime: {
              name: "runtime",
              version: "1.0.0",
              path: runtimePath,
              dependencies: {
                transitive: {
                  name: "transitive",
                  version: "2.0.0",
                  path: transitivePath,
                },
              },
            },
          },
        },
      },
    },
  });
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.packages.map((item) => item.name), ["holder", "runtime", "transitive"]);
});

test("fails when an installed optional direct dependency is omitted from npm ls", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  const optionalPath = join(root, "node_modules", "optionalpkg");
  mkdirSync(optionalPath, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({
    optionalDependencies: { optionalpkg: "1.0.0" },
  }));
  writeFileSync(join(optionalPath, "package.json"), JSON.stringify({
    name: "optionalpkg",
    version: "1.0.0",
    license: "UNKNOWN",
  }));

  const report = collectDependencyLicenses({
    rootDirectory: root,
    dependencyTree: { path: root, dependencies: {} },
  });
  assert.equal(
    report.failures.some((failure) => failure.includes("optional dependency is missing from npm ls: optionalpkg")),
    true,
  );
});

test("does not trust npm optional flags for required direct dependencies", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    dependencies: { required: "1.0.0" },
  }));

  const report = collectDependencyLicenses({
    rootDirectory: root,
    dependencyTree: {
      path: root,
      dependencies: {
        required: {
          name: "required",
          version: "1.0.0",
          optional: true,
        },
      },
    },
  });
  assert.equal(
    report.failures.some((failure) => failure.includes("required")),
    true,
  );
});

test("fails when installed optional transitive dependencies are omitted from npm ls", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  const runtimePath = join(root, "node_modules", "runtime");
  const optionalPath = join(root, "node_modules", "optionalpkg");
  mkdirSync(runtimePath, { recursive: true });
  mkdirSync(optionalPath, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({
    dependencies: { runtime: "1.0.0" },
  }));
  writeFileSync(join(runtimePath, "package.json"), JSON.stringify({
    name: "runtime",
    version: "1.0.0",
    license: "MIT",
    optionalDependencies: { optionalpkg: "1.0.0" },
  }));
  writeFileSync(join(optionalPath, "package.json"), JSON.stringify({
    name: "optionalpkg",
    version: "1.0.0",
    license: "UNKNOWN",
  }));

  const report = collectDependencyLicenses({
    rootDirectory: root,
    dependencyTree: {
      path: root,
      dependencies: {
        runtime: { name: "runtime", version: "1.0.0", path: runtimePath },
      },
    },
  });
  assert.equal(
    report.failures.some((failure) => failure.includes("optional dependency is missing from npm ls: runtime@1.0.0 -> optionalpkg")),
    true,
  );
});

test("fails when an installed optional peer is omitted from npm ls", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  const runtimePath = join(root, "node_modules", "runtime");
  const peerPath = join(root, "node_modules", "optional-peer");
  mkdirSync(runtimePath, { recursive: true });
  mkdirSync(peerPath, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({
    dependencies: { runtime: "1.0.0" },
  }));
  writeFileSync(join(runtimePath, "package.json"), JSON.stringify({
    name: "runtime",
    version: "1.0.0",
    license: "MIT",
    peerDependencies: { "optional-peer": "1.0.0" },
    peerDependenciesMeta: { "optional-peer": { optional: true } },
  }));
  writeFileSync(join(peerPath, "package.json"), JSON.stringify({
    name: "optional-peer",
    version: "1.0.0",
    license: "UNKNOWN",
  }));

  const report = collectDependencyLicenses({
    rootDirectory: root,
    dependencyTree: {
      path: root,
      dependencies: {
        runtime: { name: "runtime", version: "1.0.0", path: runtimePath },
      },
    },
  });
  assert.equal(
    report.failures.some((failure) => failure.includes("optional dependency is missing from npm ls: runtime@1.0.0 -> optional-peer")),
    true,
  );
});

test("accepts an installed optional dependency when npm ls includes it", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  const optionalPath = join(root, "node_modules", "optionalpkg");
  mkdirSync(optionalPath, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({
    optionalDependencies: { optionalpkg: "1.0.0" },
  }));
  writeFileSync(join(optionalPath, "package.json"), JSON.stringify({
    name: "optionalpkg",
    version: "1.0.0",
    license: "MIT",
  }));

  const report = collectDependencyLicenses({
    rootDirectory: root,
    dependencyTree: {
      path: root,
      dependencies: {
        optionalpkg: {
          name: "optionalpkg",
          version: "1.0.0",
          path: optionalPath,
        },
      },
    },
  });
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.packages.map((item) => item.name), ["optionalpkg"]);
});

test("uses parent manifests as the only optional dependency source", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  const runtimePath = join(root, "node_modules", "runtime");
  mkdirSync(runtimePath, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({
    dependencies: { runtime: "1.0.0" },
    optionalDependencies: { optional: "1.0.0" },
  }));
  writeFileSync(join(runtimePath, "package.json"), JSON.stringify({
    name: "runtime",
    version: "1.0.0",
    license: "MIT",
    peerDependencies: { peer: "1.0.0" },
    peerDependenciesMeta: { peer: { optional: true } },
  }));

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
            peer: { name: "peer", version: "1.0.0", peerOptional: true },
          },
        },
        optional: {
          name: "optional",
          version: "1.0.0",
          optional: true,
        },
      },
    },
  });
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.packages.map((item) => item.name), ["runtime"]);
});

test("walks later full occurrences of the same dependency edge", () => {
  const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
  const holderAPath = join(root, "node_modules", "holder-a");
  const holderBPath = join(root, "node_modules", "holder-b");
  const runtimePath = join(root, "node_modules", "runtime");
  const transitivePath = join(root, "node_modules", "transitive");
  const grandchildPath = join(root, "node_modules", "grandchild");
  for (const path of [holderAPath, holderBPath, runtimePath, transitivePath, grandchildPath]) {
    mkdirSync(path, { recursive: true });
  }
  writeFileSync(join(root, "package.json"), JSON.stringify({
    dependencies: { "holder-a": "1.0.0", "holder-b": "1.0.0" },
  }));
  writeFileSync(join(holderAPath, "package.json"), JSON.stringify({
    name: "holder-a",
    version: "1.0.0",
    license: "MIT",
    dependencies: { runtime: "1.0.0" },
  }));
  writeFileSync(join(holderBPath, "package.json"), JSON.stringify({
    name: "holder-b",
    version: "1.0.0",
    license: "MIT",
    dependencies: { runtime: "1.0.0" },
  }));
  writeFileSync(join(runtimePath, "package.json"), JSON.stringify({
    name: "runtime",
    version: "1.0.0",
    license: "MIT",
    dependencies: { transitive: "1.0.0" },
  }));
  writeFileSync(join(transitivePath, "package.json"), JSON.stringify({
    name: "transitive",
    version: "1.0.0",
    license: "MIT",
    dependencies: { grandchild: "1.0.0" },
  }));
  writeFileSync(join(grandchildPath, "package.json"), JSON.stringify({
    name: "grandchild",
    version: "1.0.0",
    license: "MIT",
  }));

  const report = collectDependencyLicenses({
    rootDirectory: root,
    dependencyTree: {
      path: root,
      dependencies: {
        "holder-a": {
          name: "holder-a",
          version: "1.0.0",
          path: holderAPath,
          dependencies: {
            runtime: {
              name: "runtime",
              version: "1.0.0",
              path: runtimePath,
              dependencies: {
                transitive: {
                  name: "transitive",
                  version: "1.0.0",
                  path: transitivePath,
                  dependencies: {},
                },
              },
            },
          },
        },
        "holder-b": {
          name: "holder-b",
          version: "1.0.0",
          path: holderBPath,
          dependencies: {
            runtime: {
              name: "runtime",
              version: "1.0.0",
              path: runtimePath,
              dependencies: {
                transitive: {
                  name: "transitive",
                  version: "1.0.0",
                  path: transitivePath,
                  dependencies: {
                    grandchild: {
                      name: "grandchild",
                      version: "1.0.0",
                      path: grandchildPath,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  assert.deepEqual(report.failures, []);
  assert.equal(report.packages.some((item) => item.name === "grandchild"), true);
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
  writeFileSync(join(runtimePath, "package.json"), JSON.stringify({
    name: "runtime",
    version: "1.0.0",
    license: "MIT",
    optionalDependencies: { "runtime-linux-x64": "1.0.0" },
  }));

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

test("detects unknown tokens inside compound license expressions", () => {
  const cases = [
    ["MIT AND unknown", true],
    ["(MIT OR UNKNOWN)", true],
    ["Apache-2.0 WITH unknown", true],
    ["UNKNOWN,MIT", true],
    ["MIT;unknown", true],
    ["[NOASSERTION]", true],
    ["UNKNOWNISH", false],
    ["LicenseRef-UNKNOWN", false],
    ["MIT AND Apache-2.0", false],
  ];

  for (const [license, expectedUnknown] of cases) {
    const root = mkdtempSync(join(tmpdir(), "oitate-p8-license-"));
    const runtimePath = join(root, "node_modules", "runtime");
    mkdirSync(runtimePath, { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies: { runtime: "1.0.0" } }));
    writeFileSync(join(runtimePath, "package.json"), JSON.stringify({
      name: "runtime",
      version: "1.0.0",
      license,
    }));
    const report = collectDependencyLicenses({
      rootDirectory: root,
      dependencyTree: {
        path: root,
        dependencies: {
          runtime: { name: "runtime", version: "1.0.0", path: runtimePath },
        },
      },
    });
    assert.equal(report.unknownLicenses.length > 0, expectedUnknown, license);
  }
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
