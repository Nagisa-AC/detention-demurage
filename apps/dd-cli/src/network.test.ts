import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("network boundary", () => {
  it("keeps the provider SDK inside packages/extract", () => {
    const files = walk(repoRoot);
    const sdk = files.filter((file) => /from "@anthropic-ai\/sdk/.test(fs.readFileSync(file, "utf8")));
    expect(sdk.length).toBeGreaterThan(0);
    expect(sdk.every((file) => file.includes(`${path.sep}packages${path.sep}extract${path.sep}`))).toBe(true);

    const cli = walk(path.join(repoRoot, "apps", "dd-cli", "src")).filter(
      (file) => !file.endsWith(`${path.sep}extract-command.ts`) && !file.endsWith(".test.ts"),
    );
    const importers = cli.filter((file) => fs.readFileSync(file, "utf8").includes("dd-extract"));
    expect(importers).toEqual([]);
  });
});

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (/\.(ts|mjs|js)$/.test(entry.name)) found.push(full);
  }
  return found;
}
