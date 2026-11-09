import { Decimal } from "decimal.js";
import type { CustomerConfig } from "../config.js";
import { ELEMENT_KEYS, type ElementKey } from "../elements.js";
import { addDays, dayCount, isUnreadable, parseDate, type DayConvention } from "../normalize/dates.js";
import { parseMoney } from "../normalize/money.js";
import { forRules } from "../presence.js";
import type { ConfirmedAbsent } from "../review.js";
import { findingSchema, type ElementValue, type Finding } from "../schema.js";

export type FreeLine = {
  id: string;
  container: string;
  charge: string;
  charged_from: string;
  charged_to: string;
  amount: string;
  from_page: number;
  to_page: number;
  amount_page: number;
};

export type FreeInvoice = {
  invoice_number: string;
  currency: string;
  elements: Record<ElementKey, ElementValue | ConfirmedAbsent>;
  lines: readonly FreeLine[];
};

/** Contract terms only. The printed billing-party name is not read here. */
export type FreeConfig = Pick<CustomerConfig, "contract_terms">;

export type FreeResult =
  | { outcome: "finding"; findings: Finding[]; convention_sensitive: boolean }
  | { outcome: "none"; convention_sensitive: boolean }
  | { outcome: "not_evaluable" };

const notEvaluable = { outcome: "not_evaluable" } as const;
const moneyText = /^\d+\.\d{2}$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/**
 * R3. Compare the billed demurrage with the contract free time.
 * The party id is already resolved. This function does not match printed names.
 * Day 0 and day 1 are both judged so one call can say whether they disagree.
 * Detention has no pickup date, so a detention line is not evaluable.
 */
export function freeTime(
  invoice: FreeInvoice,
  config: FreeConfig,
  billingPartyId: string,
  convention: DayConvention,
): FreeResult {
  if (convention !== "day0" && convention !== "day1") throw new TypeError("convention must be day0 or day1");
  const facts = readFacts(invoice, config, billingPartyId);
  if (facts === null) return notEvaluable;

  const judged = price(facts, convention);
  const other = price(facts, convention === "day0" ? "day1" : "day0");
  if (judged === null || other === null) return notEvaluable;

  const conventionSensitive = verdictKey(facts.billed, judged.expected) !== verdictKey(facts.billed, other.expected);
  if (!facts.billed.greaterThan(judged.expected)) return { outcome: "none", convention_sensitive: conventionSensitive };

  const countedAs = convention === "day0" ? "day 0" : "day 1";
  const expectedText = judged.expected.toFixed(2);
  const billedText = facts.billed.toFixed(2);
  const disputable = facts.billed.minus(judged.expected).toFixed(2);
  if (!moneyText.test(expectedText) || !moneyText.test(billedText) || !moneyText.test(disputable)) return notEvaluable;

  return {
    outcome: "finding",
    convention_sensitive: conventionSensitive,
    findings: [
      findingSchema.parse({
        rule: "R3",
        rule_version: 1,
        ground: "billing_error",
        citations: [facts.citation],
        invoice_id: invoice.invoice_number,
        line_ids: facts.lines.map((line) => line.id),
        expected: `${countLabel(judged.days, "chargeable day", "chargeable days")}, ${expectedText} ${invoice.currency} (counting ${facts.availability} as ${countedAs})`,
        actual: `billed ${countLabel(facts.billedDays, "day", "days")}, ${billedText} ${invoice.currency}`,
        disputable_amount: disputable,
        currency: invoice.currency,
        evidence: evidence(facts),
        explain: explain(facts, judged, invoice.currency),
        convention,
      }),
    ],
  };
}

type ReadyLine = {
  id: string;
  container: string;
  charged_from: string;
  charged_to: string;
  amount: Decimal;
  from_page: number;
  to_page: number;
  amount_page: number;
};

type ReadyRate = {
  from_day: number;
  to_day?: number;
  per_day: string;
};

type Facts = {
  availability: string;
  availabilityPage: number;
  citation: string;
  citationPage: number;
  lines: ReadyLine[];
  billed: Decimal;
  billedDays: number;
  lastTo: string;
  freeDays: number;
  rates: readonly ReadyRate[];
};

type Priced = {
  days: number;
  expected: Decimal;
  lastFree: string;
};

function readFacts(invoice: FreeInvoice, config: FreeConfig, billingPartyId: string): Facts | null {
  if (!/^[A-Z]{3}$/.test(invoice.currency) || invoice.invoice_number.trim() === "") return null;
  const cited = readElements(invoice);
  if (cited === null) return null;
  const lines = readLines(invoice);
  if (lines === null) return null;
  const term = matchTerm(config.contract_terms, billingPartyId, lines, invoice.currency);
  if (term === null) return null;

  const ordered = [...lines].sort(byStart);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (first === undefined || last === undefined) return null;

  let billed = new Decimal("0");
  for (const line of lines) billed = billed.plus(line.amount);

  return {
    availability: cited.availability,
    availabilityPage: cited.availabilityPage,
    citation: cited.citation,
    citationPage: cited.citationPage,
    lines,
    billed,
    billedDays: dayCount(first.charged_from, last.charged_to, "day1"),
    lastTo: last.charged_to,
    freeDays: term.freeDays,
    rates: term.rates,
  };
}

function readElements(invoice: FreeInvoice): { availability: string; availabilityPage: number; citation: string; citationPage: number } | null {
  let availability: string | undefined;
  let availabilityPage: number | undefined;
  let citation: string | undefined;
  let citationPage: number | undefined;

  for (const key of ELEMENT_KEYS) {
    const view = forRules(invoice.elements[key]);
    if (view.state === "suggested_absent" || view.state === "unreadable") return null;
    if (view.state !== "present") continue;
    if (key === "container_availability_date") {
      const parsed = view.value !== undefined && isoDate.test(view.value) ? view.value : parseDate(view.text);
      if (isUnreadable(parsed)) return null;
      availability = parsed;
      availabilityPage = view.page;
    }
    if (key === "applicable_rule") {
      if (view.text.trim() === "") return null;
      citation = view.text;
      citationPage = view.page;
    }
  }

  if (availability === undefined || availabilityPage === undefined || citation === undefined || citationPage === undefined) {
    return null;
  }
  return { availability, availabilityPage, citation, citationPage };
}

function readLines(invoice: FreeInvoice): ReadyLine[] | null {
  if (invoice.lines.length === 0) return null;
  const ready: ReadyLine[] = [];
  const containers = new Set<string>();

  for (const line of invoice.lines) {
    if (line.id.trim() === "" || line.container.trim() === "") return null;
    if (line.charge !== "demurrage") return null;
    if (!validPage(line.from_page) || !validPage(line.to_page) || !validPage(line.amount_page)) return null;
    const chargedFrom = parseDate(line.charged_from);
    const chargedTo = parseDate(line.charged_to);
    if (isUnreadable(chargedFrom) || isUnreadable(chargedTo) || chargedFrom > chargedTo) return null;
    const amount = parseMoney(line.amount);
    if ("status" in amount) return null;
    if (amount.currency !== null && amount.currency !== invoice.currency) return null;
    containers.add(line.container);
    ready.push({
      id: line.id,
      container: line.container,
      charged_from: chargedFrom,
      charged_to: chargedTo,
      amount: amount.amount,
      from_page: line.from_page,
      to_page: line.to_page,
      amount_page: line.amount_page,
    });
  }

  if (containers.size !== 1) return null;
  if (!oneBlock(ready)) return null;
  return ready;
}

/**
 * Touching or nested ranges are an overlap. A hole between lines is a gap.
 * Either one would make the chargeable-day count a guess.
 */
function oneBlock(lines: readonly ReadyLine[]): boolean {
  const ordered = [...lines].sort(byStart);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const next = ordered[index];
    if (previous === undefined || next === undefined) return false;
    if (next.charged_from !== addDays(previous.charged_to, 1)) return false;
  }
  return true;
}

function byStart(left: ReadyLine, right: ReadyLine): number {
  if (left.charged_from !== right.charged_from) return left.charged_from < right.charged_from ? -1 : 1;
  if (left.charged_to === right.charged_to) return 0;
  return left.charged_to < right.charged_to ? -1 : 1;
}

type MatchedTerm = {
  freeDays: number;
  rates: ReadyRate[];
};

function matchTerm(
  terms: CustomerConfig["contract_terms"],
  billingPartyId: string,
  lines: readonly ReadyLine[],
  currency: string,
): MatchedTerm | null {
  if (billingPartyId.trim() === "") return null;
  const candidates = (terms ?? []).filter((term) => term.billing_party === billingPartyId);
  if (candidates.length === 0) return null;

  const covering = candidates.filter((term) => covers(term, lines));
  const term = covering.length === 1 ? covering[0] : undefined;
  if (term === undefined) return null;
  if (term.demurrage.day_basis !== "calendar") return null;
  if (!Number.isInteger(term.demurrage.free_days) || term.demurrage.free_days < 0) return null;

  const rates: ReadyRate[] = [];
  for (const rate of term.rates) {
    if (rate.currency !== currency || !moneyText.test(rate.per_day)) return null;
    if (!Number.isInteger(rate.from_day) || rate.from_day < 1) return null;
    if (rate.to_day !== undefined && (!Number.isInteger(rate.to_day) || rate.to_day < rate.from_day)) return null;
    if (rate.charge !== "demurrage") continue;
    const ready: ReadyRate = { from_day: rate.from_day, per_day: rate.per_day };
    if (rate.to_day !== undefined) ready.to_day = rate.to_day;
    rates.push(ready);
  }
  return { freeDays: term.demurrage.free_days, rates };
}

function covers(term: NonNullable<CustomerConfig["contract_terms"]>[number], lines: readonly ReadyLine[]): boolean {
  if (!isoDate.test(term.valid_from) || !isoDate.test(term.valid_to) || term.valid_to < term.valid_from) return false;
  return lines.every(
    (line) =>
      line.charged_from >= term.valid_from
      && line.charged_from <= term.valid_to
      && line.charged_to >= term.valid_from
      && line.charged_to <= term.valid_to,
  );
}

function price(facts: Facts, convention: DayConvention): Priced | null {
  const span = dayCount(facts.availability, facts.lastTo, convention);
  const days = span > facts.freeDays ? span - facts.freeDays : 0;
  const offset = convention === "day0" ? facts.freeDays : facts.freeDays - 1;
  const expected = priceDays(days, facts.rates);
  if (expected === null) return null;
  return { days, expected, lastFree: addDays(facts.availability, offset) };
}

function priceDays(days: number, rates: readonly ReadyRate[]): Decimal | null {
  let sum = new Decimal("0");
  for (let day = 1; day <= days; day += 1) {
    const perDay = rateFor(day, rates);
    if (perDay === null) return null;
    sum = sum.plus(new Decimal(perDay));
  }
  return sum;
}

function rateFor(day: number, rates: readonly ReadyRate[]): string | null {
  let found: string | undefined;
  for (const rate of rates) {
    if (day < rate.from_day) continue;
    if (rate.to_day !== undefined && day > rate.to_day) continue;
    if (found !== undefined) return null;
    found = rate.per_day;
  }
  return found ?? null;
}

function verdictKey(billed: Decimal, expected: Decimal): string {
  if (!billed.greaterThan(expected)) return "none";
  return billed.minus(expected).toFixed(2);
}

function explain(facts: Facts, priced: Priced, currency: string): string {
  const free = countLabel(facts.freeDays, "free day", "free days");
  const chargeable = countLabel(priced.days, "chargeable day", "chargeable days");
  const tail = `Charged through ${facts.lastTo} is ${chargeable}, expected ${priced.expected.toFixed(2)} ${currency}. Billed ${facts.billed.toFixed(2)} ${currency}.`;
  if (facts.freeDays === 0) return `Availability ${facts.availability}, ${free}. ${tail}`;
  return `Availability ${facts.availability}, ${free}, last free day ${priced.lastFree}. ${tail}`;
}

function evidence(facts: Facts): Finding["evidence"] {
  const pages: Finding["evidence"] = [
    { page: facts.availabilityPage, field: "container_availability_date" },
    { page: facts.citationPage, field: "applicable_rule" },
  ];
  for (const line of facts.lines) {
    pages.push(
      { page: line.from_page, field: "charged_from" },
      { page: line.to_page, field: "charged_to" },
      { page: line.amount_page, field: "amount" },
    );
  }
  return pages;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function validPage(page: number): boolean {
  return Number.isInteger(page) && page >= 1;
}
