import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ELEMENT_KEYS } from "./elements.js";
import { forRules, assignPresence, type RuleElement } from "./presence.js";
import { isConfirmedAbsent, startReview, type ConfirmedAbsent } from "./review.js";
import {
  elementValueSchema,
  fixtureTruthSchema,
  pageExtractionSchema,
  stitchedInvoiceSchema,
  type ElementValue,
  type FixtureTruth,
  type PageExtraction,
  type PrintedChargeLine,
  type StitchedInvoice,
} from "./schema.js";
import { stitch } from "./stitch.js";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/synthetic");
const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

const removed = new Set<string>(["free_time_start", "free_time_end", "cert_rules_compliance", "cert_no_contribution"]);

type UnreadableForRules = Extract<RuleElement, { state: "unreadable" }>;
type RuleReadsUnreadableText = "text" extends keyof UnreadableForRules ? true : false;
type RuleReadsUnreadableValue = "value" extends keyof UnreadableForRules ? true : false;

describe("assignPresence", () => {
  it("marks the four missing elements suggested_absent and the export date not applicable", () => {
    const truth = readTruth("missing_elements");
    const elements = assignPresence(stitch(pagesFromPrinted(truth)), "import");

    for (const key of removed) {
      expect(elements[key as (typeof ELEMENT_KEYS)[number]], key).toEqual({ state: "suggested_absent", page: null });
    }
    expect(elements.earliest_return_date).toEqual({ state: "not_applicable", page: null });

    for (const key of ELEMENT_KEYS) {
      if (key === "earliest_return_date" || removed.has(key)) continue;
      const truthElement = truth.elements[key];
      expect(elements[key]?.state, key).toBe("present");
      expect(elements[key]?.text, key).toBe(truthElement.text);
      expect(elements[key]?.page, key).toBe(truthElement.page);
    }

    expect(elements.container_number?.value).toBe("SLLU0000027");
    expect(elements.invoice_date?.value).toBe("2026-06-20");
    expect(elements.total_due).toMatchObject({ text: "300.00 USD", value: "300.00" });
    expect(elements.free_time_days?.value).toBeUndefined();
    expect(elements.rates?.value).toBeUndefined();
    expect(elements.bl_number?.value).toBeUndefined();
  });

  it("passes a date hint through to parseDate and leaves an unhinted slash date unreadable", () => {
    const hinted = assignPresence(invoiceWith({ invoice_date: { text: "03/02/2026", page: 1 } }), "import", "DMY");
    expect(hinted.invoice_date).toMatchObject({ state: "present", text: "03/02/2026", value: "2026-02-03", page: 1 });

    const monthFirst = assignPresence(invoiceWith({ invoice_date: { text: "03/02/2026", page: 1 } }), "import", "MDY");
    expect(monthFirst.invoice_date?.value).toBe("2026-03-02");

    const plain = assignPresence(invoiceWith({ invoice_date: { text: "03/02/2026", page: 1 } }), "import");
    expect(plain.invoice_date).toMatchObject({ state: "unreadable", text: "03/02/2026", page: 1 });
    expect(plain.invoice_date?.value).toBeUndefined();

    const named = assignPresence(invoiceWith({ invoice_date: { text: "13 May 2026", page: 1 } }), "import");
    expect(named.invoice_date).toMatchObject({ state: "present", value: "2026-05-13" });
  });

  it("keeps a bad container and a currency mismatch unreadable", () => {
    const badContainer = assignPresence(
      invoiceWith({ container_number: { text: "CSQU3054384", page: 1 } }),
      "import",
    );
    expect(badContainer.container_number).toEqual({ state: "unreadable", text: "CSQU3054384", page: 1 });

    const mismatch = assignPresence(
      invoiceWith({ total_due: { text: "300.00 EUR", page: 1 } }, { currency: { text: "USD", page: 1 } }),
      "import",
    );
    expect(mismatch.total_due).toEqual({ state: "unreadable", text: "300.00 EUR", page: 1 });
  });

  it("maps a conflict to unreadable and keeps both texts on the invoice", () => {
    const invoice = invoiceWith({}, {
      conflicts: [
        {
          key: "invoice_date" as const,
          values: [
            { text: "2026-05-22", page: 1 },
            { text: "2026-05-23", page: 2 },
          ],
        },
      ],
    });
    const elements = assignPresence(invoice, "import");
    expect(elements.invoice_date).toEqual({ state: "unreadable", text: "2026-05-22", page: 1 });
    expect(invoice.conflicts[0]?.values).toEqual([
      { text: "2026-05-22", page: 1 },
      { text: "2026-05-23", page: 2 },
    ]);
  });

  it("uses applicability for import-only and export-only keys", () => {
    const imported = assignPresence(invoiceWith({}), "import");
    expect(imported.port_of_discharge).toEqual({ state: "suggested_absent", page: null });
    expect(imported.earliest_return_date).toEqual({ state: "not_applicable", page: null });

    const exported = assignPresence(
      invoiceWith({
        port_of_discharge: { text: "Port Sample", page: 1 },
        earliest_return_date: { text: "2026-05-01", page: 1 },
      }),
      "export",
    );
    expect(exported.port_of_discharge).toEqual({ state: "not_applicable", page: null });
    expect(exported.container_availability_date).toEqual({ state: "not_applicable", page: null });
    expect(exported.earliest_return_date).toMatchObject({ state: "present", text: "2026-05-01", value: "2026-05-01" });
  });

  it("does not let a rule read text or value from an unreadable element", () => {
    const ruleIgnoresUnreadableText: RuleReadsUnreadableText = false;
    const ruleIgnoresUnreadableValue: RuleReadsUnreadableValue = false;
    expect(ruleIgnoresUnreadableText).toBe(false);
    expect(ruleIgnoresUnreadableValue).toBe(false);

    const unread: ElementValue = { state: "unreadable", text: "CSQU3054384", value: "CSQU3054384", page: 1 };
    expect(forRules(unread)).toEqual({ state: "unreadable", page: 1 });
    expect(forRules(unread)).not.toHaveProperty("text");
    expect(forRules(unread)).not.toHaveProperty("value");

    const present = forRules({ state: "present", text: "2026-06-20", value: "2026-06-20", page: 1 });
    expect(present).toEqual({ state: "present", text: "2026-06-20", value: "2026-06-20", page: 1 });
  });

  it("passes a branded confirmed absence through and rejects a forgery", () => {
    const invoice = stitchedInvoiceSchema.parse({
      elements: {},
      conflicts: [],
      header_conflicts: [],
      charge_lines: [],
      unresolved: [],
    });
    const session = startReview({
      documentHash: "hash-rules",
      invoice,
      elements: assignPresence(invoice, "import"),
      pages: 1,
      name: "Reviewer",
      at: "2026-11-09T21:13:00Z",
    });
    session.acknowledge(1);
    session.confirmAbsent("free_time_start");
    const branded = session.view().elements.free_time_start;
    expect(forRules(branded)).toBe(branded);
    expect(isConfirmedAbsent(forRules(branded))).toBe(true);
    expect(() => forRules({ state: "confirmed_absent", page: null } as never)).toThrow("not a rule input");
  });
});

describe("confirmed_absent", () => {
  it("rejects the state in the element schema", () => {
    expect(elementValueSchema.safeParse({ state: "confirmed_absent", page: null }).success).toBe(false);
  });

  it("returns false for a plain object and a forged state", () => {
    expect(isConfirmedAbsent({ state: "x" })).toBe(false);
    expect(isConfirmedAbsent({ state: "confirmed_absent" })).toBe(false);
  });

  it("does not assign that state outside review.ts", () => {
    const stateLiteral = /\bstate\s*[:=]\s*["']confirmed_absent["']/;
    const offenders: string[] = [];
    for (const file of sourceFiles(sourceDir)) {
      if (file.endsWith(`${path.sep}review.ts`)) continue;
      const text = fs.readFileSync(file, "utf8");
      if (stateLiteral.test(text)) offenders.push(path.relative(sourceDir, file));
    }
    expect(offenders).toEqual([]);
  });
});

// @ts-expect-error A confirmed absence needs the unexported brand from review.ts.
const forged: ConfirmedAbsent = { state: "confirmed_absent", page: null };
void forged;

function readTruth(id: string): FixtureTruth {
  return fixtureTruthSchema.parse(JSON.parse(fs.readFileSync(path.join(fixtureDir, `${id}.json`), "utf8")));
}

function pagesFromPrinted(truth: FixtureTruth): PageExtraction[] {
  const elements: PageExtraction["elements"] = {};
  for (const key of ELEMENT_KEYS) {
    const element = truth.elements[key];
    if (element.state !== "present" || element.page === null || element.text === undefined || element.text === "") continue;
    elements[key] = { text: element.text, page: element.page };
  }
  const charge_lines: PrintedChargeLine[] = truth.charge_lines
    .filter((line) => line.placement.kind === "row" && line.placement.page === 1)
    .map((line) => ({
      page: 1,
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

function invoiceWith(
  elements: StitchedInvoice["elements"],
  extra: Partial<Pick<StitchedInvoice, "currency" | "conflicts">> = {},
): StitchedInvoice {
  return stitchedInvoiceSchema.parse({
    elements,
    conflicts: extra.conflicts ?? [],
    header_conflicts: [],
    charge_lines: [],
    unresolved: [],
    ...(extra.currency === undefined ? {} : { currency: extra.currency }),
  });
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) found.push(full);
  }
  return found;
}
