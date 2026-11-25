import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { customerConfigSchema, parseCustomerConfig, type ConfigProblem, type CustomerConfig } from "dd-core";
import { describe, expect, it } from "vitest";
import { SettingsForm } from "./app/(signed-in)/customers/settings-form";
import { insertSettingsVersion, type SettingsSql } from "./settings";
import {
  addRate,
  addTerm,
  documentFromDraft,
  draftFromConfig,
  removeRate,
  removeTerm,
  settingsYaml,
  type SettingsDraft,
} from "./settings-draft";

const CUSTOMER = "1dd5e894-bac7-4ade-8d11-e60da1290c83";
const harborPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/config/harbor_home.yaml",
);

describe("settings form draft", () => {
  it("saves an unchanged version as the same config", async () => {
    const loaded = parseCustomerConfig(fs.readFileSync(harborPath, "utf8"), "settings");
    const turnedOn = { ...loaded, accepts_real_documents: true };
    for (const config of [loaded, turnedOn]) {
      const yaml = settingsYaml(draftFromConfig(config));
      expect(yaml).not.toContain("accepts_real_documents");
      const sql = fakeSql(config);
      const saved = await insertSettingsVersion(sql, { customerId: CUSTOMER, yaml, actor: "Ada" });
      expect(saved).toEqual({ ok: true, version: 2 });
      expect(savedConfig(sql)).toEqual(config);
    }
    const kept = draftFromConfig(loaded);
    kept.feePct = "0.250";
    expect(documentFromDraft(kept).fee_pct).toBe("0.250");
    kept.feePercent = "30";
    expect(documentFromDraft(kept).fee_pct).toBe("0.3");
  });

  it("names each field the form can invalidate", () => {
    const draft = draftFromConfig(parseCustomerConfig(fs.readFileSync(harborPath, "utf8"), "settings"));
    expect(problems(withFee(draft, "101"))).toEqual([
      { path: "fee_pct", message: "must be a decimal string from 0 through 1" },
    ]);
    expect(problems({ ...draft, validUntil: "2020-01-01" })).toEqual([
      { path: "authorization.valid_until", message: "valid_until is before signed_on" },
    ]);
    expect(problems({ ...draft, lookbackFrom: "March 2" })).toEqual([
      { path: "lookback_from", message: "must be a YYYY-MM-DD date" },
    ]);
    expect(problems({ ...draft, retentionDays: "0" })).toEqual([
      { path: "retention_days_after_close", message: "must be a positive integer" },
    ]);
    expect(problems({ ...draft, retentionDays: "10.5" })).toEqual([
      { path: "retention_days_after_close", message: "must be an integer" },
    ]);
    expect(problems({ ...draft, billedAs: "nvocc_passthrough", forwarder: "" })).toEqual([
      { path: "nvocc", message: "must be a non-empty string" },
    ]);
    expect(
      problems({
        ...draft,
        carriers: [
          { id: "sample_line", stance: "pursue" },
          { id: "sample_line", stance: "pursue" },
        ],
      }),
    ).toEqual([{ path: "billing_parties.pursue", message: "sample_line is repeated" }]);
    expect(problems(patchTerm(draft, 0, { validTo: "2026-01-01" }))).toEqual([
      { path: "contract_terms.0.valid_to", message: "valid_to is before valid_from" },
    ]);
    expect(problems(patchTerm(draft, 0, { demurrageDays: "-1" }))).toEqual([
      { path: "contract_terms.0.demurrage.free_days", message: "must be a non-negative integer" },
    ]);
    expect(problems(patchTerm(draft, 0, { detentionDays: "1.5" }))).toEqual([
      { path: "contract_terms.0.detention.free_days", message: "must be an integer" },
    ]);
    expect(problems(patchRate(draft, 0, 0, { fromDay: "4", toDay: "2" }))).toEqual([
      { path: "contract_terms.0.rates.0.to_day", message: "to_day is before from_day" },
    ]);
    expect(problems(patchRate(draft, 0, 1, { fromDay: "4", toDay: "6" }))).toEqual([
      {
        path: "contract_terms.0.rates.1",
        message: "demurrage 1-4 overlaps demurrage 4-6",
      },
    ]);
  });

  it("adds and removes contract terms and rate tiers", () => {
    const loaded = parseCustomerConfig(fs.readFileSync(harborPath, "utf8"), "settings");
    let draft = addTerm(draftFromConfig(loaded));
    draft = patchTerm(draft, 1, {
      billingParty: "cobalt_line",
      serviceContract: "SC-SYNTH-002",
      validFrom: "2026-03-01",
      validTo: "2026-03-31",
      demurrageDays: "4",
      detentionDays: "4",
    });
    draft = addRate(draft, 1);
    draft = patchRate(draft, 1, 0, { charge: "detention", fromDay: "1", toDay: "3", perDay: "10.00", currency: "USD" });
    const added = parseCustomerConfig(settingsYaml(draft), "settings");
    expect(added.store_contract_terms).toBe(true);
    expect(added.contract_terms).toHaveLength(2);
    expect(added.contract_terms?.[1]).toMatchObject({
      billing_party: "cobalt_line",
      service_contract: "SC-SYNTH-002",
      rates: [{ charge: "detention", from_day: 1, to_day: 3, per_day: "10.00", currency: "USD" }],
    });

    const withoutTier = parseCustomerConfig(settingsYaml(removeRate(draft, 0, 1)), "settings");
    expect(withoutTier.contract_terms?.[0]?.rates).toHaveLength(1);
    expect(withoutTier.contract_terms?.[0]?.rates[0]?.to_day).toBe(4);

    const withoutTerm = parseCustomerConfig(settingsYaml(removeTerm(draft, 1)), "settings");
    expect(withoutTerm.contract_terms).toHaveLength(1);
    expect(withoutTerm.contract_terms?.[0]?.service_contract).toBe("SC-SYNTH-001");
  });
});

describe("settings form", () => {
  it("shows the drawer fields, a read-only id, and a read-only YAML view", () => {
    const config = parseCustomerConfig(fs.readFileSync(harborPath, "utf8"), "settings");
    const html = renderToStaticMarkup(
      createElement(SettingsForm, {
        customerId: CUSTOMER,
        configId: config.id,
        displayName: config.name,
        config,
      }),
    );
    expect(html).toContain("View as YAML");
    expect(html).toContain("Fee %");
    expect(html).toContain("Through a forwarder");
    expect(html).toContain("Add contract term");
    expect(html).toContain("Add rate tier");
    expect(html).toContain("Accepts real documents");
    expect(html).toContain('value="harbor_home"');
    expect(html).toContain("readOnly");
    expect(html).toContain('value="25"');
    expect(html).not.toContain('name="yaml"');
  });
});

function problems(draft: SettingsDraft): ConfigProblem[] {
  try {
    parseCustomerConfig(settingsYaml(draft), "settings");
  } catch (error) {
    if (error instanceof Error && "problems" in error) return [...(error.problems as ConfigProblem[])];
    throw error;
  }
  return [];
}

function withFee(draft: SettingsDraft, percent: string): SettingsDraft {
  return { ...draft, feePercent: percent };
}

function patchTerm(draft: SettingsDraft, index: number, patch: Partial<SettingsDraft["terms"][number]>): SettingsDraft {
  return {
    ...draft,
    terms: draft.terms.map((term, at) => (at === index ? { ...term, ...patch } : term)),
  };
}

function patchRate(
  draft: SettingsDraft,
  termIndex: number,
  rateIndex: number,
  patch: Partial<SettingsDraft["terms"][number]["rates"][number]>,
): SettingsDraft {
  return patchTerm(draft, termIndex, {
    rates: draft.terms[termIndex]?.rates.map((rate, index) => (index === rateIndex ? { ...rate, ...patch } : rate)) ?? [],
  });
}

function savedConfig(sql: { inserts: readonly unknown[][] }): CustomerConfig {
  const values = sql.inserts[0];
  if (values === undefined) throw new Error("no insert");
  return customerConfigSchema.parse(JSON.parse(String(values[2])));
}

function fakeSql(current: CustomerConfig): SettingsSql & { inserts: unknown[][] } {
  const inserts: unknown[][] = [];
  return {
    inserts,
    async query<T extends Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }> {
      const row = (value: unknown): T => value as unknown as T;
      if (text.includes('FROM "Customer"')) return { rows: [row({ config_id: "harbor_home" })] };
      if (text.includes("SELECT version, config")) return { rows: [row({ version: 1, config: current })] };
      if (text.includes("MAX(version)")) return { rows: [row({ version: 1 })] };
      if (text.includes('INSERT INTO "CustomerConfigVersion"')) {
        inserts.push([...(values ?? [])]);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}
