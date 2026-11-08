import { ESLint } from "eslint";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

describe("dd-core extract boundary", () => {
  it("does not depend on dd-extract", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "packages/dd-core/package.json"), "utf8"),
    ) as PackageManifest;
    expect(manifest.dependencies?.["dd-extract"]).toBeUndefined();
    expect(manifest.devDependencies?.["dd-extract"]).toBeUndefined();
    expect(manifest.peerDependencies?.["dd-extract"]).toBeUndefined();
  });

  it("rejects an import of dd-extract", async () => {
    const eslint = new ESLint({ cwd: repoRoot, ignore: false });
    const results = await eslint.lintFiles([
      "packages/dd-core/eslint-fixtures/imports-extract.ts",
    ]);
    const boundary = results.flatMap((result) =>
      result.messages.filter((message) => message.ruleId === "no-restricted-imports"),
    );

    expect(boundary.length).toBeGreaterThan(0);
    expect(boundary.every((message) => message.severity === 2)).toBe(true);
  });

  it("leaves dd-core source free of that error", async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintFiles(["packages/dd-core/src"]);
    const boundary = results.flatMap((result) =>
      result.messages.filter((message) => message.ruleId === "no-restricted-imports"),
    );

    expect(boundary).toEqual([]);
    expect(results.every((result) => result.errorCount === 0)).toBe(true);
  });

  it("keeps the violation fixture out of the default lint", async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const ignored = await eslint.isPathIgnored(
      "packages/dd-core/eslint-fixtures/imports-extract.ts",
    );

    expect(ignored).toBe(true);
  });
});
