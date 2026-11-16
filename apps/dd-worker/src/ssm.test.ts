import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANTHROPIC_PARAMETER, assertDatabaseTls, DATABASE_PARAMETER, readWorkerSecrets } from "./ssm.js";

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
      return name === DATABASE_PARAMETER ? "postgres://db.example/dd?sslmode=require" : "sk-test";
    });
    expect(names).toEqual([DATABASE_PARAMETER, ANTHROPIC_PARAMETER]);
    expect(secrets.databaseUrl).toContain("postgres://");
    expect(write).not.toHaveBeenCalled();
    const main = fs.readFileSync(path.join(here, "main.ts"), "utf8");
    expect(main).toContain("WithDecryption: true");
    expect(main).not.toContain("writeFile");
    expect(main).not.toContain("aws_iam_access_key");
  });

  it("accepts sslmode require or stricter and refuses anything weaker", () => {
    for (const mode of ["require", "verify-ca", "verify-full", "Require"]) {
      expect(() => assertDatabaseTls(`postgres://db.example/dd?sslmode=${mode}`)).not.toThrow();
    }
    expect(() => assertDatabaseTls("postgres://db.example/dd?application_name=dd&sslmode=verify-full")).not.toThrow();
    for (const url of [
      "postgres://owner:supersecret@db.example/dd",
      "postgres://owner:supersecret@db.example/dd?sslmode=disable",
      "postgres://owner:supersecret@db.example/dd?sslmode=allow",
      "postgres://owner:supersecret@db.example/dd?sslmode=prefer",
      "postgres://owner:supersecret@db.example/dd?sslmode=no-verify",
      "postgres://owner:supersecret@db.example/dd?sslmode=require&sslmode=disable",
      "host=db.example sslmode=require",
      "",
    ]) {
      expect(() => assertDatabaseTls(url), url).toThrow(/sslmode=require or stricter/);
      try {
        assertDatabaseTls(url);
      } catch (error) {
        expect(error instanceof Error ? error.message : "").not.toContain("supersecret");
      }
    }
  });

  it("refuses to start when the database URL does not require TLS", async () => {
    await expect(
      readWorkerSecrets(async (name) => (name === DATABASE_PARAMETER ? "postgres://db.example/dd?sslmode=prefer" : "sk-test")),
    ).rejects.toThrow(/sslmode=require or stricter/);
  });
});
