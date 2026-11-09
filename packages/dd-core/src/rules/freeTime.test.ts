import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCustomerConfig, type CustomerConfig } from "../config.js";
import { ELEMENT_KEYS } from "../elements.js";
import { dayCount } from "../normalize/dates.js";
import { assignPresence } from "../presence.js";
import { startReview } from "../review.js";
import { freeTime, type FreeInvoice, type FreeLine } from "./freeTime.js";
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixtureDir = path.join(repoRoot, "fixtures/synthetic");
const harborPath = path.join(repoRoot, "fixtures/config/harbor_home.yaml");
const party = "sample_line";
const citation = "Sample Line Logistics demurrage schedule SL-1";
const others = ["clean", "missing_elements", "late_37", "arithmetic", "duplicate_a", "duplicate_b", "split_row"];

describe("freeTime", () => {
  it("prices free_time_overbill at 500 under day 1 and 750 under day 0", () => {
    const invoice = overbill();
    const config = harbor();
    expect(dayCount("2026-02-10", "2026-02-20", "day1") - 5).toBe(6);
    expect(dayCount("2026-02-10", "2026-02-20", "day0") - 5).toBe(5);

    const day1 = freeTime(invoice, config, party, "day1");
    const day0 = freeTime(invoice, config, party, "day0");
    expect(day1).toEqual({
      outcome: "finding",
      convention_sensitive: true,
      findings: [
        {
          rule: "R3",
          rule_version: 1,
          ground: "billing_error",
          citations: [citation],
          invoice_id: "SYN-1004",
          line_ids: ["ln_1", "ln_2"],
          expected: "6 chargeable days, 1100.00 USD (counting 2026-02-10 as day 1)",
          actual: "billed 8 days, 1600.00 USD",
          disputable_amount: "500.00",
          currency: "USD",
          convention: "day1",
          evidence: [
            { page: 1, field: "container_availability_date" },
            { page: 1, field: "applicable_rule" },
            { page: 1, field: "charged_from" },
            { page: 1, field: "charged_to" },
            { page: 1, field: "amount" },
            { page: 1, field: "charged_from" },
            { page: 1, field: "charged_to" },
            { page: 1, field: "amount" },
          ],
          explain:
            "Availability 2026-02-10, 5 free days, last free day 2026-02-14. Charged through 2026-02-20 is 6 chargeable days, expected 1100.00 USD. Billed 1600.00 USD.",
        },
      ],
    });
    expect(day0).toEqual({
      outcome: "finding",
      convention_sensitive: true,
      findings: [
        {
          rule: "R3",
          rule_version: 1,
          ground: "billing_error",
          citations: [citation],
          invoice_id: "SYN-1004",
          line_ids: ["ln_1", "ln_2"],
          expected: "5 chargeable days, 850.00 USD (counting 2026-02-10 as day 0)",
          actual: "billed 8 days, 1600.00 USD",
          disputable_amount: "750.00",
          currency: "USD",
          convention: "day0",
          evidence: [
            { page: 1, field: "container_availability_date" },
            { page: 1, field: "applicable_rule" },
            { page: 1, field: "charged_from" },
            { page: 1, field: "charged_to" },
            { page: 1, field: "amount" },
            { page: 1, field: "charged_from" },
            { page: 1, field: "charged_to" },
            { page: 1, field: "amount" },
          ],
          explain:
            "Availability 2026-02-10, 5 free days, last free day 2026-02-15. Charged through 2026-02-20 is 5 chargeable days, expected 850.00 USD. Billed 1600.00 USD.",
        },
      ],
    });
  });

  it("does not match the printed billing-party name, and does nothing without terms", () => {
    const invoice = overbill();
    const config = harbor();
    expect(freeTime(invoice, config, "Sample Line Logistics", "day1")).toEqual({ outcome: "not_evaluable" });
    expect(freeTime(invoice, { contract_terms: [] }, party, "day1")).toEqual({ outcome: "not_evaluable" });
    expect(freeTime(invoice, {}, party, "day0")).toEqual({ outcome: "not_evaluable" });
  });

  it("returns none when the billed amount equals or is under the expected amount", () => {
    const config = harbor();
    const equal = withAmounts(overbill(), ["600.00", "500.00"]);
    expect(freeTime(equal, config, party, "day1")).toEqual({ outcome: "none", convention_sensitive: true });
    expect(freeTime(equal, config, party, "day0")).toMatchObject({
      outcome: "finding",
      convention_sensitive: true,
      findings: [{ disputable_amount: "250.00", convention: "day0" }],
    });

    const under = withAmounts(overbill(), ["100.00", "100.00"]);
    expect(freeTime(under, config, party, "day1")).toEqual({ outcome: "none", convention_sensitive: false });
    expect(freeTime(under, config, party, "day0")).toEqual({ outcome: "none", convention_sensitive: false });
  });

  it("is not evaluable for a second container", () => {
    const invoice = overbill();
    const first = invoice.lines[0];
    const second = invoice.lines[1];
    if (first === undefined || second === undefined) throw new Error("overbill has two lines");
    const two = { ...invoice, lines: [first, { ...second, container: "SLLU0000099" }] };
    expect(freeTime(two, harbor(), party, "day1")).toEqual({ outcome: "not_evaluable" });
  });

  it("is not evaluable for detention, an overlap, a gap, or a currency that is not the invoice currency", () => {
    const config = harbor();
    const detention = mapLines(overbill(), (line, index) => (index === 1 ? { ...line, charge: "detention" } : line));
    expect(freeTime(detention, config, party, "day1")).toEqual({ outcome: "not_evaluable" });

    const overlap = mapLines(overbill(), (line, index) => (index === 1 ? { ...line, charged_from: "2026-02-16" } : line));
    expect(freeTime(overlap, config, party, "day1")).toEqual({ outcome: "not_evaluable" });

    const gap = mapLines(overbill(), (line, index) => (index === 1 ? { ...line, charged_from: "2026-02-18" } : line));
    expect(freeTime(gap, config, party, "day1")).toEqual({ outcome: "not_evaluable" });

    const lineCurrency = mapLines(overbill(), (line, index) => (index === 0 ? { ...line, amount: "600.00 EUR" } : line));
    expect(freeTime(lineCurrency, config, party, "day1")).toEqual({ outcome: "not_evaluable" });

    const tierCurrency = harbor();
    const rate = tierCurrency.contract_terms?.[0]?.rates[0];
    if (rate === undefined) throw new Error("harbor_home has a rate");
    rate.currency = "EUR";
    expect(freeTime(overbill(), tierCurrency, party, "day1")).toEqual({ outcome: "not_evaluable" });
  });

  it("is not evaluable when the charge period crosses the contract dates", () => {
    expect(freeTime(preparedInvoice("late_37"), harbor(), party, "day1")).toEqual({ outcome: "not_evaluable" });
    expect(freeTime(preparedInvoice("late_37"), harbor(), party, "day0")).toEqual({ outcome: "not_evaluable" });
  });

  it("is not evaluable for every other synthetic invoice under harbor_home", () => {
    const config = harbor();
    for (const id of others) {
      expect(freeTime(truthInvoice(id), config, party, "day1")).toEqual({ outcome: "not_evaluable" });
    }
  });

  it("is not evaluable when the printed applicable rule is confirmed absent", () => {
    const { invoice } = prepared("free_time_overbill");
    const stripped = structuredClone(invoice);
    delete stripped.elements.applicable_rule;
    const elements = assignPresence(stripped, "import");
    const session = startReview({
      documentHash: "hash-free",
      invoice: stripped,
      elements,
      pages: 1,
      name: "Reviewer",
      at: "2026-11-09T22:50:00Z",
    });
    session.acknowledge(1);
    session.confirmAbsent("applicable_rule");
    session.approveLines();
    const reviewed = session.finish();
    const result = freeTime(
      {
        invoice_number: "SYN-1004",
        currency: "USD",
        elements: reviewed.elements,
        lines: toLines(invoice),
      },
      harbor(),
      party,
      "day1",
    );
    expect(result).toEqual({ outcome: "not_evaluable" });
    expect(JSON.stringify(result)).not.toContain("46 CFR");
    expect(JSON.stringify(result)).not.toContain(citation);
  });

  it("does not read an unreadable element", () => {
    const invoice = overbill();
    invoice.elements = {
      ...invoice.elements,
      bl_number: { state: "unreadable", text: "SECRET-UNREADABLE", page: 1 },
    };
    const result = freeTime(invoice, harbor(), party, "day1");
    expect(result).toEqual({ outcome: "not_evaluable" });
    expect(JSON.stringify(result)).not.toContain("SECRET-UNREADABLE");
  });

  it("is not evaluable when two terms cover the same charge dates", () => {
    const config = harbor();
    const term = config.contract_terms?.[0];
    if (term === undefined || config.contract_terms === undefined) throw new Error("harbor_home has terms");
    config.contract_terms.push(structuredClone(term));
    expect(freeTime(overbill(), config, party, "day1")).toEqual({ outcome: "not_evaluable" });
  });

  it("is not evaluable when free time is counted in business days", () => {
    const config = harbor();
    const term = config.contract_terms?.[0];
    if (term === undefined) throw new Error("harbor_home has terms");
    term.demurrage.day_basis = "business";
    expect(freeTime(overbill(), config, party, "day1")).toEqual({ outcome: "not_evaluable" });
  });

  it("accepts a line amount that already names the invoice currency", () => {
    const invoice = withAmounts(overbill(), ["600.00 USD", "1000.00 USD"]);
    expect(freeTime(invoice, harbor(), party, "day1")).toMatchObject({
      outcome: "finding",
      findings: [{ disputable_amount: "500.00", convention: "day1" }],
    });
  });
});

function harbor(): CustomerConfig {
  return structuredClone(loadCustomerConfig(harborPath));
}

function overbill(): FreeInvoice {
  return preparedInvoice("free_time_overbill");
}

function withAmounts(invoice: FreeInvoice, amounts: readonly string[]): FreeInvoice {
  return mapLines(invoice, (line, index) => {
    const amount = amounts[index];
    return amount === undefined ? line : { ...line, amount };
  });
}

function mapLines(invoice: FreeInvoice, edit: (line: FreeLine, index: number) => FreeLine): FreeInvoice {
  return { ...invoice, lines: invoice.lines.map(edit) };
}

function truthInvoice(id: string): FreeInvoice {
  const truth = readTruth(id);
  return {
    invoice_number: truth.invoice_number,
    currency: truth.currency,
    elements: truth.elements,
    lines: truth.charge_lines.map((line, index) => ({
      id: `ln_${index + 1}`,
      container: line.container,
      charge: line.charge,
      charged_from: line.charged_from,
      charged_to: line.charged_to,
      amount: line.amount,
      from_page: linePage(line),
      to_page: linePage(line),
      amount_page: linePage(line),
    })),
  };
}

function linePage(line: FixtureTruth["charge_lines"][number]): number {
  return line.placement.kind === "row" ? line.placement.page : line.placement.head_page;
}

function preparedInvoice(id: string): FreeInvoice {
  const { invoice, elements } = prepared(id);
  return {
    invoice_number: invoice.invoice_number?.text ?? "",
    currency: invoice.currency?.text ?? "",
    elements,
    lines: toLines(invoice),
  };
}

function toLines(invoice: StitchedInvoice): FreeLine[] {
  return invoice.charge_lines.map((line) => ({
    id: line.id,
    container: line.container.text,
    charge: line.charge?.text ?? "",
    charged_from: line.charged_from?.text ?? "",
    charged_to: line.charged_to?.text ?? "",
    amount: line.amount.text,
    from_page: line.charged_from?.page ?? 0,
    to_page: line.charged_to?.page ?? 0,
    amount_page: line.amount.page,
  }));
}

function prepared(id: string): { invoice: StitchedInvoice; elements: ElementRecord } {
  const stitched = stitch(pagesFromPrinted(readTruth(id)));
  return { invoice: stitched, elements: assignPresence(stitched, "import") };
}

function readTruth(id: string): FixtureTruth {
  return fixtureTruthSchema.parse(JSON.parse(fs.readFileSync(path.join(fixtureDir, `${id}.json`), "utf8"))) as FixtureTruth;
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
