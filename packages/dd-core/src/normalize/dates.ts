/**
 * Printed dates become ISO strings. `Date` stays inside this file, at UTC midnight,
 * so a calendar day does not move with the machine's zone.
 */

export const unreadable = { status: "unreadable" } as const;

export type Unreadable = typeof unreadable;

export type FormatHint = "DMY" | "MDY";

export type DayConvention = "day0" | "day1";

const MONTHS: readonly (readonly [string, string])[] = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may", "may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sep"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
];

const MS_PER_DAY = 86_400_000;

export function isUnreadable(value: string | Unreadable): value is Unreadable {
  return typeof value === "object" && value.status === "unreadable";
}

/** Read a printed date. Bad text is `unreadable`. A hint is used only for slash and dot forms. */
export function parseDate(text: string, formatHint?: FormatHint): string | Unreadable {
  if (typeof text !== "string") return unreadable;
  const value = text.trim();
  if (value.length === 0) return unreadable;

  const iso = matchIso(value);
  if (iso !== undefined) return iso;

  const named = matchNamed(value);
  if (named !== undefined) return named;

  const numeric = matchNumeric(value, formatHint);
  if (numeric !== undefined) return numeric;

  return unreadable;
}

/**
 * Calendar days from `from` to `to`. `day0` counts the start as day 0.
 * `day1` counts the start as day 1, so it is `day0 + 1`.
 */
export function dayCount(from: string, to: string, convention: DayConvention): number {
  if (convention !== "day0" && convention !== "day1") {
    throw new TypeError("convention must be day0 or day1");
  }
  const days = utcDaysBetween(from, to);
  return convention === "day0" ? days : days + 1;
}

/** Move a calendar day by an integer number of days. `days` may be negative. */
export function addDays(iso: string, days: number): string {
  if (!Number.isInteger(days)) throw new TypeError("days must be an integer");
  const date = utcMidnight(iso);
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  if (year < 0 || year > 9999) throw new TypeError("date must be a real YYYY-MM-DD");
  return formatUtc(date);
}

function matchIso(value: string): string | Unreadable | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return undefined;
  return fromParts(groupNumber(match, 1), groupNumber(match, 2), groupNumber(match, 3));
}

function matchNamed(value: string): string | Unreadable | undefined {
  const hyphen = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value);
  if (hyphen !== null) {
    const month = monthNumber(hyphen[2] ?? "");
    if (month === undefined) return unreadable;
    return fromParts(groupNumber(hyphen, 3), month, groupNumber(hyphen, 1));
  }

  const dayFirst = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(value);
  if (dayFirst !== null) {
    const month = monthNumber(dayFirst[2] ?? "");
    if (month === undefined) return unreadable;
    return fromParts(groupNumber(dayFirst, 3), month, groupNumber(dayFirst, 1));
  }

  const monthFirst = /^([A-Za-z]+)\s+(\d{1,2})(?:\s*,\s*|\s+)(\d{4})$/.exec(value);
  if (monthFirst !== null) {
    const month = monthNumber(monthFirst[1] ?? "");
    if (month === undefined) return unreadable;
    return fromParts(groupNumber(monthFirst, 3), month, groupNumber(monthFirst, 2));
  }

  return undefined;
}

function matchNumeric(value: string, formatHint: FormatHint | undefined): string | Unreadable | undefined {
  const match = /^(\d{1,2})([./])(\d{1,2})\2(\d{4})$/.exec(value);
  if (match === null) return undefined;
  if (formatHint !== "DMY" && formatHint !== "MDY") return unreadable;
  const first = groupNumber(match, 1);
  const second = groupNumber(match, 3);
  const year = groupNumber(match, 4);
  const day = formatHint === "DMY" ? first : second;
  const month = formatHint === "DMY" ? second : first;
  return fromParts(year, month, day);
}

function monthNumber(token: string): number | undefined {
  const name = token.toLowerCase();
  const index = MONTHS.findIndex(([full, abbreviation]) => name === full || name === abbreviation);
  return index === -1 ? undefined : index + 1;
}

function fromParts(year: number, month: number, day: number): string | Unreadable {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return unreadable;
  if (year < 0 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return unreadable;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return unreadable;
  }
  return formatUtc(date);
}

function formatUtc(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function groupNumber(match: RegExpExecArray, index: number): number {
  const part = match[index];
  return part === undefined ? Number.NaN : Number(part);
}

/** Both instants are UTC midnight, so the difference is a whole number of days. */
function utcDaysBetween(from: string, to: string): number {
  return Math.round((utcMidnight(to).getTime() - utcMidnight(from).getTime()) / MS_PER_DAY);
}

function utcMidnight(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) throw new TypeError("date must be a real YYYY-MM-DD");
  const year = groupNumber(match, 1);
  const month = groupNumber(match, 2);
  const day = groupNumber(match, 3);
  if (isUnreadable(fromParts(year, month, day))) throw new TypeError("date must be a real YYYY-MM-DD");
  return new Date(Date.UTC(year, month - 1, day));
}
