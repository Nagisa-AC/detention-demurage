import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ELEMENT_KEYS } from "../elements.js";
import { dayCount } from "../normalize/dates.js";
import { assignPresence } from "../presence.js";
import { startReview } from "../review.js";
import { arithmetic, type ArithmeticInvoice, type ArithmeticLine } from "./arithmetic.js";
import {
  fixtureTruthSchema,
  pageExtractionSchema,
  type ElementKey,
  type FixtureTruth,
  type PageExtraction,
  type PrintedChargeLine,
  type StitchedInvoice,
} from "../schema.js";
import { stitch } from "../stitch.js";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/synthetic");
const citation = "Sample Line Logistics demurrage schedule SL-1";
const cleanIds = ["clean", "late_37", "free_time_overbill", "duplicate_a", "duplicate_b"] as const;
const when = "2026-11-09T23:19:00Z";
const name = "Reviewer";

describe("arithmetic", () => {
  it("reports the 250 line error and the 250 total error separately", () => {
    expect(dayCount("2026-04-05", "2026-04-10", "day1")).toBe(6);
    expect(dayCount("2026-04-11", "2026-04-20", "day1")).toBe(10);
    expect(arithmetic(preparedInvoice("arithmetic"))).toEqual({
      outcome: "finding",
      findings: [
        {
          rule: "R4",
          rule_version: 1,
          ground: "billing_error",
          citations: [citation],
          invoice_id: "SYN-1005",
          line_ids: ["ln_1"],
          expected: "6 days, 1500.00 USD",
          actual: "printed 6 days, 1750.00 USD",
          disputable_amount: "250.00",
          currency: "USD",
          evidence: [
            { page: 1, field: "charged_from" },
            { page: 1, field: "charged_to" },
            { page: 1, field: "days" },
            { page: 1, field: "rate" },
            { page: 1, field: "amount" },
          ],
          explain:
            "2026-04-05 through 2026-04-10 is 6 days. 6 × 250.00 USD is 1500.00 USD. The line amount is 1750.00 USD.",
        },
        {
          rule: "R4",
          rule_version: 1,
          ground: "billing_error",
          citations: [citation],
          invoice_id: "SYN-1005",
          line_ids: ["ln_1", "ln_2"],
          expected: "3200.00 USD",
          actual: "3450.00 USD",
          disputable_amount: "250.00",
          currency: "USD",
          evidence: [
            { page: 1, field: "total_due" },
            { page: 1, field: "amount" },
            { page: 1, field: "amount" },
          ],
          explain: "The charge lines sum to 3200.00 USD. The invoice total is 3450.00 USD.",
        },
      ],
    });
  });

  it("returns none when every other complete fixture multiplies cleanly", () => {
    for (const id of cleanIds) {
      expect(arithmetic(preparedInvoice(id))).toEqual({ outcome: "none" });
    }
  });

  it("returns none for the joined split row", () => {
    const invoice = preparedInvoice("split_row");
    expect(invoice.unresolved).toEqual([]);
    expect(invoice.lines.some((line) => line.amount_page === 3)).toBe(true);
    expect(arithmetic(invoice)).toEqual({ outcome: "none" });
  });

  it("is not evaluable while an element is still suggested absent", () => {
    expect(arithmetic(preparedInvoice("missing_elements"))).toEqual({ outcome: "not_evaluable" });
  });

  it("stays silent when the day count is wrong and the amount matches the span", () => {
    const invoice = mapLines(preparedInvoice("clean"), (line) => ({ ...line, days: "9" }));
    expect(arithmetic(invoice)).toEqual({ outcome: "none" });
  });

  it("names a wrong day count when the amount is also wrong", () => {
    const invoice = mapLines(preparedInvoice("arithmetic"), (line, index) =>
      index === 0 ? { ...line, days: "8" } : line,
    );
    const result = arithmetic(invoice);
    expect(result).toMatchObject({
      outcome: "finding",
      findings: [
        {
          line_ids: ["ln_1"],
          disputable_amount: "250.00",
          actual: "printed 8 days, 1750.00 USD",
          explain:
            "2026-04-05 through 2026-04-10 is 6 days. The line says 8 days. 6 × 250.00 USD is 1500.00 USD. The line amount is 1750.00 USD.",
        },
        { line_ids: ["ln_1", "ln_2"], disputable_amount: "250.00" },
      ],
    });
  });

  it("uses the absolute difference when a line is under its product", () => {
    const invoice = mapLines(preparedInvoice("arithmetic"), (line, index) =>
      index === 0 ? { ...line, amount: "1000.00" } : line,
    );
    expect(arithmetic(invoice)).toMatchObject({
      outcome: "finding",
      findings: [
        { line_ids: ["ln_1"], disputable_amount: "500.00", actual: "printed 6 days, 1000.00 USD" },
        { line_ids: ["ln_1", "ln_2"], disputable_amount: "1000.00", expected: "2450.00 USD" },
      ],
    });
  });

  it("is not evaluable for an unresolved fragment, another currency, or an unreadable element", () => {
    const clean = preparedInvoice("clean");
    expect(arithmetic({ ...clean, unresolved: [{ page: 1 }] })).toEqual({ outcome: "not_evaluable" });
    expect(arithmetic({ ...clean, lines: [] })).toEqual({ outcome: "not_evaluable" });

    const euros = mapLines(preparedInvoice("arithmetic"), (line, index) =>
      index === 0 ? { ...line, amount: "1750.00 EUR" } : line,
    );
    expect(arithmetic(euros)).toEqual({ outcome: "not_evaluable" });

    const unreadable = preparedInvoice("arithmetic");
    unreadable.elements = {
      ...unreadable.elements,
      bl_number: { state: "unreadable", text: "SECRET-UNREADABLE", page: 1 },
    };
    const result = arithmetic(unreadable);
    expect(result).toEqual({ outcome: "not_evaluable" });
    expect(JSON.stringify(result)).not.toContain("SECRET-UNREADABLE");
  });

  it("is not evaluable when the applicable rule is confirmed absent", () => {
    const result = arithmetic(confirmedAbsent("arithmetic", "applicable_rule"));
    expect(result).toEqual({ outcome: "not_evaluable" });
    expect(JSON.stringify(result)).not.toContain(citation);
  });

  it("skips the total when it is confirmed absent and still reports a bad line", () => {
    expect(arithmetic(confirmedAbsent("clean", "total_due"))).toEqual({ outcome: "not_evaluable" });
    expect(arithmetic(confirmedAbsent("arithmetic", "total_due"))).toMatchObject({
      outcome: "finding",
      findings: [{ line_ids: ["ln_1"], disputable_amount: "250.00" }],
    });
    const onlyLine = arithmetic(confirmedAbsent("arithmetic", "total_due"));
    if (onlyLine.outcome !== "finding") return;
    expect(onlyLine.findings).toHaveLength(1);
  });

  it("accepts a rate that already names the invoice currency", () => {
    const invoice = mapLines(preparedInvoice("clean"), (line) => ({ ...line, rate: "150.00 USD" }));
    expect(arithmetic(invoice)).toEqual({ outcome: "none" });
  });
});

function confirmedAbsent(id: string, key: ElementKey): ArithmeticInvoice {
  const invoice = preparedInvoice(id);
  const { invoice: stitched } = prepared(id);
  const stripped = structuredClone(stitched);
  delete stripped.elements[key];
  const elements = assignPresence(stripped, "import");
  const session = startReview({
    documentHash: `hash-${id}-${key}`,
    invoice: stripped,
    elements,
    pages: readTruth(id).pages,
    name,
    at: when,
  });
  for (let page = 1; page <= readTruth(id).pages; page += 1) session.acknowledge(page);
  session.confirmAbsent(key);
  session.approveLines();
  return { ...invoice, elements: session.finish().elements };
}

function preparedInvoice(id: string): ArithmeticInvoice {
  const { invoice, elements } = prepared(id);
  return {
    invoice_number: invoice.invoice_number?.text ?? "",
    currency: invoice.currency?.text ?? "",
    elements,
    lines: toLines(invoice),
    unresolved: invoice.unresolved,
  };
}

function mapLines(invoice: ArithmeticInvoice, edit: (line: ArithmeticLine, index: number) => ArithmeticLine): ArithmeticInvoice {
  return { ...invoice, lines: invoice.lines.map(edit) };
}

function toLines(invoice: StitchedInvoice): ArithmeticLine[] {
  return invoice.charge_lines.map((line) => ({
    id: line.id,
    charged_from: line.charged_from?.text ?? "",
    charged_to: line.charged_to?.text ?? "",
    days: line.days?.text ?? "",
    rate: line.rate?.text ?? "",
    amount: line.amount.text,
    from_page: line.charged_from?.page ?? 0,
    to_page: line.charged_to?.page ?? 0,
    days_page: line.days?.page ?? 0,
    rate_page: line.rate?.page ?? 0,
    amount_page: line.amount.page,
  }));
}

function prepared(id: string): { invoice: StitchedInvoice; elements: ReturnType<typeof assignPresence> } {
  const stitched = stitch(pagesFromTruth(readTruth(id)));
  return { invoice: stitched, elements: assignPresence(stitched, "import") };
}

function readTruth(id: string): FixtureTruth {
  return fixtureTruthSchema.parse(JSON.parse(fs.readFileSync(path.join(fixtureDir, `${id}.json`), "utf8"))) as FixtureTruth;
}

function pagesFromTruth(truth: FixtureTruth): PageExtraction[] {
  const buckets = new Map<number, { elements: PageExtraction["elements"]; charge_lines: PrintedChargeLine[] }>();
  for (let number = 1; number <= truth.pages; number += 1) {
    buckets.set(number, { elements: {}, charge_lines: [] });
  }
  for (const key of ELEMENT_KEYS) {
    const element = truth.elements[key];
    if (element.state !== "present" || element.page === null || element.text === undefined || element.text === "") continue;
    const bucket = buckets.get(element.page);
    if (bucket === undefined) continue;
    bucket.elements[key] = { text: element.text, page: element.page };
  }
  for (const entry of truth.charge_lines) {
    if (entry.placement.kind === "row") {
      buckets.get(entry.placement.page)?.charge_lines.push({
        page: entry.placement.page,
        container: entry.container,
        charge: entry.charge,
        charged_from: entry.charged_from,
        charged_to: entry.charged_to,
        days: entry.days,
        rate: entry.rate,
        amount: entry.amount,
      });
      continue;
    }
    buckets.get(entry.placement.head_page)?.charge_lines.push({
      page: entry.placement.head_page,
      container: entry.container,
      charge: entry.charge,
      charged_from: entry.charged_from,
      charged_to: entry.charged_to,
      days: entry.days,
      rate: entry.rate,
    });
    buckets.get(entry.placement.tail_page)?.charge_lines.push({
      page: entry.placement.tail_page,
      amount: entry.amount,
    });
  }
  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([number, bucket]) => {
      const value: Record<string, unknown> = {
        page: number,
        elements: bucket.elements,
        charge_lines: bucket.charge_lines,
      };
      if (number === 1) {
        value["invoice_number"] = truth.invoice_number;
        value["billing_party"] = truth.billing_party;
        value["billed_party"] = truth.billed_party;
        value["currency"] = truth.currency;
      }
      return pageExtractionSchema.parse(value);
    });
}
