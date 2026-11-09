import { ELEMENTS, ELEMENT_KEYS, type ElementKey } from "./elements.js";
import { isUnreadable, parseDate, type FormatHint } from "./normalize/dates.js";
import { parseContainer } from "./normalize/container.js";
import { parseMoney } from "./normalize/money.js";
import { isConfirmedAbsent, type ConfirmedAbsent } from "./review.js";
import {
  elementRecordSchema,
  type ElementRecord,
  type ElementValue,
  type Region,
  type StitchedInvoice,
} from "./schema.js";

export type Movement = "import" | "export";

const DATE_KEYS = new Set<ElementKey>([
  "invoice_date",
  "invoice_due_date",
  "free_time_start",
  "free_time_end",
  "container_availability_date",
  "earliest_return_date",
]);

/**
 * Rules never read `text` or `value` from an unreadable element.
 * Review still sees the printed text on the presence result.
 * `forRules` is the view a rule is allowed to read.
 */
export type RuleElement =
  | {
      state: "present";
      text: string;
      value?: string;
      page: number;
    }
  | {
      state: "unreadable";
      page: number;
    }
  | {
      state: "suggested_absent";
      page: null;
    }
  | {
      state: "not_applicable";
      page: null;
    }
  | ConfirmedAbsent;

/**
 * Drop text and value when the element is unreadable. Rules call this, not the raw element.
 * A rule that reads `element.text` or `element.value` on an unreadable element is wrong.
 */
export function forRules(element: ElementValue | ConfirmedAbsent): RuleElement {
  if (isConfirmedAbsent(element)) return element;
  if (element.state === "unreadable") {
    return { state: "unreadable", page: seenPage(element) };
  }
  if (element.state === "present") {
    if (element.text === undefined) throw new Error("A present element has text.");
    const rule: RuleElement = { state: "present", text: element.text, page: seenPage(element) };
    if (element.value !== undefined) rule.value = element.value;
    return rule;
  }
  if (element.state === "suggested_absent") return { state: "suggested_absent", page: null };
  if (element.state === "not_applicable") return { state: "not_applicable", page: null };
  throw new Error("That element is not a rule input.");
}

function seenPage(element: ElementValue): number {
  if (element.page === null) throw new Error("A seen element has a page.");
  return element.page;
}

/**
 * Map a stitched invoice onto the 20 elements.
 * `dateHint` is only for slash and dot dates. Where it comes from per billing party is still open.
 */
export function assignPresence(invoice: StitchedInvoice, movement: Movement, dateHint?: FormatHint): ElementRecord {
  const elements = {} as ElementRecord;
  for (const key of ELEMENT_KEYS) {
    elements[key] = assignKey(invoice, key, movement, dateHint);
  }
  return elementRecordSchema.parse(elements);
}

function assignKey(invoice: StitchedInvoice, key: ElementKey, movement: Movement, dateHint: FormatHint | undefined): ElementValue {
  if (!applies(key, movement)) return { state: "not_applicable", page: null };

  const conflict = invoice.conflicts.find((entry) => entry.key === key);
  if (conflict !== undefined) {
    const earlier = conflict.values.reduce((first, item) => (item.page < first.page ? item : first));
    return { state: "unreadable", text: earlier.text, page: earlier.page };
  }

  const printed = invoice.elements[key];
  if (printed === undefined) return { state: "suggested_absent", page: null };
  return readPrinted(key, printed.text, printed.page, printed.region, invoice, dateHint);
}

function applies(key: ElementKey, movement: Movement): boolean {
  const applicability = ELEMENTS[key].applicability;
  if (applicability === "both") return true;
  return applicability === movement;
}

function readPrinted(
  key: ElementKey,
  text: string,
  page: number,
  region: Region | undefined,
  invoice: StitchedInvoice,
  dateHint: FormatHint | undefined,
): ElementValue {
  if (key === "container_number") return fromParse(text, page, region, parseContainer(text));
  if (DATE_KEYS.has(key)) return fromParse(text, page, region, parseDate(text, dateHint));
  if (key === "total_due") return fromMoney(text, page, region, invoice);
  return seen(text, page, region);
}

function fromParse(text: string, page: number, region: Region | undefined, parsed: string | { status: "unreadable" }): ElementValue {
  if (isUnreadable(parsed)) return unread(text, page, region);
  return seen(text, page, region, parsed);
}

function fromMoney(text: string, page: number, region: Region | undefined, invoice: StitchedInvoice): ElementValue {
  const parsed = parseMoney(text);
  if ("status" in parsed) return unread(text, page, region);
  const header = invoice.currency?.text;
  if (parsed.currency !== null && header !== undefined && parsed.currency !== header) return unread(text, page, region);
  return seen(text, page, region, parsed.amount.toFixed(2));
}

function seen(text: string, page: number, region: Region | undefined, value?: string): ElementValue {
  const element: ElementValue = { state: "present", text, page };
  if (region !== undefined) element.region = region;
  if (value !== undefined) element.value = value;
  return element;
}

function unread(text: string, page: number, region: Region | undefined): ElementValue {
  const element: ElementValue = { state: "unreadable", text, page };
  if (region !== undefined) element.region = region;
  return element;
}
