import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ELEMENT_KEYS, type ElementKey } from "../elements.js";
import { assignPresence } from "../presence.js";
import { carryDecisions, isConfirmedAbsent, loadReview, startReview, type ConfirmedAbsent, type SavedDecision } from "../review.js";
import { requiredElements, type RuleInvoice } from "./requiredElements.js";
import {
  fixtureTruthSchema,
  pageExtractionSchema,
  type ElementRecord,
  type ElementValue,
  type FixtureTruth,
  type PageExtraction,
  type PrintedChargeLine,
  type StitchedInvoice,
} from "../schema.js";
import { stitch } from "../stitch.js";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/synthetic");
const removed = ["free_time_start", "free_time_end", "cert_rules_compliance", "cert_no_contribution"] as const;
const when = "2026-11-09T21:13:00Z";
const name = "Reviewer";

describe("requiredElements", () => {
  it("is not evaluable before review and finds the four confirmed absences after", () => {
    const { invoice, elements } = prepared("missing_elements");
    const lines = ruleLines(invoice);
    const before = requiredElements(ruleInvoice(elements, lines));
    expect(before).toEqual({ outcome: "not_evaluable" });

    const session = startReview({
      documentHash: "hash-missing",
      invoice,
      elements,
      pages: 1,
      name,
      at: when,
    });
    session.acknowledge(1);
    for (const key of removed) session.confirmAbsent(key);
    session.approveLines();
    const reviewed = session.finish();
    const after = requiredElements(ruleInvoice(reviewed.elements, lines));
    expect(after).toEqual({
      outcome: "finding",
      finding: expect.objectContaining({
        rule: "R1",
        rule_version: 1,
        ground: "missing_information",
        citations: [
          "46 CFR 541.6(b)(4)",
          "46 CFR 541.6(b)(5)",
          "46 CFR 541.6(e)(1)",
          "46 CFR 541.6(e)(2)",
        ],
        invoice_id: "SYN-1002",
        line_ids: ["ln_1"],
        disputable_amount: "300.00",
        currency: "USD",
        evidence: removed.map((key) => ({ page: null, field: key })),
        expected: "Free time start; Free time end; Rules certification; No-contribution certification",
        actual: "confirmed absent",
        explain: "Confirmed absent: Free time start; Free time end; Rules certification; No-contribution certification. Invoice total 300.00 USD.",
      }),
    });
    expect(JSON.stringify(after)).not.toContain("The charges are consistent");
    expect(JSON.stringify(after)).not.toContain("did not cause or contribute");

    const loaded = loadReview(JSON.parse(JSON.stringify(reviewed)), 1);
    expect(requiredElements(ruleInvoice(loaded.elements, lines))).toEqual(after);

    const forged: SavedDecision = {
      document_hash: "hash-missing",
      element_key: "free_time_start",
      extracted_text: null,
      outcome: "confirmed_absent",
      page: null,
      decided_by: name,
      decided_at: when,
    };
    const carried = carryDecisions("hash-missing", [forged], elements, invoice);
    expect(isConfirmedAbsent(carried.elements.free_time_start)).toBe(false);
    expect(requiredElements(ruleInvoice(carried.elements, lines))).toEqual({ outcome: "not_evaluable" });
  });

  it("does not read an unreadable element", () => {
    const { invoice, elements } = prepared("missing_elements");
    const unread: ElementRecord = {
      ...elements,
      bl_number: { state: "unreadable", text: "SECRET-UNREADABLE", page: 1 },
    };
    const result = requiredElements(ruleInvoice(unread, ruleLines(invoice)));
    expect(result).toEqual({ outcome: "not_evaluable" });
    expect(JSON.stringify(result)).not.toContain("SECRET-UNREADABLE");
  });

  it("cites free-time start and the two certifications", () => {
    const { invoice, elements } = prepared("missing_elements");
    const withEnd: ElementRecord = {
      ...elements,
      free_time_end: { state: "present", text: "2026-06-12", value: "2026-06-12", page: 1 },
    };
    const session = startReview({
      documentHash: "hash-missing",
      invoice,
      elements: withEnd,
      pages: 1,
      name,
      at: when,
    });
    session.acknowledge(1);
    session.confirmAbsent("free_time_start");
    session.confirmAbsent("cert_rules_compliance");
    session.confirmAbsent("cert_no_contribution");
    session.approveLines();
    const result = requiredElements(ruleInvoice(session.finish().elements, ruleLines(invoice)));
    expect(result.outcome).toBe("finding");
    if (result.outcome !== "finding") return;
    expect(result.finding.citations).toEqual([
      "46 CFR 541.6(b)(4)",
      "46 CFR 541.6(e)(1)",
      "46 CFR 541.6(e)(2)",
    ]);
  });

  it("sums the charge lines when the total is confirmed absent", () => {
    const { invoice, elements } = prepared("missing_elements");
    const missingTotal: ElementRecord = {
      ...elements,
      total_due: { state: "suggested_absent", page: null },
    };
    const session = startReview({
      documentHash: "hash-missing",
      invoice,
      elements: missingTotal,
      pages: 1,
      name,
      at: when,
    });
    session.acknowledge(1);
    for (const key of ELEMENT_KEYS) {
      const element = session.view().elements[key];
      if (!isConfirmedAbsent(element) && element.state === "suggested_absent") session.confirmAbsent(key);
    }
    session.approveLines();
    const reviewed = session.finish().elements;
    const lines = [
      { id: "ln_1", amount: "100.10" },
      { id: "ln_2", amount: "50.20 USD" },
    ];
    const result = requiredElements(ruleInvoice(reviewed, lines));
    expect(result.outcome).toBe("finding");
    if (result.outcome !== "finding") return;
    expect(result.finding.disputable_amount).toBe("150.30");
    expect(result.finding.citations).toContain("46 CFR 541.6(c)(1)");
    expect(result.finding.explain.endsWith("Invoice total not printed; charge lines sum to 150.30 USD.")).toBe(true);
    expect(result.finding.line_ids).toEqual(["ln_1", "ln_2"]);

    expect(requiredElements(ruleInvoice(reviewed, [
      { id: "ln_1", amount: "100.10" },
      { id: "ln_2", amount: "not-money" },
    ]))).toEqual({ outcome: "not_evaluable" });
    expect(requiredElements(ruleInvoice(reviewed, [
      { id: "ln_1", amount: "100.10 USD" },
      { id: "ln_2", amount: "50.20 EUR" },
    ]))).toEqual({ outcome: "not_evaluable" });
    expect(requiredElements(ruleInvoice(reviewed, []))).toEqual({ outcome: "not_evaluable" });
  });

  it("returns none when every applicable element is present", () => {
    const { invoice, elements } = prepared("missing_elements");
    const complete: ElementRecord = { ...elements };
    for (const key of removed) {
      complete[key] = { state: "present", text: "shown", page: 1 };
    }
    const result = requiredElements(ruleInvoice(complete, ruleLines(invoice)));
    expect(result).toEqual({ outcome: "none" });
    expect(elements.earliest_return_date).toEqual({ state: "not_applicable", page: null });
  });
});

function ruleInvoice(
  elements: Record<ElementKey, ElementValue | ConfirmedAbsent>,
  lines: RuleInvoice["lines"],
): RuleInvoice {
  return { invoice_number: "SYN-1002", currency: "USD", lines, elements };
}

function ruleLines(invoice: StitchedInvoice): RuleInvoice["lines"] {
  return invoice.charge_lines.map((line) => ({ id: line.id, amount: line.amount.text }));
}

function prepared(id: string): { invoice: StitchedInvoice; elements: ElementRecord } {
  const truth = fixtureTruthSchema.parse(JSON.parse(fs.readFileSync(path.join(fixtureDir, `${id}.json`), "utf8"))) as FixtureTruth;
  const invoice = stitch(pagesFromPrinted(truth));
  return { invoice, elements: assignPresence(invoice, "import") };
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
