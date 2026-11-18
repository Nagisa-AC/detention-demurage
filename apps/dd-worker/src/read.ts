import {
  ELEMENT_KEYS,
  assignPresence,
  isUnreadable,
  parseDate,
  parseMoney,
  stitch,
  type ElementKey,
  type ElementValue,
  type PageExtraction,
  type StitchedChargeLine,
  type StitchedInvoice,
  type UnresolvedFragment,
} from "dd-core";
import { NormalizeError } from "./errors.js";
import { groundValue } from "./ground.js";

/** Every customer is an importer until a shipment says otherwise. */
export const MOVEMENT = "import" as const;

const LINE_FIELDS = ["container", "charge", "charged_from", "charged_to", "days", "rate", "amount"] as const;

type HeaderField = "invoice_number" | "billing_party" | "billed_party" | "currency";

export type SavedElement = {
  key: ElementKey;
  state: ElementValue["state"];
  text: string | null;
  value: string | null;
  page: number | null;
  region: { x: string; y: string; w: string; h: string } | null;
  grounded: boolean | null;
};

export type SavedLine = {
  lineId: string;
  container: string;
  charge: "demurrage" | "detention";
  chargedFrom: string;
  chargedTo: string;
  days: number;
  rate: string;
  amount: string;
  currency: string;
  grounded: boolean;
  containerPage: number;
  fromPage: number;
  toPage: number;
  daysPage: number;
  ratePage: number;
  amountPage: number;
};

export type SavedRead = {
  invoiceNumber: string;
  billingParty: string;
  billedParty: string;
  currency: string;
  invoiceDate: string | null;
  dueDate: string | null;
  pageCount: number;
  elements: SavedElement[];
  lines: SavedLine[];
  unresolved: UnresolvedFragment[];
};

/**
 * Stitch the pages the model returned, then assign presence.
 * A stitch conflict stays in the result. A line that will not parse does not.
 */
export function assembleRead(pages: readonly PageExtraction[], pageTexts: readonly string[]): SavedRead {
  const stitched = stitch([...pages]);
  const elements = assignPresence(stitched, MOVEMENT);
  const currency = requiredCurrency(stitched);
  return {
    invoiceNumber: requiredHeader(stitched, "invoice_number"),
    billingParty: requiredHeader(stitched, "billing_party"),
    billedParty: requiredHeader(stitched, "billed_party"),
    currency,
    invoiceDate: storedDate(elements.invoice_date),
    dueDate: storedDate(elements.invoice_due_date),
    pageCount: pageCount(pageTexts),
    elements: ELEMENT_KEYS.map((key) => savedElement(key, elements[key], pageTexts)),
    lines: stitched.charge_lines.map((line) => savedLine(line, currency, pageTexts)),
    unresolved: stitched.unresolved,
  };
}

function pageCount(pageTexts: readonly string[]): number {
  if (pageTexts.length < 1) throw new NormalizeError();
  return pageTexts.length;
}

function requiredHeader(invoice: StitchedInvoice, field: HeaderField): string {
  const text = headerText(invoice, field)?.trim();
  if (text === undefined || text.length === 0) throw new NormalizeError();
  return text;
}

function requiredCurrency(invoice: StitchedInvoice): string {
  const text = requiredHeader(invoice, "currency");
  if (!/^[A-Z]{3}$/.test(text)) throw new NormalizeError();
  return text;
}

function headerText(invoice: StitchedInvoice, field: HeaderField): string | undefined {
  const kept = invoice[field];
  if (kept !== undefined) return kept.text;
  const conflict = invoice.header_conflicts.find((entry) => entry.field === field);
  if (conflict === undefined) return undefined;
  return conflict.values.reduce((first, item) => (item.page < first.page ? item : first)).text;
}

function storedDate(element: ElementValue): string | null {
  if (element.state !== "present" || element.value === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(element.value)) return null;
  return element.value;
}

function savedElement(key: ElementKey, element: ElementValue, pageTexts: readonly string[]): SavedElement {
  return {
    key,
    state: element.state,
    text: element.text ?? null,
    value: element.value ?? null,
    page: element.page,
    region: savedRegion(element),
    grounded: elementGrounded(element, pageTexts),
  };
}

function elementGrounded(element: ElementValue, pageTexts: readonly string[]): boolean | null {
  if (element.state === "suggested_absent" || element.state === "not_applicable") return null;
  if (element.text === undefined || element.page === null) return false;
  return groundValue(pageTexts[element.page - 1] ?? "", element.text) !== "miss";
}

function savedRegion(element: ElementValue): SavedElement["region"] {
  const region = element.region;
  if (region === undefined) return null;
  const x = unitString(region.x);
  const y = unitString(region.y);
  const w = unitString(region.w);
  const h = unitString(region.h);
  if (x === null || y === null || w === null || h === null) return null;
  return { x, y, w, h };
}

function unitString(value: number): string | null {
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  return value.toFixed(8);
}

function savedLine(line: StitchedChargeLine, currency: string, pageTexts: readonly string[]): SavedLine {
  const charge = line.charge?.text;
  if (charge !== "demurrage" && charge !== "detention") throw new NormalizeError();
  const container = line.container.text.trim();
  if (container.length === 0) throw new NormalizeError();
  const from = line.charged_from;
  const to = line.charged_to;
  const days = line.days;
  const rate = line.rate;
  if (from === undefined || to === undefined || days === undefined || rate === undefined) throw new NormalizeError();
  return {
    lineId: line.id,
    container,
    charge,
    chargedFrom: requiredDate(from.text),
    chargedTo: requiredDate(to.text),
    days: requiredDays(days.text),
    rate: requiredMoney(rate.text, currency),
    amount: requiredMoney(line.amount.text, currency),
    currency,
    grounded: lineGrounded(line, pageTexts),
    containerPage: requiredPage(line.container.page),
    fromPage: requiredPage(from.page),
    toPage: requiredPage(to.page),
    daysPage: requiredPage(days.page),
    ratePage: requiredPage(rate.page),
    amountPage: requiredPage(line.amount.page),
  };
}

function requiredPage(page: number): number {
  if (!Number.isInteger(page) || page < 1) throw new NormalizeError();
  return page;
}

function lineGrounded(line: StitchedChargeLine, pageTexts: readonly string[]): boolean {
  for (const field of LINE_FIELDS) {
    const printed = line[field];
    if (printed === undefined) continue;
    if (groundValue(pageTexts[printed.page - 1] ?? "", printed.text) === "miss") return false;
  }
  return true;
}

function requiredDate(text: string | undefined): string {
  if (text === undefined) throw new NormalizeError();
  const parsed = parseDate(text);
  if (isUnreadable(parsed)) throw new NormalizeError();
  return parsed;
}

function requiredDays(text: string | undefined): number {
  const value = text?.trim();
  if (value === undefined || !/^(0|[1-9]\d*)$/.test(value)) throw new NormalizeError();
  return Number(value);
}

function requiredMoney(text: string | undefined, currency: string): string {
  if (text === undefined) throw new NormalizeError();
  const parsed = parseMoney(text);
  if ("status" in parsed || parsed.amount.isNegative()) throw new NormalizeError();
  if (parsed.currency !== null && parsed.currency !== currency) throw new NormalizeError();
  return parsed.amount.toFixed(2);
}
