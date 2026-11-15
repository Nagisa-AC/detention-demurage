import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANTHROPIC_PARAMETER, DATABASE_PARAMETER, readWorkerSecrets } from "./ssm.js";

const here = path.dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("worker secrets", () => {
  it("reads the two parameters into memory and does not write them", async () => {
    const write = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("wrote a file");
    });
    const names: string[] = [];
    const secrets = await readWorkerSecrets(async (name) => {
      names.push(name);
      return name === DATABASE_PARAMETER ? "postgres://db.example/dd" : "sk-test";
    });
    expect(names).toEqual([DATABASE_PARAMETER, ANTHROPIC_PARAMETER]);
    expect(secrets.databaseUrl).toContain("postgres://");
    expect(write).not.toHaveBeenCalled();
    const main = fs.readFileSync(path.join(here, "main.ts"), "utf8");
    expect(main).toContain("WithDecryption: true");
    expect(main).not.toContain("writeFile");
    expect(main).not.toContain("aws_iam_access_key");
  });
});
