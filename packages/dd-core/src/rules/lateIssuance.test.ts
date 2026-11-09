import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ELEMENT_KEYS } from "../elements.js";
import { dayCount } from "../normalize/dates.js";
import { assignPresence } from "../presence.js";
import { lateIssuance, type LateInvoice } from "./lateIssuance.js";
import {
  fixtureTruthSchema,
  pageExtractionSchema,
  type ElementRecord,
  type FixtureTruth,
  type PageExtraction,
  type PrintedChargeLine,
  type StitchedInvoice,
} from "../schema.js";
import { stitch } from "../stitch.js";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/synthetic");
const direct = { billed_party_role: "direct" } as const;
const explain = "Charges were last incurred on 2026-03-02. The invoice is dated 2026-04-08, 37 days later.";

describe("lateIssuance", () => {
  it("flags 2026-04-08 under both conventions with the same calendar gap", () => {
    const invoice = lateInvoice();
    const day0 = lateIssuance(invoice, direct, "day0");
    const day1 = lateIssuance(invoice, direct, "day1");
    expect(dayCount("2026-03-02", "2026-04-01", "day0")).toBe(30);
    expect(dayCount("2026-03-02", "2026-03-31", "day1")).toBe(30);

    expect(day0).toMatchObject({
      outcome: "finding",
      convention_sensitive: false,
      finding: {
        rule: "R2",
        rule_version: 1,
        ground: "late_invoice",
        citations: ["46 CFR 541.7(a)"],
        invoice_id: "SYN-1003",
        line_ids: ["ln_1"],
        disputable_amount: "1100.00",
        currency: "USD",
        convention: "day0",
        expected: "issued by 2026-04-01 (counting 2026-03-02 as day 0)",
        actual: "issued 2026-04-08",
        explain,
        evidence: [
          { page: 1, field: "invoice_date" },
          { page: 1, field: "charged_to" },
        ],
      },
    });
    expect(day1).toMatchObject({
      outcome: "finding",
      convention_sensitive: false,
      finding: {
        convention: "day1",
        expected: "issued by 2026-03-31 (counting 2026-03-02 as day 1)",
        actual: "issued 2026-04-08",
        explain,
      },
    });
    if (day0.outcome !== "finding" || day1.outcome !== "finding") return;
    expect(day0.finding.convention).not.toBe(day1.finding.convention);
    expect(day0.finding.explain).toBe(day1.finding.explain);
  });

  it("is on time under day 0 and late under day 1 on 2026-04-01", () => {
    const invoice = lateInvoice();
    invoice.elements = {
      ...invoice.elements,
      invoice_date: { state: "present", text: "2026-04-01", value: "2026-04-01", page: 1 },
    };
    expect(lateIssuance(invoice, direct, "day0")).toEqual({ outcome: "none", convention_sensitive: true });
    const day1 = lateIssuance(invoice, direct, "day1");
    expect(day1).toMatchObject({
      outcome: "finding",
      convention_sensitive: true,
      finding: {
        convention: "day1",
        expected: "issued by 2026-03-31 (counting 2026-03-02 as day 1)",
        actual: "issued 2026-04-01",
        explain: "Charges were last incurred on 2026-03-02. The invoice is dated 2026-04-01, 30 days later.",
      },
    });
  });

  it("uses the latest charged_to", () => {
    const invoice = lateInvoice();
    invoice.lines = [
      { id: "ln_2", charged_to: "2026-02-20", page: 1 },
      { id: "ln_1", charged_to: "2026-03-02", page: 2 },
    ];
    const result = lateIssuance(invoice, direct, "day0");
    expect(result).toMatchObject({
      outcome: "finding",
      finding: {
        line_ids: ["ln_2", "ln_1"],
        evidence: [
          { page: 1, field: "invoice_date" },
          { page: 2, field: "charged_to" },
        ],
      },
    });
  });

  it("does not read an unreadable element", () => {
    const invoice = lateInvoice();
    invoice.elements = {
      ...invoice.elements,
      bl_number: { state: "unreadable", text: "SECRET-UNREADABLE", page: 1 },
    };
    const result = lateIssuance(invoice, direct, "day0");
    expect(result).toEqual({ outcome: "not_evaluable" });
    expect(JSON.stringify(result)).not.toContain("SECRET-UNREADABLE");
  });

  it("returns needs_info for an NVOCC until the carrier invoice date has a source", () => {
    const invoice = lateInvoice();
    expect(lateIssuance(invoice, { billed_party_role: "nvocc_passthrough" }, "day0")).toEqual({ outcome: "needs_info" });
    expect(lateIssuance(invoice, { billed_party_role: "nvocc_passthrough" }, "day1")).toEqual({ outcome: "needs_info" });
  });

  it("is not evaluable without a charge line or a parseable charged_to", () => {
    const invoice = lateInvoice();
    invoice.lines = [];
    expect(lateIssuance(invoice, direct, "day0")).toEqual({ outcome: "not_evaluable" });
    invoice.lines = [{ id: "ln_1", charged_to: "03/02/2026", page: 1 }];
    expect(lateIssuance(invoice, direct, "day0")).toEqual({ outcome: "not_evaluable" });
  });
});

function lateInvoice(): LateInvoice {
  const { invoice, elements } = prepared("late_37");
  return {
    invoice_number: "SYN-1003",
    currency: "USD",
    elements,
    lines: invoice.charge_lines.map((line) => ({
      id: line.id,
      charged_to: line.charged_to?.text ?? "",
      page: line.charged_to?.page ?? line.amount.page,
    })),
  };
}

function prepared(id: string): { invoice: StitchedInvoice; elements: ElementRecord } {
  const truth = fixtureTruthSchema.parse(JSON.parse(fs.readFileSync(path.join(fixtureDir, `${id}.json`), "utf8"))) as FixtureTruth;
  const stitched = stitch(pagesFromPrinted(truth));
  return { invoice: stitched, elements: assignPresence(stitched, "import") };
}

function pagesFromPrinted(truth: FixtureTruth): PageExtraction[] {
  const elements: PageExtraction["elements"] = {};
  for (const key of ELEMENT_KEYS) {
    const element = truth.elements[key];
    if (element.state !== "present" || element.page === null || element.text === undefined || element.text === "") continue;
    elements[key] = { text: element.text, page: element.page };
  }
  const charge_lines: PrintedChargeLine[] = truth.charge_lines
    .filter((line) => line.placement.kind === "row")
    .map((line) => ({
      page: line.placement.kind === "row" ? line.placement.page : 1,
      container: line.container,
      charge: line.charge,
      charged_from: line.charged_from,
      charged_to: line.charged_to,
      days: line.days,
      rate: line.rate,
      amount: line.amount,
    }));
  return [
    pageExtractionSchema.parse({
      page: 1,
      invoice_number: truth.invoice_number,
      billing_party: truth.billing_party,
      billed_party: truth.billed_party,
      currency: truth.currency,
      elements,
      charge_lines,
    }),
  ];
}
