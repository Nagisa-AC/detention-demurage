import { Decimal } from "decimal.js";
import { ELEMENT_KEYS, type ElementKey } from "../elements.js";
import { dayCount, isUnreadable, parseDate } from "../normalize/dates.js";
import { parseMoney } from "../normalize/money.js";
import { forRules } from "../presence.js";
import type { ConfirmedAbsent } from "../review.js";
import { findingSchema, type ElementValue, type Finding } from "../schema.js";

export type ArithmeticLine = {
  id: string;
  charged_from: string;
  charged_to: string;
  days: string;
  rate: string;
  amount: string;
  from_page: number;
  to_page: number;
  days_page: number;
  rate_page: number;
  amount_page: number;
};

export type ArithmeticInvoice = {
  invoice_number: string;
  currency: string;
  elements: Record<ElementKey, ElementValue | ConfirmedAbsent>;
  lines: readonly ArithmeticLine[];
  unresolved: readonly { page: number }[];
};

export type ArithmeticResult =
  | { outcome: "finding"; findings: Finding[] }
  | { outcome: "none" }
  | { outcome: "not_evaluable" };

const notEvaluable = { outcome: "not_evaluable" } as const;
const moneyText = /^\d+\.\d{2}$/;
const none = { outcome: "none" } as const;

/**
 * R4. Report an overcharge only.
 * A line finding exists when the printed amount is greater than the inclusive day count times the rate.
 * A total finding exists when the printed total is greater than the sum of the printed line amounts.
 * An underbilled line, and a total below that sum, are silent. Netting the two is runRules' open item.
 * A wrong day count with a matching amount is silent: there is nothing to recover.
 * R3 can dispute the same printed dollars. runRules owns that overlap too.
 */
export function arithmetic(invoice: ArithmeticInvoice): ArithmeticResult {
  const facts = readFacts(invoice);
  if (facts === null) return notEvaluable;

  const findings: Finding[] = [];
  for (const line of facts.lines) {
    const checked = lineFinding(invoice, facts.citation, line);
    if (checked === null) return notEvaluable;
    if (checked !== undefined) findings.push(checked);
  }

  if (facts.total === null) {
    if (findings.length === 0) return notEvaluable;
    return { outcome: "finding", findings };
  }

  const totalFinding = totalCheck(invoice, facts);
  if (totalFinding === null) return notEvaluable;
  if (totalFinding !== undefined) findings.push(totalFinding);
  if (findings.length === 0) return none;
  return { outcome: "finding", findings };
}

type ReadyLine = {
  id: string;
  from: string;
  to: string;
  span: number;
  printedDays: number;
  rate: Decimal;
  amount: Decimal;
  fromPage: number;
  toPage: number;
  daysPage: number;
  ratePage: number;
  amountPage: number;
};

type Facts = {
  citation: string;
  lines: ReadyLine[];
  total: { amount: Decimal; page: number } | null;
};

function readFacts(invoice: ArithmeticInvoice): Facts | null {
  if (!/^[A-Z]{3}$/.test(invoice.currency) || invoice.invoice_number.trim() === "") return null;
  const read = readElements(invoice);
  if (read === null || read.citation === undefined) return null;
  if (invoice.unresolved.length > 0 || invoice.lines.length === 0) return null;
  const lines = readLines(invoice);
  if (lines === null) return null;
  return { citation: read.citation, lines, total: read.total };
}

function readElements(invoice: ArithmeticInvoice): { citation?: string; total: Facts["total"] } | null {
  let citation: string | undefined;
  let total: Facts["total"] | undefined;

  for (const key of ELEMENT_KEYS) {
    const view = forRules(invoice.elements[key]);
    if (view.state === "suggested_absent" || view.state === "unreadable") return null;
    if (view.state !== "present") continue;
    if (key === "applicable_rule") {
      if (view.text.trim() === "") return null;
      citation = view.text;
    }
    if (key === "total_due") {
      const parsed = parseMoney(view.text);
      if ("status" in parsed || (parsed.currency !== null && parsed.currency !== invoice.currency)) return null;
      total = { amount: parsed.amount, page: view.page };
    }
  }

  const result: { citation?: string; total: Facts["total"] } = { total: total ?? null };
  if (citation !== undefined) result.citation = citation;
  return result;
}

function readLines(invoice: ArithmeticInvoice): ReadyLine[] | null {
  const ready: ReadyLine[] = [];
  for (const line of invoice.lines) {
    if (line.id.trim() === "") return null;
    if (!validPage(line.from_page) || !validPage(line.to_page) || !validPage(line.days_page)) return null;
    if (!validPage(line.rate_page) || !validPage(line.amount_page)) return null;
    const from = parseDate(line.charged_from);
    const to = parseDate(line.charged_to);
    if (isUnreadable(from) || isUnreadable(to) || from > to) return null;
    const printedDays = parseDayCount(line.days);
    if (printedDays === null) return null;
    const rate = parseMoney(line.rate);
    const amount = parseMoney(line.amount);
    if ("status" in rate || "status" in amount) return null;
    if (rate.currency !== null && rate.currency !== invoice.currency) return null;
    if (amount.currency !== null && amount.currency !== invoice.currency) return null;
    ready.push({
      id: line.id,
      from,
      to,
      span: dayCount(from, to, "day1"),
      printedDays,
      rate: rate.amount,
      amount: amount.amount,
      fromPage: line.from_page,
      toPage: line.to_page,
      daysPage: line.days_page,
      ratePage: line.rate_page,
      amountPage: line.amount_page,
    });
  }
  return ready;
}

/** `undefined` is a clean line. `null` means the money could not be recorded. */
function lineFinding(invoice: ArithmeticInvoice, citation: string, line: ReadyLine): Finding | null | undefined {
  const product = times(line.rate, line.span);
  if (!line.amount.greaterThan(product)) return undefined;
  const disputable = line.amount.minus(product).toFixed(2);
  const productText = money(product);
  const amountText = money(line.amount);
  const rateText = money(line.rate);
  if (!moneyText.test(disputable) || productText === null || amountText === null || rateText === null) return null;
  const dayWord = line.span === 1 ? "day" : "days";
  const printedWord = line.printedDays === 1 ? "day" : "days";
  const daySentence = line.printedDays === line.span ? "" : ` The line says ${line.printedDays} ${printedWord}.`;
  return findingSchema.parse({
    rule: "R4",
    rule_version: 1,
    ground: "billing_error",
    citations: [citation],
    invoice_id: invoice.invoice_number,
    line_ids: [line.id],
    expected: `${line.span} ${dayWord}, ${productText} ${invoice.currency}`,
    actual: `printed ${line.printedDays} ${printedWord}, ${amountText} ${invoice.currency}`,
    disputable_amount: disputable,
    currency: invoice.currency,
    evidence: [
      { page: line.fromPage, field: "charged_from" },
      { page: line.toPage, field: "charged_to" },
      { page: line.daysPage, field: "days" },
      { page: line.ratePage, field: "rate" },
      { page: line.amountPage, field: "amount" },
    ],
    explain: `${line.from} through ${line.to} is ${line.span} ${dayWord}.${daySentence} ${line.span} × ${rateText} ${invoice.currency} is ${productText} ${invoice.currency}. The line amount is ${amountText} ${invoice.currency}.`,
  });
}

/** `undefined` means the total matches. `null` means the money could not be recorded. */
function totalCheck(invoice: ArithmeticInvoice, facts: Facts): Finding | null | undefined {
  const total = facts.total;
  if (total === null) return undefined;
  let sum = new Decimal("0");
  for (const line of facts.lines) sum = sum.plus(line.amount);
  if (!total.amount.greaterThan(sum)) return undefined;
  const sumText = money(sum);
  const totalText = money(total.amount);
  const disputable = total.amount.minus(sum).toFixed(2);
  if (sumText === null || totalText === null || !moneyText.test(disputable)) return null;
  return findingSchema.parse({
    rule: "R4",
    rule_version: 1,
    ground: "billing_error",
    citations: [facts.citation],
    invoice_id: invoice.invoice_number,
    line_ids: facts.lines.map((line) => line.id),
    expected: `${sumText} ${invoice.currency}`,
    actual: `${totalText} ${invoice.currency}`,
    disputable_amount: disputable,
    currency: invoice.currency,
    evidence: [
      { page: total.page, field: "total_due" },
      ...facts.lines.map((line) => ({ page: line.amountPage, field: "amount" as const })),
    ],
    explain: `The charge lines sum to ${sumText} ${invoice.currency}. The invoice total is ${totalText} ${invoice.currency}.`,
  });
}

function times(rate: Decimal, days: number): Decimal {
  let sum = new Decimal("0");
  for (let day = 0; day < days; day += 1) sum = sum.plus(rate);
  return sum;
}

function money(value: Decimal): string | null {
  const text = value.toFixed(2);
  return moneyText.test(text) ? text : null;
}

function parseDayCount(text: string): number | null {
  const value = text.trim();
  if (!/^\d+$/.test(value)) return null;
  const days = Number(value);
  if (!Number.isInteger(days)) return null;
  return days;
}

function validPage(page: number): boolean {
  return Number.isInteger(page) && page >= 1;
}
