import { Decimal } from "decimal.js";
import { unreadable, type Unreadable } from "./dates.js";

/**
 * Printed amounts become exact decimals. Build every Decimal from a digit string.
 * A JavaScript float must not appear in this file.
 */

export type MoneyHint = "EU";

export type Money = {
  amount: Decimal;
  currency: string | null;
};

const PLAIN = /^(?:0|[1-9]\d*)$/;
const US_GROUPS = /^(?:0|[1-9]\d{0,2})(?:,\d{3})+$/;
const EU_GROUPS = /^(?:0|[1-9]\d{0,2})(?:\.\d{3})+$/;

/** Read one printed amount. `$` means USD. A bare number has no currency. Bad text is `unreadable`. */
export function parseMoney(text: string, formatHint?: MoneyHint): Money | Unreadable {
  if (typeof text !== "string") return unreadable;
  const value = text.trim();
  if (value.length === 0 || value.includes("+")) return unreadable;
  if (isCreditMarker(value)) return unreadable;
  if (formatHint !== undefined && formatHint !== "EU") return unreadable;

  const signed = splitSign(value);
  if (signed === undefined) return unreadable;
  const parsed = parsePositive(signed.body, formatHint === "EU");
  if (parsed === undefined) return unreadable;
  const digits = signed.negative ? `-${parsed.digits}` : parsed.digits;
  return { amount: new Decimal(digits), currency: parsed.currency };
}

function isCreditMarker(value: string): boolean {
  return /CR\s*$/i.test(value) || /(?:^|[^A-Za-z])CR(?:[^A-Za-z]|$)/i.test(value);
}

function splitSign(value: string): { body: string; negative: boolean } | undefined {
  if (value.includes("(") || value.includes(")")) {
    if (!value.startsWith("(") || !value.endsWith(")")) return undefined;
    const inner = value.slice(1, -1).trim();
    if (inner.length === 0 || /[()+-]/.test(inner)) return undefined;
    return { body: inner, negative: true };
  }

  const marks = value.match(/-/g);
  if (marks === null) return { body: value, negative: false };
  if (marks.length !== 1) return undefined;

  if (value.startsWith("-")) {
    const body = value.slice(1).trim();
    return body.length === 0 ? undefined : { body, negative: true };
  }
  if (/^\$\s*-\s*\S/.test(value) || /^[A-Za-z]{3}\s+-\s*\S/.test(value)) {
    return { body: value.replace("-", ""), negative: true };
  }
  return undefined;
}

function parsePositive(body: string, eu: boolean): { digits: string; currency: string | null } | undefined {
  const dollar = /^\$(.*)$/.exec(body);
  if (dollar !== null) {
    return amountOf((dollar[1] ?? "").trim(), "USD", eu);
  }

  const prefix = /^([A-Za-z]{3})\s+(\S.*)$/.exec(body);
  if (prefix !== null) {
    return amountOf((prefix[2] ?? "").trim(), (prefix[1] ?? "").toUpperCase(), eu);
  }

  const suffix = /^(.*\S)\s+([A-Za-z]{3})$/.exec(body);
  if (suffix !== null) {
    return amountOf((suffix[1] ?? "").trim(), (suffix[2] ?? "").toUpperCase(), eu);
  }

  return amountOf(body.trim(), null, eu);
}

function amountOf(body: string, currency: string | null, eu: boolean): { digits: string; currency: string | null } | undefined {
  if (body.length === 0 || /[A-Za-z$]/.test(body)) return undefined;
  const digits = canonical(body, eu);
  if (digits === undefined) return undefined;
  return { digits, currency };
}

function canonical(body: string, eu: boolean): string | undefined {
  if (!/^[0-9.,]+$/.test(body)) return undefined;
  const dot = body.lastIndexOf(".");
  const comma = body.lastIndexOf(",");

  if (!eu) {
    if (dot !== -1 && comma > dot) return undefined;
    if (dot === -1 && comma === -1) return PLAIN.test(body) ? body : undefined;
    if (dot === -1) return US_GROUPS.test(body) ? ungroup(body, ",") : undefined;
    if (comma === -1) {
      if (EU_GROUPS.test(body)) return undefined;
      return fraction(body, ".");
    }
    return groupedFraction(body, dot, ",", US_GROUPS);
  }

  if (dot === -1 && comma === -1) return PLAIN.test(body) ? body : undefined;
  if (comma === -1) return EU_GROUPS.test(body) ? ungroup(body, ".") : undefined;
  if (dot > comma) return undefined;
  if (dot === -1) {
    if (US_GROUPS.test(body)) return undefined;
    return fraction(body, ",");
  }
  return groupedFraction(body, comma, ".", EU_GROUPS);
}

function groupedFraction(
  body: string,
  decimalAt: number,
  separator: "," | ".",
  groups: RegExp,
): string | undefined {
  const whole = body.slice(0, decimalAt);
  const fractionDigits = body.slice(decimalAt + 1);
  if (!/^\d+$/.test(fractionDigits)) return undefined;
  if (!groups.test(whole) && !PLAIN.test(whole)) return undefined;
  const integer = whole.includes(separator) ? ungroup(whole, separator) : whole;
  if (integer === undefined) return undefined;
  return `${integer}.${fractionDigits}`;
}

function fraction(body: string, separator: "." | ","): string | undefined {
  const at = body.indexOf(separator);
  if (at === -1 || at !== body.lastIndexOf(separator)) return undefined;
  const whole = body.slice(0, at);
  const fractionDigits = body.slice(at + 1);
  if (!PLAIN.test(whole) || !/^\d+$/.test(fractionDigits)) return undefined;
  return `${whole}.${fractionDigits}`;
}

function ungroup(value: string, separator: "," | "."): string | undefined {
  const digits = value.replaceAll(separator, "");
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  return trimmed.length === 0 ? "0" : trimmed;
}
