import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const require = createRequire(path.join(here, "package.json"));
const pdfPackage = path.dirname(require.resolve("pdfjs-dist/package.json"));
const workerFile = path.join(pdfPackage, "legacy/build/pdf.worker.mjs");

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!Number.isInteger(nodeMajor) || nodeMajor < 24) {
  console.error("Bundle the worker with Node 24.");
  process.exit(1);
}

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "dd-worker-bundle-"));
const dist = path.join(repoRoot, "dist");
fs.mkdirSync(dist, { recursive: true });

// The bundle is ESM, so it has no require. CommonJS dependencies still call require() for Node built-ins.
const requireBanner =
  'import { createRequire as __ddCreateRequire } from "node:module"; const require = __ddCreateRequire(import.meta.url);';

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  legalComments: "eof",
  external: ["@napi-rs/canvas", "pg-native"],
  banner: { js: requireBanner },
  logLevel: "warning",
};

await esbuild.build({
  ...common,
  entryPoints: [path.join(here, "src/main.ts")],
  outfile: path.join(stage, "main.mjs"),
});
await esbuild.build({
  ...common,
  entryPoints: [path.join(here, "src/bundle-check.ts")],
  outfile: path.join(stage, "check.mjs"),
});
fs.copyFileSync(workerFile, path.join(stage, "pdf.worker.mjs"));

execFileSync(process.execPath, [path.join(stage, "main.mjs"), "--self-check"], { stdio: "inherit" });
execFileSync(process.execPath, [path.join(stage, "check.mjs"), path.join(repoRoot, "fixtures/synthetic/clean.pdf")], {
  stdio: "inherit",
});

const tarPath = path.join(dist, "dd-worker.tar");
execFileSync("tar", ["-cf", tarPath, "-C", stage, "main.mjs", "pdf.worker.mjs"], { stdio: "inherit" });
const sha = createHash("sha256").update(fs.readFileSync(tarPath)).digest("hex");
fs.writeFileSync(path.join(dist, "dd-worker.sha256"), `${sha}\n`);
fs.rmSync(stage, { recursive: true, force: true });
console.log(`sha256 ${sha}`);
