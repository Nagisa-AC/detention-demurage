import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { customerConfigSchema, parseCustomerConfig, type CustomerConfig } from "dd-core";
import { describe, expect, it } from "vitest";
import { insertRealDocumentsFlag, insertSettingsVersion, type SettingsSql } from "./settings";

const CUSTOMER = "1dd5e894-bac7-4ade-8d11-e60da1290c83";
const yamlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/config/harbor_home.yaml");

describe("real documents setting", () => {
  it("keeps the switch when a YAML save omits it, and honors an explicit value", async () => {
    const yaml = fs.readFileSync(yamlPath, "utf8");
    const previous = { ...parseCustomerConfig(yaml, "settings"), accepts_real_documents: true };
    const omitted = fakeSql(previous);
    const kept = await insertSettingsVersion(omitted, { customerId: CUSTOMER, yaml, actor: "Ada" });
    expect(kept).toEqual({ ok: true, version: 2 });
    expect(savedConfig(omitted).accepts_real_documents).toBe(true);
    expect(omitted.audits).toEqual([{ version: 2 }]);

    const explicit = fakeSql(previous);
    const turnedOff = await insertSettingsVersion(explicit, {
      customerId: CUSTOMER,
      yaml: `${yaml}\naccepts_real_documents: false\n`,
      actor: "Ada",
    });
    expect(turnedOff).toEqual({ ok: true, version: 2 });
    expect(savedConfig(explicit).accepts_real_documents).toBe(false);
  });

  it("writes a new version only when the switch changes", async () => {
    const current = customerConfigSchema.parse({ ...parseCustomerConfig(fs.readFileSync(yamlPath, "utf8"), "settings") });
    const same = fakeSql(current);
    const unchanged = await insertRealDocumentsFlag(same, { customerId: CUSTOMER, accepts: false, actor: "Ada" });
    expect(unchanged).toEqual({ ok: true, version: 1 });
    expect(same.inserts).toEqual([]);

    const next = fakeSql(current);
    const changed = await insertRealDocumentsFlag(next, { customerId: CUSTOMER, accepts: true, actor: "Ada" });
    expect(changed).toEqual({ ok: true, version: 2 });
    expect(savedConfig(next).accepts_real_documents).toBe(true);
    expect(next.audits).toEqual([{ version: 2 }]);

    const empty = fakeSql(null);
    const refused = await insertRealDocumentsFlag(empty, { customerId: CUSTOMER, accepts: true, actor: "Ada" });
    expect(refused).toEqual({
      ok: false,
      problems: [{ path: "accepts_real_documents", message: "save settings first" }],
    });
  });
});

function savedConfig(sql: { inserts: readonly unknown[][] }): CustomerConfig {
  const values = sql.inserts[0];
  if (values === undefined) throw new Error("no insert");
  return customerConfigSchema.parse(JSON.parse(String(values[2])));
}

function fakeSql(current: CustomerConfig | null): SettingsSql & { inserts: unknown[][]; audits: unknown[] } {
  const inserts: unknown[][] = [];
  const audits: unknown[] = [];
  return {
    inserts,
    audits,
    async query<T extends Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }> {
      const row = (value: unknown): T => value as unknown as T;
      if (text.includes('FROM "Customer"')) return { rows: [row({ config_id: "harbor_home" })] };
      if (text.includes("SELECT version, config")) {
        return { rows: current === null ? [] : [row({ version: 1, config: current })] };
      }
      if (text.includes("MAX(version)")) return { rows: [row({ version: current === null ? 0 : 1 })] };
      if (text.includes('INSERT INTO "CustomerConfigVersion"')) {
        inserts.push([...(values ?? [])]);
        return { rows: [] };
      }
      if (text.includes("settings_saved")) {
        audits.push(JSON.parse(String(values?.[2])));
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}
