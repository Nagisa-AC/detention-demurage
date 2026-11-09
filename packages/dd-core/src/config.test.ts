import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";
import { CustomerConfigError, loadCustomerConfig, type ConfigProblem, type CustomerConfig } from "./config.js";

const configDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/config");
const harborPath = path.join(configDir, "harbor_home.yaml");

describe("loadCustomerConfig", () => {
  it("loads harbor_home", () => {
    const config = loadCustomerConfig(harborPath);

    expect(config).toEqual({
      id: "harbor_home",
      name: "Harbor Home Goods",
      fee_pct: "0.25",
      billed_party_role: "direct",
      nvocc: null,
      authorization: {
        document: "auth_2027-01-10.pdf",
        signed_on: "2027-01-10",
        valid_until: "2028-01-10",
        covers: ["sample_line", "cobalt_line", "northbay_line"],
      },
      billing_parties: {
        pursue: ["sample_line", "cobalt_line"],
        do_not_pursue: ["northbay_line"],
      },
      store_contract_terms: true,
      contract_terms: [
        {
          billing_party: "sample_line",
          service_contract: "SC-SYNTH-001",
          valid_from: "2026-02-01",
          valid_to: "2026-02-28",
          demurrage: { free_days: 5, day_basis: "calendar" },
          detention: { free_days: 7, day_basis: "calendar" },
          rates: [
            { charge: "demurrage", from_day: 1, to_day: 4, per_day: "150.00", currency: "USD" },
            { charge: "demurrage", from_day: 5, per_day: "250.00", currency: "USD" },
          ],
        },
      ],
      lookback_from: "2022-06-16",
      retention_days_after_close: 730,
    });
    expect(typeof config.fee_pct).toBe("string");
  });

  it("records why the contract window is February 2026", () => {
    const text = fs.readFileSync(harborPath, "utf8");
    expect(text).toContain(
      "Wider dates would make R3 (M1.15) fire on fixtures other than free_time_overbill.",
    );
  });

  it("names the file and the field for each broken fixture", () => {
    const cases = [
      ["fee_pct_above_one.yaml", "fee_pct", "must be a decimal string from 0 through 1"],
      ["fee_pct_number.yaml", "fee_pct", "must be a decimal string from 0 through 1"],
      [
        "pursue_overlaps_do_not_pursue.yaml",
        "billing_parties.pursue",
        "sample_line is in both pursue and do_not_pursue",
      ],
      ["pursue_not_covered.yaml", "billing_parties.pursue", "other_line is not in authorization.covers"],
      [
        "do_not_pursue_not_covered.yaml",
        "billing_parties.do_not_pursue",
        "other_line is not in authorization.covers",
      ],
      ["terms_without_consent.yaml", "contract_terms", "contract terms require store_contract_terms: true"],
      ["terms_flag_omitted.yaml", "contract_terms", "contract terms require store_contract_terms: true"],
      ["overlapping_tiers.yaml", "contract_terms.0.rates.1", "demurrage 1-4 overlaps demurrage 4-6"],
    ] as const;

    for (const [name, field, message] of cases) {
      const file = path.join(configDir, name);
      expect(problemsOf(file), name).toEqual([{ path: field, message }]);
    }
  });

  it("does not dump the rest of the file into the error", () => {
    const file = path.join(configDir, "fee_pct_above_one.yaml");
    const error = thrown(file);
    expect(error.message).not.toContain("Harbor Home");
    expect(error.message).not.toContain("150.00");
    expect(error.message).not.toContain("sample_line");
  });

  it("accepts a decimal string from 0 through 1", () => {
    for (const fee of ["0", "0.0", "0.25", "0.250", "1", "1.0", "1.00", "1.000"]) {
      const doc = documentOf(loadCustomerConfig(harborPath));
      doc.fee_pct = fee;
      expect(loadCustomerConfig(writeYaml(`fee-${fee}`, doc)).fee_pct, fee).toBe(fee);
    }
  });

  it("rejects a fee outside 0 through 1, a leading zero, and a non-string", () => {
    for (const fee of ["1.01", "01", "00.25", "2", "1.10", ".25", ""]) {
      const doc = documentOf(loadCustomerConfig(harborPath));
      doc.fee_pct = fee;
      expect(problemsOf(writeYaml(`bad-fee-${fee || "empty"}`, doc)), String(fee)).toEqual([
        { path: "fee_pct", message: "must be a decimal string from 0 through 1" },
      ]);
    }
  });

  it("allows a covered party that is neither pursued nor refused", () => {
    const doc = documentOf(loadCustomerConfig(harborPath));
    const covers = (doc.authorization as { covers: string[] }).covers;
    covers.push("extra_line");
    const loaded = loadCustomerConfig(writeYaml("superset", doc));
    expect(loaded.authorization.covers).toEqual(["sample_line", "cobalt_line", "northbay_line", "extra_line"]);
  });

  it("rejects a repeated pursue id", () => {
    const doc = documentOf(loadCustomerConfig(harborPath));
    (doc.billing_parties as { pursue: string[] }).pursue = ["sample_line", "sample_line"];
    expect(problemsOf(writeYaml("repeat", doc))).toEqual([
      { path: "billing_parties.pursue", message: "sample_line is repeated" },
    ]);
  });

  it("requires a name only when the role is nvocc_passthrough", () => {
    const direct = documentOf(loadCustomerConfig(harborPath));
    direct.nvocc = "North Bay Forwarding";
    expect(problemsOf(writeYaml("direct-name", direct))).toEqual([
      { path: "nvocc", message: "direct has no nvocc" },
    ]);

    const missing = documentOf(loadCustomerConfig(harborPath));
    missing.billed_party_role = "nvocc_passthrough";
    missing.nvocc = null;
    expect(problemsOf(writeYaml("passthrough-missing", missing))).toEqual([
      { path: "nvocc", message: "nvocc_passthrough names the nvocc" },
    ]);

    const named = documentOf(loadCustomerConfig(harborPath));
    named.billed_party_role = "nvocc_passthrough";
    named.nvocc = "North Bay Forwarding";
    expect(loadCustomerConfig(writeYaml("passthrough", named)).nvocc).toBe("North Bay Forwarding");
  });

  it("rejects an authorization that ends before it starts", () => {
    const doc = documentOf(loadCustomerConfig(harborPath));
    (doc.authorization as { valid_until: string }).valid_until = "2027-01-01";
    expect(problemsOf(writeYaml("auth-dates", doc))).toEqual([
      { path: "authorization.valid_until", message: "valid_until is before signed_on" },
    ]);
  });

  it("rejects a contract that ends before it starts", () => {
    const doc = documentOf(loadCustomerConfig(harborPath));
    const term = firstTerm(doc);
    term.valid_from = "2026-03-01";
    term.valid_to = "2026-02-01";
    expect(problemsOf(writeYaml("term-dates", doc))).toEqual([
      { path: "contract_terms.0.valid_to", message: "valid_to is before valid_from" },
    ]);
  });

  it("rejects a contract for a billing party that is not covered", () => {
    const doc = documentOf(loadCustomerConfig(harborPath));
    firstTerm(doc).billing_party = "other_line";
    expect(problemsOf(writeYaml("term-party", doc))).toEqual([
      { path: "contract_terms.0.billing_party", message: "other_line is not in authorization.covers" },
    ]);
  });

  it("allows stored consent with no terms, and no terms without consent", () => {
    const consented = documentOf(loadCustomerConfig(harborPath));
    delete consented.contract_terms;
    const loaded = loadCustomerConfig(writeYaml("consent-empty", consented));
    expect(loaded.store_contract_terms).toBe(true);
    expect(loaded.contract_terms).toBeUndefined();

    const refused = documentOf(loadCustomerConfig(harborPath));
    refused.store_contract_terms = false;
    delete refused.contract_terms;
    const without = loadCustomerConfig(writeYaml("no-terms", refused));
    expect(without.store_contract_terms).toBe(false);
    expect(without.contract_terms).toBeUndefined();
  });

  it("allows a gap, and the same days on demurrage and detention", () => {
    const doc = documentOf(loadCustomerConfig(harborPath));
    const rates = firstTerm(doc).rates as Record<string, unknown>[];
    const open = rates[1];
    if (open === undefined) throw new Error("missing open tier");
    open.from_day = 6;
    rates.push({ charge: "detention", from_day: 1, to_day: 4, per_day: "80.00", currency: "USD" });
    const loaded = loadCustomerConfig(writeYaml("gap", doc));
    expect(loaded.contract_terms?.[0]?.rates.map((rate) => rate.charge)).toEqual([
      "demurrage",
      "demurrage",
      "detention",
    ]);
  });

  it("treats a tier with no end as running to the end", () => {
    const doc = documentOf(loadCustomerConfig(harborPath));
    firstTerm(doc).rates = [
      { charge: "demurrage", from_day: 1, per_day: "150.00", currency: "USD" },
      { charge: "demurrage", from_day: 5, per_day: "250.00", currency: "USD" },
    ];
    expect(problemsOf(writeYaml("open-overlap", doc))).toEqual([
      { path: "contract_terms.0.rates.1", message: "demurrage 1- overlaps demurrage 5-" },
    ]);
  });

  it("rejects overlapping tiers across contracts for the same party when the dates overlap", () => {
    const doc = documentOf(loadCustomerConfig(harborPath));
    const term = firstTerm(doc);
    const second = structuredClone(term);
    second.valid_from = "2026-02-10";
    second.valid_to = "2026-02-20";
    second.rates = [{ charge: "demurrage", from_day: 1, to_day: 3, per_day: "150.00", currency: "USD" }];
    doc.contract_terms = [term, second];
    expect(problemsOf(writeYaml("cross", doc))).toEqual([
      {
        path: "contract_terms.1.rates.0",
        message: "demurrage 1-4 overlaps demurrage 1-3 in contract_terms.0",
      },
    ]);
  });

  it("allows the same days when the contracts do not share a party or dates", () => {
    const dated = documentOf(loadCustomerConfig(harborPath));
    const later = structuredClone(firstTerm(dated));
    later.valid_from = "2026-03-01";
    later.valid_to = "2026-03-31";
    dated.contract_terms = [firstTerm(dated), later];
    expect(loadCustomerConfig(writeYaml("later-contract", dated)).contract_terms).toHaveLength(2);

    const otherParty = documentOf(loadCustomerConfig(harborPath));
    const cobalt = structuredClone(firstTerm(otherParty));
    cobalt.billing_party = "cobalt_line";
    otherParty.contract_terms = [firstTerm(otherParty), cobalt];
    const loaded = loadCustomerConfig(writeYaml("other-party", otherParty));
    expect(loaded.contract_terms?.map((term) => term.billing_party)).toEqual(["sample_line", "cobalt_line"]);
  });

  it("accepts business days without a holiday calendar", () => {
    const doc = documentOf(loadCustomerConfig(harborPath));
    (firstTerm(doc).demurrage as { day_basis: string }).day_basis = "business";
    const loaded = loadCustomerConfig(writeYaml("business", doc));
    expect(loaded.contract_terms?.[0]?.demurrage.day_basis).toBe("business");
  });

  it("rejects a tier whose to_day is before from_day", () => {
    const doc = documentOf(loadCustomerConfig(harborPath));
    const first = (firstTerm(doc).rates as Record<string, unknown>[])[0];
    if (first === undefined) throw new Error("missing tier");
    first.from_day = 4;
    first.to_day = 2;
    expect(problemsOf(writeYaml("backwards", doc))).toEqual([
      { path: "contract_terms.0.rates.0.to_day", message: "to_day is before from_day" },
    ]);
  });

  it("rejects an unknown field", () => {
    const doc = documentOf(loadCustomerConfig(harborPath));
    doc.nickname = "nope";
    expect(problemsOf(writeYaml("unknown", doc))).toEqual([{ path: "nickname", message: "is not a field" }]);
  });

  it("rejects a missing file, a non-mapping, and invalid YAML", () => {
    const missing = path.join(os.tmpdir(), "dd-config-missing", "no-such.yaml");
    expect(problemsOf(missing)).toEqual([{ path: "document", message: "file not found" }]);
    expect(problemsOf(writeRaw("list.yaml", "[]\n"))).toEqual([{ path: "document", message: "must be a mapping" }]);
    expect(problemsOf(writeRaw("bad.yaml", "fee_pct: [\n"))).toEqual([
      { path: "document", message: "is not valid YAML" },
    ]);
  });
});

function documentOf(config: CustomerConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}

function firstTerm(doc: Record<string, unknown>): Record<string, unknown> {
  const terms = doc.contract_terms;
  const term = Array.isArray(terms) ? terms[0] : undefined;
  if (typeof term !== "object" || term === null) throw new Error("missing contract term");
  return term as Record<string, unknown>;
}

function writeYaml(name: string, document: unknown): string {
  return writeRaw(`${name}.yaml`, stringify(document, { schema: "core" }));
}

function writeRaw(name: string, text: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-config-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
}

function thrown(file: string): CustomerConfigError {
  try {
    loadCustomerConfig(file);
  } catch (error) {
    expect(error).toBeInstanceOf(CustomerConfigError);
    if (error instanceof CustomerConfigError) return error;
  }
  throw new Error(`expected ${file} to fail`);
}

function problemsOf(file: string): ConfigProblem[] {
  const error = thrown(file);
  expect(error.filePath).toBe(file);
  expect(error.message.startsWith(`${file}:`)).toBe(true);
  for (const problem of error.problems) {
    expect(error.message).toContain(`${file}: ${problem.path}: ${problem.message}`);
  }
  return [...error.problems];
}
