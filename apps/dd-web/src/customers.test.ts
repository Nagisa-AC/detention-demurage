import { afterEach, describe, expect, it } from "vitest";
import { addCustomer, insertCustomer, readCustomerFields, type CustomerSql } from "./customers";

const savedUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
});

describe("customer fields", () => {
  it("accepts a display name and a config id", () => {
    expect(readCustomerFields("  Harbor Home Goods  ", " harbor_home ")).toEqual({
      ok: true,
      displayName: "Harbor Home Goods",
      configId: "harbor_home",
    });
  });

  it("rejects a blank name, a long name, and a config id with a capital letter", () => {
    expect(message(readCustomerFields("   ", "harbor_home"))).toBe("Enter a display name.");
    expect(message(readCustomerFields("a".repeat(121), "harbor_home"))).toBe("Enter a display name.");
    expect(message(readCustomerFields("Harbor\nHome", "harbor_home"))).toBe("Enter a display name.");
    expect(message(readCustomerFields("Harbor Home Goods", "Harbor_home"))).toBe("Enter a config id like harbor_home.");
  });
});

describe("insertCustomer", () => {
  it("stores the customer and an audit row that carries the config id", async () => {
    const sql = fakeSql();
    const result = await insertCustomer(sql, {
      displayName: "Harbor Home Goods",
      configId: "harbor_home",
      actor: "Ada",
    });
    expect(result).toEqual({ ok: true });
    expect(sql.calls.map((call) => call.text.split("\n")[0])).toEqual([
      "BEGIN",
      `INSERT INTO "Customer" (config_id, display_name) VALUES ($1, $2) RETURNING id`,
      `INSERT INTO "AuditEvent" (customer_id, actor, action, payload)`,
      "COMMIT",
    ]);
    expect(sql.calls[1]?.values).toEqual(["harbor_home", "Harbor Home Goods"]);
    expect(sql.calls[2]?.values).toEqual(["cust-1", "Ada", JSON.stringify({ config_id: "harbor_home" })]);
  });

  it("returns the duplicate message and rolls back", async () => {
    const sql = fakeSql({ unique: true });
    const result = await insertCustomer(sql, {
      displayName: "Harbor Home Goods",
      configId: "harbor_home",
      actor: "Ada",
    });
    expect(result).toEqual({ ok: false, message: "A customer with that config id already exists." });
    expect(sql.calls.map((call) => call.text)).toEqual([
      "BEGIN",
      `INSERT INTO "Customer" (config_id, display_name) VALUES ($1, $2) RETURNING id`,
      "ROLLBACK",
    ]);
  });
});

describe("addCustomer", () => {
  it("stops when the database is not configured", async () => {
    delete process.env.DATABASE_URL;
    const result = await addCustomer({ displayName: "Harbor Home Goods", configId: "harbor_home", actor: "Ada" });
    expect(result).toEqual({ ok: false, message: "The database is not configured." });
  });
});

function message(result: { ok: true } | { ok: false; message: string }): string {
  return result.ok ? "" : result.message;
}

function fakeSql(options?: { unique?: boolean }): CustomerSql & { calls: { text: string; values: readonly unknown[] }[] } {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values: values ?? [] });
      if (options?.unique === true && text.startsWith(`INSERT INTO "Customer"`)) {
        const error = new Error("duplicate") as Error & { code: string };
        error.code = "23505";
        throw error;
      }
      if (text.startsWith(`INSERT INTO "Customer"`)) return { rows: [{ id: "cust-1" }] };
      return { rows: [] };
    },
  };
}
