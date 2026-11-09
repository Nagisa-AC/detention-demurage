import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ELEMENT_KEYS,
  chargeLineSchema,
  elementValueSchema,
  findingSchema,
  fixtureTruthSchema,
  invoiceExtractionSchema,
  printedChargeLineSchema,
  printedElementSchema,
  type Finding,
} from "./schema.js";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/synthetic");

const fixtureIds = [
  "clean",
  "missing_elements",
  "late_37",
  "free_time_overbill",
  "arithmetic",
  "duplicate_a",
  "duplicate_b",
  "split_row",
];

function readFixture(id: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, `${id}.json`), "utf8")) as unknown;
}

const applicableRule = "Sample Line Logistics demurrage schedule SL-1";

const chargeLine = {
  id: "ln_1",
  container: "SLLU0000053",
  charge: "demurrage" as const,
  charged_from: "2026-04-05",
  charged_to: "2026-04-10",
  days: 6,
  rate: "250.00",
  amount: "1750.00",
};

function finding(overrides: Partial<Finding> = {}): Record<string, unknown> {
  return {
    rule: "R4",
    rule_version: 1,
    ground: "billing_error",
    citations: [applicableRule],
    invoice_id: "SYN-1005",
    line_ids: [chargeLine.id],
    expected: "1500.00",
    actual: "1750.00",
    disputable_amount: "250.00",
    currency: "USD",
    evidence: [{ page: 1, field: "amount" }],
    explain: "6 days at 250.00 were billed as 1750.00.",
    ...overrides,
  };
}

describe("schema", () => {
  it("names the twenty 541.6 elements in paragraph order", () => {
    const source = fs.readFileSync(path.join(fixtureDir, "labels.mjs"), "utf8");
    const listed = [...source.matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]);
    const fixtureKeys = listed.slice(0, ELEMENT_KEYS.length);
    expect(fixtureKeys).toEqual([...ELEMENT_KEYS]);
    expect(ELEMENT_KEYS).toHaveLength(20);
  });

  it("parses the eight truth files", () => {
    expect(fixtureIds).toHaveLength(8);
    for (const id of fixtureIds) {
      const parsed = fixtureTruthSchema.safeParse(readFixture(id));
      expect(parsed.success, id).toBe(true);
    }
    const clean = readFixture("clean") as Record<string, unknown>;
    expect(fixtureTruthSchema.safeParse({ ...clean, extra: true }).success).toBe(false);
  });

  it("reads one printed page at a time, including a split tail that is only an amount", () => {
    expect(printedChargeLineSchema.parse({ page: 3, amount: "300.00" })).toEqual({
      page: 3,
      amount: "300.00",
    });
    const printed = invoiceExtractionSchema.parse([
      {
        page: 1,
        invoice_number: "SYN-1001",
        billing_party: "Sample Line Logistics",
        billed_party: "Harbor Home Goods",
        currency: "USD",
        elements: {
          invoice_date: { text: "January 20, 2026", page: 1 },
          rates: { text: "150.00 USD per day", page: 1, region: { x: 0, y: 0.4, w: 1, h: 0.05 } },
        },
        charge_lines: [
          {
            page: 1,
            container: "SLLU0000011",
            charge: "demurrage",
            charged_from: "10 Jan 2026",
            charged_to: "12 Jan 2026",
            days: "3",
            rate: "$150.00",
            amount: "$450.00",
          },
        ],
      },
      {
        page: 3,
        elements: {},
        charge_lines: [{ page: 3, amount: "300.00" }],
      },
    ]);
    expect(printed).toHaveLength(2);
    expect(printed[0]?.charge_lines[0]?.days).toBe("3");
    expect(printed[1]?.charge_lines[0]?.amount).toBe("300.00");
    expect(
      invoiceExtractionSchema.safeParse([
        {
          page: 1,
          elements: { invoice_date: { text: "2026-01-20", page: 1, state: "present" } },
          charge_lines: [],
        },
      ]).success,
    ).toBe(false);
    expect(
      invoiceExtractionSchema.safeParse([
        {
          page: 1,
          elements: {},
          charge_lines: [{ page: 1, amount: "450.00", id: "ln_1" }],
        },
      ]).success,
    ).toBe(false);
    expect(
      invoiceExtractionSchema.safeParse([
        {
          page: 1,
          elements: {},
          charge_lines: [{ page: 3, amount: "300.00" }],
        },
      ]).success,
    ).toBe(false);
  });

  it("normalizes a charge line and requires the stitch id", () => {
    expect(chargeLineSchema.parse(chargeLine).days).toBe(6);
    expect(chargeLineSchema.safeParse({ ...chargeLine, id: undefined }).success).toBe(false);
    expect(chargeLineSchema.safeParse({ ...chargeLine, days: "6" }).success).toBe(false);
    expect(chargeLineSchema.safeParse({ ...chargeLine, charged_from: "05 Apr 2026" }).success).toBe(false);
    expect(chargeLineSchema.safeParse({ ...chargeLine, amount: "1750" }).success).toBe(false);
    expect(chargeLineSchema.safeParse({ ...chargeLine, amount: "1750.00" }).success).toBe(true);
  });

  it("requires citations and evidence on a finding", () => {
    const parsed = findingSchema.parse(finding());
    expect(parsed.line_ids).toEqual([chargeLine.id]);
    expect(parsed.citations).toEqual([applicableRule]);
    const withoutCitations = finding();
    delete withoutCitations.citations;
    const withoutEvidence = finding();
    delete withoutEvidence.evidence;
    expect(findingSchema.safeParse(withoutCitations).success).toBe(false);
    expect(findingSchema.safeParse(finding({ citations: [] })).success).toBe(false);
    expect(findingSchema.safeParse(withoutEvidence).success).toBe(false);
    expect(findingSchema.safeParse(finding({ evidence: [] })).success).toBe(false);
    const late = readFixture("late_37") as { expected_findings: unknown[] };
    expect(findingSchema.safeParse(late.expected_findings[0]).success).toBe(false);
    expect(
      findingSchema.safeParse(
        finding({
          rule: "R5",
          ground: "duplicate_charge",
          citations: ["SYN-1006"],
          line_ids: ["ln_9"],
        }),
      ).success,
    ).toBe(true);
    expect(findingSchema.safeParse(finding({ rule: "R1", line_ids: [] })).success).toBe(true);
    expect(findingSchema.parse(finding()).convention).toBeUndefined();
    expect(findingSchema.parse(finding({ convention: "day1" })).convention).toBe("day1");
    expect(findingSchema.safeParse({ ...finding(), convention: "day2" }).success).toBe(false);
    expect(
      findingSchema.parse(
        finding({
          rule: "R1",
          ground: "missing_information",
          line_ids: [],
          evidence: [{ page: null, field: "free_time_start" }],
        }),
      ).evidence,
    ).toEqual([{ page: null, field: "free_time_start" }]);
  });

  it("keeps region inside the page and confirmed_absent out of the state enum", () => {
    const box = { x: 0, y: 0, w: 1, h: 1 };
    expect(printedElementSchema.safeParse({ text: "2026-01-20", page: 1, region: box }).success).toBe(true);
    expect(printedElementSchema.safeParse({ text: "2026-01-20", page: 1 }).success).toBe(true);
    expect(
      printedElementSchema.safeParse({ text: "2026-01-20", page: 1, region: { ...box, x: 1.01 } }).success,
    ).toBe(false);
    expect(
      printedElementSchema.safeParse({ text: "2026-01-20", page: 1, region: { ...box, h: -0.01 } }).success,
    ).toBe(false);
    expect(elementValueSchema.safeParse({ state: "confirmed_absent", page: null }).success).toBe(false);
    expect(elementValueSchema.safeParse({ state: "not_applicable", page: null }).success).toBe(true);
    expect(elementValueSchema.safeParse({ state: "present", text: "2026-01-20", page: 1 }).success).toBe(true);
  });
});
