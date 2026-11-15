import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { assertSafeTestDatabase, testDatabaseUrl } from "./guard";

const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../prisma/schema.prisma");

describe("test database guard", () => {
  const previousDatabase = process.env.DATABASE_URL;
  const previousTest = process.env.TEST_DATABASE_URL;

  afterEach(() => {
    restore("DATABASE_URL", previousDatabase);
    restore("TEST_DATABASE_URL", previousTest);
  });

  it("refuses a Neon host and does not use that URL", () => {
    const neon = "postgres://owner:secret@ep-example.us-east-2.aws.neon.tech/neondb?sslmode=require";
    expect(() => assertSafeTestDatabase(neon)).toThrow(/Neon/);
    process.env.TEST_DATABASE_URL = neon;
    process.env.DATABASE_URL = neon;
    expect(() => testDatabaseUrl()).toThrow(/Neon/);
  });

  it("uses the local test database when TEST_DATABASE_URL is unset", () => {
    process.env.DATABASE_URL = "postgres://owner:secret@ep-example.us-east-2.aws.neon.tech/neondb";
    delete process.env.TEST_DATABASE_URL;
    expect(testDatabaseUrl()).toBe("postgres://postgres:postgres@127.0.0.1:5432/dd_test");
  });

  it("keeps every foreign key restrict and every money column exact", () => {
    const schema = fs.readFileSync(schemaPath, "utf8");
    expect(schema).not.toMatch(/\bFloat\b/);
    expect(schema).not.toMatch(/\bCascade\b/);
    expect(schema).not.toMatch(/\bSetNull\b/);
    const relations = schema.match(/@relation\([^)]*\)/g) ?? [];
    const foreignKeys = relations.filter((relation) => relation.includes("fields:"));
    expect(foreignKeys.length).toBeGreaterThan(0);
    for (const relation of foreignKeys) {
      expect(relation).toContain("onDelete: Restrict");
      expect(relation).toContain("onUpdate: Restrict");
    }
  });
});

function restore(name: "DATABASE_URL" | "TEST_DATABASE_URL", value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
