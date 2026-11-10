import { Decimal } from "decimal.js";
import { ELEMENT_KEYS, type ElementKey } from "../elements.js";
import { addDays, dayCount, isUnreadable, parseDate } from "../normalize/dates.js";
import { parseMoney } from "../normalize/money.js";
import { forRules } from "../presence.js";
import type { ConfirmedAbsent } from "../review.js";
import { findingSchema, type ElementValue, type Finding } from "../schema.js";

export type DuplicateLine = {
  id: string;
  container: string;
  charge: string;
  charged_from: string;
  charged_to: string;
  rate: string;
  container_page: number;
  from_page: number;
  to_page: number;
  rate_page: number;
};

export type DuplicateInvoice = {
  invoice_number: string;
  billing_party: string;
  currency: string;
  elements: Record<ElementKey, ElementValue | ConfirmedAbsent>;
  lines: readonly DuplicateLine[];
  unresolved: readonly { page: number }[];
};

/** A review decision. This rule does not read `reissue_of` off an invoice. */
export type ReissueLink = {
  invoice_number: string;
  reissue_of: string;
};

export type DuplicateResult =
  | { outcome: "finding"; findings: Finding[]; not_evaluable: string[] }
  | { outcome: "none"; not_evaluable: string[] }
  | { outcome: "not_evaluable"; not_evaluable: string[] };

const moneyText = /^\d+\.\d{2}$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/**
 * R5. Two invoices, same billing party, currency, container, and charge, with overlapping dates.
 * The finding is on the later invoice. Days are counted once per later line.
 * Reissue pairs come from the caller. A duplicate inside one invoice is an open item.
 * R2 on a reissue belongs to runRules.
 */
export function duplicates(invoices: readonly DuplicateInvoice[], reissues: readonly ReissueLink[]): DuplicateResult {
  const blocked: string[] = [];
  const ready: ReadyInvoice[] = [];
  const repeated = repeatedNumbers(invoices);

  for (const invoice of invoices) {
    if (repeated.has(invoice.invoice_number) || readInvoice(invoice, ready) === false) {
      blocked.push(invoice.invoice_number);
    }
  }

  const unresolved = new Set<string>();
  const overlaps = new Map<string, Overlap>();
  for (let leftIndex = 0; leftIndex < ready.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ready.length; rightIndex += 1) {
      const left = ready[leftIndex];
      const right = ready[rightIndex];
      if (left === undefined || right === undefined) continue;
      compare(left, right, reissues, overlaps, unresolved);
    }
  }

  const findings: Finding[] = [];
  const ordered = [...overlaps.values()].sort(byLaterLine);
  for (const overlap of ordered) {
    const finding = toFinding(overlap);
    if (finding === null) {
      blocked.push(overlap.later.number);
      continue;
    }
    if (finding !== undefined) findings.push(finding);
  }

  const notEvaluable = uniqueSorted([...blocked, ...unresolved]);
  if (findings.length > 0) return { outcome: "finding", findings, not_evaluable: notEvaluable };
  if (notEvaluable.length > 0) return { outcome: "not_evaluable", not_evaluable: notEvaluable };
  return { outcome: "none", not_evaluable: [] };
}

type ReadyLine = {
  id: string;
  container: string;
  charge: string;
  from: string;
  to: string;
  rate: Decimal;
  containerPage: number;
  fromPage: number;
  toPage: number;
  ratePage: number;
};

type ReadyInvoice = {
  number: string;
  party: string;
  currency: string;
  date: string;
  citation: string;
  lines: ReadyLine[];
};

type EarlierNote = {
  number: string;
  date: string;
  ranges: string[];
};

type Overlap = {
  later: ReadyInvoice;
  line: ReadyLine;
  days: Set<string>;
  earlier: EarlierNote[];
};

function readInvoice(invoice: DuplicateInvoice, ready: ReadyInvoice[]): boolean {
  if (!/^[A-Z]{3}$/.test(invoice.currency) || invoice.invoice_number.trim() === "" || invoice.billing_party.trim() === "") {
    return false;
  }
  if (invoice.unresolved.length > 0) return false;
  const cited = readElements(invoice);
  if (cited === null) return false;
  const lines = readLines(invoice);
  if (lines === null) return false;
  ready.push({
    number: invoice.invoice_number,
    party: invoice.billing_party,
    currency: invoice.currency,
    date: cited.date,
    citation: cited.citation,
    lines,
  });
  return true;
}

function readElements(invoice: DuplicateInvoice): { date: string; citation: string } | null {
  let date: string | undefined;
  let citation: string | undefined;
  for (const key of ELEMENT_KEYS) {
    const view = forRules(invoice.elements[key]);
    if (view.state === "suggested_absent" || view.state === "unreadable") return null;
    if (view.state !== "present") continue;
    if (key === "invoice_date") {
      const parsed = view.value !== undefined && isoDate.test(view.value) ? view.value : parseDate(view.text);
      if (isUnreadable(parsed)) return null;
      date = parsed;
    }
    if (key === "applicable_rule") {
      if (view.text.trim() === "") return null;
      citation = view.text;
    }
  }
  if (date === undefined || citation === undefined) return null;
  return { date, citation };
}

function readLines(invoice: DuplicateInvoice): ReadyLine[] | null {
  const lines: ReadyLine[] = [];
  for (const line of invoice.lines) {
    if (line.id.trim() === "" || line.container.trim() === "" || line.charge.trim() === "") return null;
    if (!validPage(line.container_page) || !validPage(line.from_page) || !validPage(line.to_page) || !validPage(line.rate_page)) {
      return null;
    }
    const from = parseDate(line.charged_from);
    const to = parseDate(line.charged_to);
    if (isUnreadable(from) || isUnreadable(to) || from > to) return null;
    const rate = parseMoney(line.rate);
    if ("status" in rate || (rate.currency !== null && rate.currency !== invoice.currency)) return null;
    lines.push({
      id: line.id,
      container: line.container,
      charge: line.charge,
      from,
      to,
      rate: rate.amount,
      containerPage: line.container_page,
      fromPage: line.from_page,
      toPage: line.to_page,
      ratePage: line.rate_page,
    });
  }
  return lines;
}

function compare(
  left: ReadyInvoice,
  right: ReadyInvoice,
  reissues: readonly ReissueLink[],
  overlaps: Map<string, Overlap>,
  unresolved: Set<string>,
): void {
  if (left.party !== right.party || left.currency !== right.currency) return;
  if (linked(reissues, left.number, right.number)) return;
  if (left.date === right.date) {
    if (sharesOverlap(left, right)) {
      unresolved.add(left.number);
      unresolved.add(right.number);
    }
    return;
  }
  const earlier = left.date < right.date ? left : right;
  const later = left.date < right.date ? right : left;
  for (const line of later.lines) {
    for (const other of earlier.lines) {
      if (line.container !== other.container || line.charge !== other.charge) continue;
      const days = overlapDays(line.from, line.to, other.from, other.to);
      if (days.length === 0) continue;
      const overlap = bucket(overlaps, later, line);
      for (const day of days) overlap.days.add(day);
      const range = `${other.from} through ${other.to}`;
      let note = overlap.earlier.find((item) => item.number === earlier.number);
      if (note === undefined) {
        note = { number: earlier.number, date: earlier.date, ranges: [] };
        overlap.earlier.push(note);
      }
      if (!note.ranges.includes(range)) note.ranges.push(range);
    }
  }
}

function toFinding(overlap: Overlap): Finding | null | undefined {
  const notes = [...overlap.earlier].sort(byEarlier);
  const days = [...overlap.days].sort();
  if (days.length === 0 || notes.length === 0) return undefined;
  const priced = times(overlap.line.rate, days.length);
  if (!priced.greaterThan(new Decimal("0"))) return undefined;
  const amount = money(priced);
  const rateText = money(overlap.line.rate);
  if (amount === null || rateText === null) return null;
  const phrase = dayPhrase(days);
  const earlierText = notes.map((note) => `${note.number} (${note.ranges.join("; ")})`).join("; ");
  const sentences = notes.map((note) => earlierSentence(note, overlap.line.container, overlap.line.charge));
  return findingSchema.parse({
    rule: "R5",
    rule_version: 1,
    ground: "duplicate_charge",
    citations: [overlap.later.citation],
    invoice_id: overlap.later.number,
    line_ids: [overlap.line.id],
    expected: `no overlapping charge with ${earlierText}`,
    actual: `${phrase}, at ${rateText} ${overlap.later.currency} per day`,
    disputable_amount: amount,
    currency: overlap.later.currency,
    evidence: [
      { page: overlap.line.containerPage, field: "container" },
      { page: overlap.line.fromPage, field: "charged_from" },
      { page: overlap.line.toPage, field: "charged_to" },
      { page: overlap.line.ratePage, field: "rate" },
    ],
    explain: `${sentences.join(" ")} Overlap on ${overlap.later.number} is ${phrase}, at ${rateText} ${overlap.later.currency} per day.`,
  });
}

function earlierSentence(note: EarlierNote, container: string, charge: string): string {
  const ranges = note.ranges.map((range) => `from ${range}`).join(" and ");
  return `${note.number} charged ${container} ${charge} ${ranges}.`;
}

function sharesOverlap(left: ReadyInvoice, right: ReadyInvoice): boolean {
  for (const line of left.lines) {
    for (const other of right.lines) {
      if (line.container !== other.container || line.charge !== other.charge) continue;
      if (overlapDays(line.from, line.to, other.from, other.to).length > 0) return true;
    }
  }
  return false;
}

function overlapDays(leftFrom: string, leftTo: string, rightFrom: string, rightTo: string): string[] {
  const start = leftFrom > rightFrom ? leftFrom : rightFrom;
  const end = leftTo < rightTo ? leftTo : rightTo;
  if (start > end) return [];
  const days: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    days.push(cursor);
    const next = addDays(cursor, 1);
    if (next <= cursor) break;
    cursor = next;
  }
  return days;
}

function bucket(overlaps: Map<string, Overlap>, later: ReadyInvoice, line: ReadyLine): Overlap {
  const key = `${later.number}\u0000${line.id}`;
  const existing = overlaps.get(key);
  if (existing !== undefined) return existing;
  const created: Overlap = { later, line, days: new Set(), earlier: [] };
  overlaps.set(key, created);
  return created;
}

function linked(reissues: readonly ReissueLink[], left: string, right: string): boolean {
  return reissues.some(
    (link) =>
      (link.invoice_number === left && link.reissue_of === right)
      || (link.invoice_number === right && link.reissue_of === left),
  );
}

function times(rate: Decimal, days: number): Decimal {
  let sum = new Decimal("0");
  for (let day = 0; day < days; day += 1) sum = sum.plus(rate);
  return sum;
}

function dayPhrase(days: readonly string[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (first === undefined || last === undefined) return "0 days";
  if (days.length === 1) return `1 day, ${first}`;
  const word = "days";
  if (dayCount(first, last, "day1") === days.length) return `${days.length} ${word}, ${first} through ${last}`;
  return `${days.length} ${word} (${days.join(", ")})`;
}

function money(value: Decimal): string | null {
  const text = value.toFixed(2);
  return moneyText.test(text) ? text : null;
}

function byLaterLine(left: Overlap, right: Overlap): number {
  if (left.later.date !== right.later.date) return left.later.date < right.later.date ? -1 : 1;
  if (left.later.number !== right.later.number) return left.later.number < right.later.number ? -1 : 1;
  if (left.line.id === right.line.id) return 0;
  return left.line.id < right.line.id ? -1 : 1;
}

function byEarlier(left: EarlierNote, right: EarlierNote): number {
  if (left.date !== right.date) return left.date < right.date ? -1 : 1;
  if (left.number === right.number) return 0;
  return left.number < right.number ? -1 : 1;
}

function repeatedNumbers(invoices: readonly DuplicateInvoice[]): Set<string> {
  const counts = new Map<string, number>();
  for (const invoice of invoices) counts.set(invoice.invoice_number, (counts.get(invoice.invoice_number) ?? 0) + 1);
  const repeated = new Set<string>();
  for (const [number, count] of counts) {
    if (count > 1) repeated.add(number);
  }
  return repeated;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function validPage(page: number): boolean {
  return Number.isInteger(page) && page >= 1;
}
