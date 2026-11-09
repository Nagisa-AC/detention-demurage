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
    const boundary = await boundaryMessages(
      "packages/dd-core/eslint-fixtures/imports-extract.ts",
      "no-restricted-imports",
    );

    expect(boundary.length).toBeGreaterThan(0);
    expect(boundary.every((message) => message.severity === 2)).toBe(true);
  });

  it("rejects a relative import into packages/extract", async () => {
    const boundary = await boundaryMessages(
      "packages/dd-core/eslint-fixtures/imports-extract-relative.ts",
      "no-restricted-imports",
    );

    expect(boundary.length).toBeGreaterThan(0);
    expect(boundary.every((message) => message.severity === 2)).toBe(true);
  });

  it("rejects a dynamic import in dd-core", async () => {
    const boundary = await boundaryMessages(
      "packages/dd-core/eslint-fixtures/dynamic-import.ts",
      "no-restricted-syntax",
    );

    expect(boundary.length).toBeGreaterThan(0);
    expect(boundary.every((message) => message.severity === 2)).toBe(true);
  });

  it("leaves dd-core source free of that error", async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintFiles(["packages/dd-core/src"]);
    const boundary = results.flatMap((result) =>
      result.messages.filter(
        (message) =>
          message.ruleId === "no-restricted-imports" ||
          message.ruleId === "no-restricted-syntax",
      ),
    );

    expect(boundary).toEqual([]);
    expect(results.every((result) => result.errorCount === 0)).toBe(true);
  });

  it("keeps the violation fixtures out of the default lint", async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const fixtures = [
      "packages/dd-core/eslint-fixtures/imports-extract.ts",
      "packages/dd-core/eslint-fixtures/imports-extract-relative.ts",
      "packages/dd-core/eslint-fixtures/dynamic-import.ts",
      "packages/dd-core/eslint-fixtures/money-float.ts",
    ];

    for (const fixture of fixtures) {
      expect(await eslint.isPathIgnored(fixture)).toBe(true);
    }
  });
});

async function boundaryMessages(file: string, ruleId: string) {
  const eslint = new ESLint({ cwd: repoRoot, ignore: false });
  const results = await eslint.lintFiles([file]);
  return results.flatMap((result) =>
    result.messages.filter((message) => message.ruleId === ruleId),
  );
}
