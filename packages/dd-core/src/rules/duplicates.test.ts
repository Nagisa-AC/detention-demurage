import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ELEMENT_KEYS, type ElementKey } from "../elements.js";
import { assignPresence } from "../presence.js";
import { startReview } from "../review.js";
import { duplicates, type DuplicateInvoice, type DuplicateLine, type ReissueLink } from "./duplicates.js";
import {
  fixtureTruthSchema,
  pageExtractionSchema,
  type FixtureTruth,
  type PageExtraction,
  type PrintedChargeLine,
  type StitchedInvoice,
} from "../schema.js";
import { stitch } from "../stitch.js";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/synthetic");
const citation = "Sample Line Logistics demurrage schedule SL-1";
const alone = ["clean", "late_37", "free_time_overbill", "arithmetic", "split_row", "duplicate_a", "duplicate_b"] as const;
const allIds = ["clean", "missing_elements", "late_37", "free_time_overbill", "arithmetic", "duplicate_a", "duplicate_b", "split_row"] as const;
const when = "2026-11-09T23:57:00Z";
const name = "Reviewer";

describe("duplicates", () => {
  it("puts one 600 finding on the later duplicate and none on the earlier one", () => {
    const earlier = preparedInvoice("duplicate_a");
    const later = preparedInvoice("duplicate_b");
    const links = linksFromTruth(["duplicate_a", "duplicate_b"]);
    expect(links).toEqual([]);
    const result = duplicates([earlier, later], links);
    expect(result).toEqual({
      outcome: "finding",
      not_evaluable: [],
      findings: [
        {
          rule: "R5",
          rule_version: 1,
          ground: "duplicate_charge",
          citations: [citation],
          invoice_id: "SYN-1007",
          line_ids: ["ln_1"],
          expected: "no overlapping charge with SYN-1006 (2026-03-01 through 2026-03-10)",
          actual: "3 days, 2026-03-08 through 2026-03-10, at 200.00 USD per day",
          disputable_amount: "600.00",
          currency: "USD",
          evidence: [
            { page: 1, field: "container" },
            { page: 1, field: "charged_from" },
            { page: 1, field: "charged_to" },
            { page: 1, field: "rate" },
          ],
          explain:
            "SYN-1006 charged SLLU0000069 demurrage from 2026-03-01 through 2026-03-10. Overlap on SYN-1007 is 3 days, 2026-03-08 through 2026-03-10, at 200.00 USD per day.",
        },
      ],
    });
    expect(result.outcome === "finding" && result.findings.some((finding) => finding.invoice_id === "SYN-1006")).toBe(false);
  });

  it("counts distinct days once when two earlier invoices cover the same later line", () => {
    const first = lineOn(preparedInvoice("duplicate_a"), "2026-03-08", "2026-03-10");
    const second = retitle(lineOn(preparedInvoice("duplicate_a"), "2026-03-10", "2026-03-12"), "SYN-1008", "2026-03-16");
    const later = lineOn(preparedInvoice("duplicate_b"), "2026-03-08", "2026-03-12");
    const result = duplicates([first, second, later], []);
    expect(result).toMatchObject({
      outcome: "finding",
      findings: [
        { invoice_id: "SYN-1008", disputable_amount: "200.00", line_ids: ["ln_1"] },
        { invoice_id: "SYN-1007", disputable_amount: "1000.00", line_ids: ["ln_1"] },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("1200.00");
    if (result.outcome !== "finding") return;
    const onLater = result.findings.find((finding) => finding.invoice_id === "SYN-1007");
    expect(onLater?.expected).toBe(
      "no overlapping charge with SYN-1006 (2026-03-08 through 2026-03-10); SYN-1008 (2026-03-10 through 2026-03-12)",
    );
    expect(onLater?.explain).toContain("SYN-1006");
    expect(onLater?.explain).toContain("SYN-1008");
    expect(onLater?.actual).toBe("5 days, 2026-03-08 through 2026-03-12, at 200.00 USD per day");
  });

  it("keeps a separate finding for each later line", () => {
    const earlier = lineOn(preparedInvoice("duplicate_a"), "2026-03-01", "2026-03-20");
    const later = preparedInvoice("duplicate_b");
    const first = later.lines[0];
    if (first === undefined) throw new Error("duplicate_b has a line");
    const twoLines = {
      ...later,
      lines: [
        { ...first, id: "ln_1", charged_from: "2026-03-08", charged_to: "2026-03-10" },
        { ...first, id: "ln_2", charged_from: "2026-03-12", charged_to: "2026-03-14" },
      ],
    };
    expect(duplicates([earlier, twoLines], [])).toMatchObject({
      outcome: "finding",
      findings: [
        { invoice_id: "SYN-1007", line_ids: ["ln_1"], disputable_amount: "600.00" },
        { invoice_id: "SYN-1007", line_ids: ["ln_2"], disputable_amount: "600.00" },
      ],
    });
  });

  it("requires the same billing party and the same currency", () => {
    const earlier = preparedInvoice("duplicate_a");
    const later = preparedInvoice("duplicate_b");
    expect(duplicates([earlier, { ...later, billing_party: "Cobalt Line" }], [])).toEqual({
      outcome: "none",
      not_evaluable: [],
    });
    expect(duplicates([earlier, { ...later, currency: "EUR" }], [])).toEqual({ outcome: "none", not_evaluable: [] });
  });

  it("does not treat two lines on one invoice as a duplicate", () => {
    const invoice = preparedInvoice("duplicate_a");
    const line = invoice.lines[0];
    if (line === undefined) throw new Error("duplicate_a has a line");
    const doubled = {
      ...invoice,
      lines: [line, { ...line, id: "ln_2", charged_from: "2026-03-05", charged_to: "2026-03-12" }],
    };
    expect(duplicates([doubled], [])).toEqual({ outcome: "none", not_evaluable: [] });
  });

  it("skips a confirmed reissue pair and still compares either invoice with a third", () => {
    const earlier = preparedInvoice("duplicate_a");
    const later = preparedInvoice("duplicate_b");
    const link = { invoice_number: "SYN-1007", reissue_of: "SYN-1006" };
    const reverse = { invoice_number: "SYN-1006", reissue_of: "SYN-1007" };
    expect(duplicates([earlier, later], [link])).toEqual({ outcome: "none", not_evaluable: [] });
    expect(duplicates([earlier, later], [reverse])).toEqual({ outcome: "none", not_evaluable: [] });

    const third = retitle(lineOn(preparedInvoice("duplicate_a"), "2026-03-11", "2026-03-13"), "SYN-1099", "2026-03-25");
    const result = duplicates([earlier, later, third], [link]);
    expect(result).toMatchObject({
      outcome: "finding",
      findings: [{ invoice_id: "SYN-1099", disputable_amount: "400.00" }],
    });
    if (result.outcome !== "finding") return;
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.expected).toContain("SYN-1007");
    expect(result.findings[0]?.expected).not.toContain("SYN-1006");
  });

  it("is not evaluable when the invoice dates are equal or missing", () => {
    const earlier = preparedInvoice("duplicate_a");
    const sameDay = withDate(preparedInvoice("duplicate_b"), "2026-03-15");
    expect(duplicates([earlier, sameDay], [])).toEqual({
      outcome: "not_evaluable",
      not_evaluable: ["SYN-1006", "SYN-1007"],
    });
    expect(duplicates([earlier, confirmedAbsent("duplicate_b", "invoice_date")], [])).toEqual({
      outcome: "not_evaluable",
      not_evaluable: ["SYN-1007"],
    });
  });

  it("is not evaluable when the later invoice has no applicable rule", () => {
    const result = duplicates([preparedInvoice("duplicate_a"), confirmedAbsent("duplicate_b", "applicable_rule")], []);
    expect(result).toEqual({ outcome: "not_evaluable", not_evaluable: ["SYN-1007"] });
    expect(JSON.stringify(result)).not.toContain(citation);
  });

  it("prices an exact repeat, a one-day touch, and an adjacent range", () => {
    const earlier = preparedInvoice("duplicate_a");
    const repeat = lineOn(preparedInvoice("duplicate_b"), "2026-03-01", "2026-03-10");
    expect(duplicates([earlier, repeat], [])).toMatchObject({
      findings: [{ disputable_amount: "2000.00", actual: "10 days, 2026-03-01 through 2026-03-10, at 200.00 USD per day" }],
    });
    const touch = lineOn(preparedInvoice("duplicate_b"), "2026-03-10", "2026-03-12");
    expect(duplicates([earlier, touch], [])).toMatchObject({
      findings: [{ disputable_amount: "200.00", actual: "1 day, 2026-03-10, at 200.00 USD per day" }],
    });
    const adjacent = lineOn(preparedInvoice("duplicate_b"), "2026-03-11", "2026-03-15");
    expect(duplicates([earlier, adjacent], [])).toEqual({ outcome: "none", not_evaluable: [] });
  });

  it("ignores a different charge type or a different container", () => {
    const earlier = preparedInvoice("duplicate_a");
    const later = preparedInvoice("duplicate_b");
    const line = later.lines[0];
    if (line === undefined) throw new Error("duplicate_b has a line");
    expect(duplicates([earlier, { ...later, lines: [{ ...line, charge: "detention" }] }], [])).toEqual({
      outcome: "none",
      not_evaluable: [],
    });
    expect(duplicates([earlier, { ...later, lines: [{ ...line, container: "SLLU0000099" }] }], [])).toEqual({
      outcome: "none",
      not_evaluable: [],
    });
  });

  it("returns none for the other complete fixtures and not_evaluable for missing elements", () => {
    for (const id of alone) {
      expect(duplicates([preparedInvoice(id)], [])).toEqual({ outcome: "none", not_evaluable: [] });
    }
    expect(duplicates([preparedInvoice("missing_elements")], [])).toEqual({
      outcome: "not_evaluable",
      not_evaluable: ["SYN-1002"],
    });
  });

  it("keeps the 600 finding when the full set includes an invoice that cannot be judged", () => {
    const result = duplicates(allIds.map((id) => preparedInvoice(id)), linksFromTruth([...allIds]));
    expect(result).toMatchObject({
      outcome: "finding",
      not_evaluable: ["SYN-1002"],
      findings: [{ invoice_id: "SYN-1007", disputable_amount: "600.00", citations: [citation] }],
    });
    if (result.outcome !== "finding") return;
    expect(result.findings).toHaveLength(1);
  });

  it("does not read an unreadable element, and blocks a broken rate or an unresolved fragment", () => {
    const earlier = preparedInvoice("duplicate_a");
    const later = preparedInvoice("duplicate_b");
    earlier.elements = {
      ...earlier.elements,
      bl_number: { state: "unreadable", text: "SECRET-UNREADABLE", page: 1 },
    };
    const hidden = duplicates([earlier, later], []);
    expect(hidden).toEqual({ outcome: "not_evaluable", not_evaluable: ["SYN-1006"] });
    expect(JSON.stringify(hidden)).not.toContain("SECRET-UNREADABLE");

    const line = earlier.lines[0];
    if (line === undefined) throw new Error("duplicate_a has a line");
    const priced = preparedInvoice("duplicate_a");
    expect(duplicates([{ ...priced, lines: [{ ...line, rate: "200.00 EUR" }] }, later], [])).toEqual({
      outcome: "not_evaluable",
      not_evaluable: ["SYN-1006"],
    });
    expect(duplicates([{ ...priced, unresolved: [{ page: 1 }] }, later], [])).toEqual({
      outcome: "not_evaluable",
      not_evaluable: ["SYN-1006"],
    });
  });
});

function linksFromTruth(ids: readonly string[]): ReissueLink[] {
  return ids.flatMap((id) => {
    const truth = readTruth(id);
    return truth.reissue_of === null ? [] : [{ invoice_number: truth.invoice_number, reissue_of: truth.reissue_of }];
  });
}

function lineOn(invoice: DuplicateInvoice, from: string, to: string): DuplicateInvoice {
  const line = invoice.lines[0];
  if (line === undefined) throw new Error("a line is required");
  return { ...invoice, lines: [{ ...line, charged_from: from, charged_to: to }] };
}

function retitle(invoice: DuplicateInvoice, invoiceNumber: string, iso: string): DuplicateInvoice {
  return withDate({ ...invoice, invoice_number: invoiceNumber }, iso);
}

function withDate(invoice: DuplicateInvoice, iso: string): DuplicateInvoice {
  const current = invoice.elements.invoice_date;
  if (current.state !== "present") throw new Error("invoice_date is present");
  return { ...invoice, elements: { ...invoice.elements, invoice_date: { ...current, text: iso, value: iso } } };
}

function confirmedAbsent(id: string, key: ElementKey): DuplicateInvoice {
  const invoice = preparedInvoice(id);
  const stripped = structuredClone(prepared(id).invoice);
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

function preparedInvoice(id: string): DuplicateInvoice {
  const { invoice, elements } = prepared(id);
  return {
    invoice_number: invoice.invoice_number?.text ?? "",
    billing_party: invoice.billing_party?.text ?? "",
    currency: invoice.currency?.text ?? "",
    elements,
    lines: toLines(invoice),
    unresolved: invoice.unresolved,
  };
}

function toLines(invoice: StitchedInvoice): DuplicateLine[] {
  return invoice.charge_lines.map((line) => ({
    id: line.id,
    container: line.container.text,
    charge: line.charge?.text ?? "",
    charged_from: line.charged_from?.text ?? "",
    charged_to: line.charged_to?.text ?? "",
    rate: line.rate?.text ?? "",
    container_page: line.container.page,
    from_page: line.charged_from?.page ?? 0,
    to_page: line.charged_to?.page ?? 0,
    rate_page: line.rate?.page ?? 0,
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
