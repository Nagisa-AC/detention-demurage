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

const pdfkitPackages = fs.globSync("node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/package.json", { cwd: repoRoot });
if (pdfkitPackages.length !== 1) {
  console.error("Expected one pdfkit package in the store.");
  process.exit(1);
}
const pdfkitRoot = path.dirname(path.join(repoRoot, pdfkitPackages[0] ?? ""));

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  legalComments: "eof",
  jsx: "automatic",
  external: ["@napi-rs/canvas", "pg-native"],
  banner: { js: requireBanner },
  logLevel: "warning",
  plugins: [
    {
      name: "pdfkit-imports",
      setup(build) {
        // pdfkit's node build calls require("#standard-fonts/…"), which is not a real module.
        build.onLoad({ filter: /pdfkit\.node\.mjs$/ }, async (args) => {
          const text = await fs.promises.readFile(args.path, "utf8");
          const contents = text.replaceAll(/require\$1\('(#standard-fonts\/[^']+)'\)/g, (_match, spec) => {
            const face = spec.slice("#standard-fonts/".length);
            return `require(${JSON.stringify(path.join(pdfkitRoot, "js/standard-fonts", `${face}.cjs`))})`;
          });
          return { contents, loader: "js" };
        });
      },
    },
  ],
};

await esbuild.build({
  ...common,
  entryPoints: [path.join(here, "src/main.ts")],
  outfile: path.join(stage, "main.mjs"),
});
fs.copyFileSync(workerFile, path.join(stage, "pdf.worker.mjs"));
fs.cpSync(path.join(here, "fonts"), path.join(stage, "fonts"), { recursive: true });

execFileSync(process.execPath, [path.join(stage, "main.mjs"), "--self-check"], { stdio: "inherit" });
execFileSync(process.execPath, [path.join(stage, "main.mjs"), "--check-pdf", path.join(repoRoot, "fixtures/synthetic/clean.pdf")], {
  stdio: "inherit",
});

const tarPath = path.join(dist, "dd-worker.tar");
const fontNames = fs.readdirSync(path.join(stage, "fonts")).sort().map((name) => path.join("fonts", name));
execFileSync("tar", ["-cf", tarPath, "-C", stage, "main.mjs", "pdf.worker.mjs", ...fontNames], { stdio: "inherit" });
const sha = createHash("sha256").update(fs.readFileSync(tarPath)).digest("hex");
fs.writeFileSync(path.join(dist, "dd-worker.sha256"), `${sha}\n`);
fs.rmSync(stage, { recursive: true, force: true });
console.log(`sha256 ${sha}`);
