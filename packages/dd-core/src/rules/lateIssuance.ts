import { ELEMENT_KEYS, type ElementKey } from "../elements.js";
import { addDays, dayCount, isUnreadable, parseDate, type DayConvention } from "../normalize/dates.js";
import { forRules } from "../presence.js";
import type { ConfirmedAbsent } from "../review.js";
import { findingSchema, type ElementValue, type Finding } from "../schema.js";

export type LateInvoice = {
  invoice_number: string;
  currency: string;
  elements: Record<ElementKey, ElementValue | ConfirmedAbsent>;
  lines: readonly { id: string; charged_to: string; page: number }[];
};

export type LateConfig = {
  billed_party_role: "direct" | "nvocc_passthrough";
};

export type LateResult =
  | { outcome: "finding"; finding: Finding; convention_sensitive: boolean }
  | { outcome: "none"; convention_sensitive: boolean }
  | { outcome: "not_evaluable" }
  | { outcome: "needs_info" };

const notEvaluable = { outcome: "not_evaluable" } as const;
const moneyText = /^\d+\.\d{2}$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/**
 * R2. The invoice is late when its date is after the 30-day deadline.
 * Day 0 and day 1 are both reported. The day-count question stays open.
 * An NVOCC clock needs the carrier invoice date, which has no source yet.
 */
export function lateIssuance(invoice: LateInvoice, config: LateConfig, convention: DayConvention): LateResult {
  if (convention !== "day0" && convention !== "day1") throw new TypeError("convention must be day0 or day1");
  const facts = readFacts(invoice);
  if (facts === null) return notEvaluable;
  if (config.billed_party_role === "nvocc_passthrough") return { outcome: "needs_info" };
  if (config.billed_party_role !== "direct") return notEvaluable;

  const judged = judge(facts.start, facts.invoiceDate, convention);
  const other = judge(facts.start, facts.invoiceDate, convention === "day0" ? "day1" : "day0");
  const conventionSensitive = judged.late !== other.late;
  if (!judged.late) return { outcome: "none", convention_sensitive: conventionSensitive };

  const gap = dayCount(facts.start, facts.invoiceDate, "day0");
  const dayWord = gap === 1 ? "day" : "days";
  const countedAs = convention === "day0" ? "day 0" : "day 1";
  return {
    outcome: "finding",
    convention_sensitive: conventionSensitive,
    finding: findingSchema.parse({
      rule: "R2",
      rule_version: 1,
      ground: "late_invoice",
      citations: ["46 CFR 541.7(a)"],
      invoice_id: invoice.invoice_number,
      line_ids: invoice.lines.map((line) => line.id),
      expected: `issued by ${judged.deadline} (counting ${facts.start} as ${countedAs})`,
      actual: `issued ${facts.invoiceDate}`,
      disputable_amount: facts.total,
      currency: invoice.currency,
      evidence: [
        { page: facts.invoicePage, field: "invoice_date" },
        { page: facts.linePage, field: "charged_to" },
      ],
      explain: `Charges were last incurred on ${facts.start}. The invoice is dated ${facts.invoiceDate}, ${gap} ${dayWord} later.`,
      convention,
    }),
  };
}

type Facts = {
  invoiceDate: string;
  invoicePage: number;
  total: string;
  start: string;
  linePage: number;
};

function readFacts(invoice: LateInvoice): Facts | null {
  if (!/^[A-Z]{3}$/.test(invoice.currency) || invoice.invoice_number.trim() === "") return null;
  let invoiceDate: string | undefined;
  let invoicePage: number | undefined;
  let total: string | undefined;
  for (const key of ELEMENT_KEYS) {
    const view = forRules(invoice.elements[key]);
    if (view.state === "suggested_absent" || view.state === "unreadable") return null;
    if (key === "invoice_date" && view.state === "present") {
      invoiceDate = view.value;
      invoicePage = view.page;
    }
    if (key === "total_due" && view.state === "present") total = view.value;
  }
  if (
    invoiceDate === undefined
    || invoicePage === undefined
    || !isoDate.test(invoiceDate)
    || total === undefined
    || !moneyText.test(total)
  ) {
    return null;
  }
  const start = latestChargedTo(invoice.lines);
  if (start === null) return null;
  return { invoiceDate, invoicePage, total, start: start.date, linePage: start.page };
}

function latestChargedTo(lines: LateInvoice["lines"]): { date: string; page: number } | null {
  if (lines.length === 0) return null;
  let best: { date: string; page: number } | null = null;
  for (const line of lines) {
    if (line.id.trim() === "" || !Number.isInteger(line.page) || line.page < 1) return null;
    const parsed = parseDate(line.charged_to);
    if (isUnreadable(parsed)) return null;
    if (best === null || parsed >= best.date) best = { date: parsed, page: line.page };
  }
  return best;
}

function judge(start: string, invoiceDate: string, convention: DayConvention): { late: boolean; deadline: string } {
  const deadline = addDays(start, convention === "day0" ? 30 : 29);
  return { late: invoiceDate > deadline, deadline };
}
