import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("extract import", () => {
  it("is limited to the worker and the CLI", () => {
    const apps = path.join(repoRoot, "apps");
    const importers = fs
      .readdirSync(apps)
      .filter((name) => {
        const pkgPath = path.join(apps, name, "package.json");
        if (!fs.existsSync(pkgPath)) return false;
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { dependencies?: Record<string, string> };
        return pkg.dependencies?.["dd-extract"] !== undefined;
      })
      .sort();
    expect(importers).toEqual(["dd-cli", "dd-worker"]);
    const worker = fs.readFileSync(path.join(repoRoot, "apps/dd-worker/src/model.ts"), "utf8");
    expect(worker).toContain("dd-extract");
    expect(worker).toContain("onlyPages");
  });
});
