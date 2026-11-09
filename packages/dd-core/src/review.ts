import { z } from "zod";
import { ELEMENT_KEYS, type ElementKey } from "./elements.js";
import { isUnreadable, parseDate, type FormatHint } from "./normalize/dates.js";
import { parseContainer } from "./normalize/container.js";
import { parseMoney } from "./normalize/money.js";
import type { ElementRecord, ElementValue, StitchedChargeLine, StitchedInvoice, UnresolvedFragment } from "./schema.js";
import { elementValueSchema, regionSchema, stitchedInvoiceSchema } from "./schema.js";

/**
 * Only this file can set the brand. A ConfirmedAbsent value requires it,
 * so an object literal in any other module does not typecheck.
 * JSON drops the symbol. A confirmed absence comes back only through loadReview.
 */
const confirmedAbsentBrand: unique symbol = Symbol("confirmedAbsent");

export type ConfirmedAbsent = {
  readonly [confirmedAbsentBrand]: true;
  state: "confirmed_absent";
  page: null;
  text?: string;
  value?: string;
  decided_by?: string;
  decided_at?: string;
};

export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewError";
  }
}

const LINE_FIELDS = ["container", "charge", "charged_from", "charged_to", "days", "rate", "amount"] as const;
type LineField = (typeof LINE_FIELDS)[number];

const DATE_KEYS = new Set<ElementKey>([
  "invoice_date",
  "invoice_due_date",
  "free_time_start",
  "free_time_end",
  "container_availability_date",
  "earliest_return_date",
]);

type ElementOutcome = "confirmed_absent" | "present" | "unreadable";
const CARRIED_OUTCOMES = ["present", "unreadable"] as const;

export const savedDecisionSchema = z.strictObject({
  document_hash: z.string().min(1),
  element_key: z.string().min(1),
  extracted_text: z.string().nullable(),
  outcome: z.enum(["confirmed_absent", "present", "unreadable", "dismissed", "edited", "joined", "split", "approved"]),
  text: z.string().min(1).exactOptional(),
  value: z.string().min(1).exactOptional(),
  page: z.int().positive().nullable(),
  reason: z.string().min(1).exactOptional(),
  field: z.string().min(1).exactOptional(),
  before: z.string().min(1).exactOptional(),
  after: z.string().min(1).exactOptional(),
  decided_by: z.string().min(1),
  decided_at: z.string().min(1),
});

export type SavedDecision = z.infer<typeof savedDecisionSchema>;

export type ReviewedElement = ElementValue | ConfirmedAbsent;

export type ReviewResult = {
  document_hash: string;
  acknowledged_pages: number[];
  elements: Record<ElementKey, ReviewedElement>;
  invoice: StitchedInvoice;
  decisions: SavedDecision[];
  line_approval: { decided_by: string; decided_at: string } | null;
};

type SessionInput = {
  documentHash: string;
  invoice: StitchedInvoice;
  elements: ElementRecord;
  pages: number;
  name: string;
  at: string;
  dateHint?: FormatHint;
  priorDecisions?: readonly SavedDecision[];
};

export function isConfirmedAbsent(value: unknown): value is ConfirmedAbsent {
  return typeof value === "object" && value !== null && confirmedAbsentBrand in value;
}

const plainConfirmedAbsentSchema = z.strictObject({
  state: z.literal("confirmed_absent"),
  text: z.string().exactOptional(),
  value: z.string().exactOptional(),
  page: z.null(),
  region: regionSchema.exactOptional(),
  decided_by: z.string().min(1).exactOptional(),
  decided_at: z.string().min(1).exactOptional(),
});

const storedElementSchema = z.union([elementValueSchema, plainConfirmedAbsentSchema]);

const storedElementRecordSchema = z.strictObject(
  Object.fromEntries(ELEMENT_KEYS.map((key) => [key, storedElementSchema])) as Record<ElementKey, typeof storedElementSchema>,
);

const reviewRecordSchema = z.strictObject({
  document_hash: z.string().min(1),
  acknowledged_pages: z.array(z.int().positive()),
  elements: storedElementRecordSchema,
  invoice: stitchedInvoiceSchema,
  decisions: z.array(savedDecisionSchema),
  line_approval: z.strictObject({
    decided_by: z.string().min(1),
    decided_at: z.string().min(1),
  }).nullable(),
});

/**
 * Put the brand back on a finished review.
 * A loose decision cannot do this. The record has to be the finished review
 * for its own document hash, with every page acknowledged and the lines approved.
 */
export function loadReview(record: unknown, pages: number): ReviewResult {
  if (!Number.isInteger(pages) || pages < 1) throw new ReviewError("A review needs at least one page.");
  const parsed = reviewRecordSchema.safeParse(record);
  if (!parsed.success) throw new ReviewError("That record is not a finished review.");
  const saved = parsed.data;
  if (saved.line_approval === null) throw new ReviewError("A finished review approves the charge lines.");
  if (saved.invoice.unresolved.length > 0) throw new ReviewError("Finish while a fragment is unresolved.");
  requireAcknowledged(saved.acknowledged_pages, pages);

  const absences = new Map<ElementKey, SavedDecision>();
  for (const decision of saved.decisions) {
    if (decision.document_hash !== saved.document_hash) {
      throw new ReviewError("That decision is for a different document.");
    }
    if (decision.outcome !== "confirmed_absent") continue;
    if (!isElementKey(decision.element_key)) throw new ReviewError("That decision is not an element.");
    absences.set(decision.element_key, decision);
  }

  const elements = {} as Record<ElementKey, ReviewedElement>;
  for (const key of ELEMENT_KEYS) {
    const element = saved.elements[key];
    const decision = absences.get(key);
    if (element.state === "confirmed_absent") {
      if (decision === undefined) throw new ReviewError(`${key} has no confirmed-absent decision.`);
      elements[key] = confirmAbsent({ decided_by: decision.decided_by, decided_at: decision.decided_at });
      continue;
    }
    if (decision !== undefined) throw new ReviewError(`${key} is ${element.state}.`);
    if (element.state === "suggested_absent" || element.state === "unreadable") {
      throw new ReviewError(`Finish while ${key} is ${element.state}.`);
    }
    elements[key] = element;
  }

  return {
    document_hash: saved.document_hash,
    acknowledged_pages: [...saved.acknowledged_pages].sort((left, right) => left - right),
    elements,
    invoice: saved.invoice,
    decisions: saved.decisions,
    line_approval: saved.line_approval,
  };
}

/**
 * Loose decisions apply only when the document hash matches.
 * Present and unreadable outcomes also require the extracted text to be unchanged.
 * A confirmed absence is never carried from a loose decision.
 * A different file, such as a reissue, starts with no decisions.
 */
export function carryDecisions(
  documentHash: string,
  decisions: readonly SavedDecision[],
  elements: ElementRecord,
  invoice: StitchedInvoice,
): { elements: Record<ElementKey, ReviewedElement>; invoice: StitchedInvoice; applied: SavedDecision[] } {
  const carried: Record<ElementKey, ReviewedElement> = { ...elements };
  const chosen = new Map<ElementKey, SavedDecision>();
  const dismissals = new Set<string>();
  const applied: SavedDecision[] = [];

  for (const decision of decisions) {
    if (decision.document_hash !== documentHash) continue;
    if (decision.outcome === "confirmed_absent") continue;
    if (isElementKey(decision.element_key) && isCarriedOutcome(decision.outcome)) {
      const current = elements[decision.element_key];
      if (decision.extracted_text !== extractedText(current)) continue;
      chosen.set(decision.element_key, decision);
      continue;
    }
    if (decision.outcome === "dismissed" && decision.element_key.startsWith("fragment|")) {
      dismissals.add(decision.element_key);
    }
  }

  for (const [key, decision] of chosen) {
    carried[key] = restoreCarried(decision);
    applied.push(decision);
  }

  const unresolved = invoice.unresolved.filter((fragment) => {
    const key = fragmentKey(fragment);
    if (!dismissals.has(key)) return true;
    const decision = decisions.find((entry) => entry.document_hash === documentHash && entry.element_key === key);
    if (decision !== undefined && !applied.includes(decision)) applied.push(decision);
    return false;
  });
  return {
    elements: carried,
    invoice: stitchedInvoiceSchema.parse({ ...invoice, unresolved }),
    applied,
  };
}

export function startReview(input: SessionInput): ReviewSession {
  if (input.documentHash.trim() === "") throw new ReviewError("A review needs a document hash.");
  if (!Number.isInteger(input.pages) || input.pages < 1) throw new ReviewError("A review needs at least one page.");
  if (input.name.trim() === "") throw new ReviewError("A review needs a name.");
  if (input.at.trim() === "") throw new ReviewError("A review needs a time.");
  return new ReviewSession(input);
}

export class ReviewSession {
  private readonly documentHash: string;
  private readonly pages: number;
  private readonly name: string;
  private readonly at: string;
  private readonly dateHint: FormatHint | undefined;
  private readonly acknowledged = new Set<number>();
  private readonly elements: Record<ElementKey, ReviewedElement>;
  private readonly decisions: SavedDecision[];
  private chargeLines: StitchedChargeLine[];
  private unresolved: UnresolvedFragment[];
  private readonly source: StitchedInvoice;
  private lineApproval: { decided_by: string; decided_at: string } | null = null;

  constructor(input: SessionInput) {
    const carried = carryDecisions(input.documentHash, input.priorDecisions ?? [], input.elements, input.invoice);
    this.documentHash = input.documentHash;
    this.pages = input.pages;
    this.name = input.name;
    this.at = input.at;
    this.dateHint = input.dateHint;
    this.elements = carried.elements;
    this.decisions = [...carried.applied];
    this.source = carried.invoice;
    this.chargeLines = carried.invoice.charge_lines.map((line) => ({ ...line }));
    this.unresolved = carried.invoice.unresolved.map((fragment) => ({ ...fragment }));
  }

  view(): {
    elements: Record<ElementKey, ReviewedElement>;
    unresolved: readonly UnresolvedFragment[];
    header_conflicts: StitchedInvoice["header_conflicts"];
    charge_lines: readonly StitchedChargeLine[];
    decisions: readonly SavedDecision[];
  } {
    return {
      elements: this.elements,
      unresolved: this.unresolved,
      header_conflicts: this.source.header_conflicts,
      charge_lines: this.chargeLines,
      decisions: this.decisions,
    };
  }

  /** Opening the PDF does not call this. Each page is acknowledged on its own. */
  acknowledge(page: number): void {
    if (!Number.isInteger(page) || page < 1 || page > this.pages) {
      throw new ReviewError(`Page ${page} is not in this invoice.`);
    }
    this.acknowledged.add(page);
  }

  confirmAbsent(key: ElementKey): void {
    if (!this.pagesAcknowledged()) {
      throw new ReviewError("Confirm absent after every page has been acknowledged.");
    }
    const current = this.elements[key];
    if (isConfirmedAbsent(current)) throw new ReviewError(`${key} is already confirmed absent.`);
    if (current.state !== "suggested_absent" && current.state !== "unreadable") {
      throw new ReviewError(`${key} is ${current.state}.`);
    }
    this.elements[key] = confirmAbsent({ decided_by: this.name, decided_at: this.at });
    this.decisions.push(this.elementDecision(key, current, "confirmed_absent", { page: null }));
  }

  found(key: ElementKey, page: number, raw: string): void {
    const current = this.elements[key];
    if (isConfirmedAbsent(current) || current.state !== "suggested_absent") {
      throw new ReviewError(`${key} is not suggested absent.`);
    }
    this.requirePage(page);
    const parsed = parseReviewValue(key, raw, this.dateHint, this.source.currency?.text);
    this.elements[key] = presentElement(parsed, page, this.name, this.at);
    this.decisions.push(this.elementDecision(key, current, "present", { page, text: parsed.text, value: parsed.value }));
  }

  correct(key: ElementKey, raw: string): void {
    const current = this.elements[key];
    if (isConfirmedAbsent(current) || current.state !== "unreadable") {
      throw new ReviewError(`${key} is not unreadable.`);
    }
    const page = current.page;
    if (page === null) throw new ReviewError(`${key} has no page.`);
    const parsed = parseReviewValue(key, raw, this.dateHint, this.source.currency?.text);
    this.elements[key] = presentElement(parsed, page, this.name, this.at);
    this.decisions.push(this.elementDecision(key, current, "present", { page, text: parsed.text, value: parsed.value }));
  }

  markUnreadable(key: ElementKey, reason: string): void {
    const current = this.elements[key];
    if (isConfirmedAbsent(current) || current.state !== "present") {
      throw new ReviewError(`${key} is not present.`);
    }
    const trimmed = requiredText(reason, "A reason is required.");
    if (current.text === undefined || current.page === null) throw new ReviewError(`${key} has no printed text.`);
    this.elements[key] = {
      state: "unreadable",
      text: current.text,
      page: current.page,
      decided_by: this.name,
      decided_at: this.at,
    };
    this.decisions.push(this.elementDecision(key, current, "unreadable", {
      page: current.page,
      text: current.text,
      reason: trimmed,
    }));
  }

  approveLines(): void {
    this.lineApproval = { decided_by: this.name, decided_at: this.at };
    this.decisions.push({
      document_hash: this.documentHash,
      element_key: "charge_lines",
      extracted_text: null,
      outcome: "approved",
      page: null,
      decided_by: this.name,
      decided_at: this.at,
    });
  }

  editLine(id: string, field: string, after: string): void {
    if (!isLineField(field)) throw new ReviewError(`${field} is not a charge-line field.`);
    const trimmed = after.trim();
    if (trimmed === "") throw new ReviewError("An edit needs a value.");
    const line = this.chargeLines.find((entry) => entry.id === id);
    if (line === undefined) throw new ReviewError(`Line ${id} is not on the invoice.`);
    const current = line[field];
    if (current === undefined) throw new ReviewError(`Line ${id} has no ${field}.`);
    line[field] = { text: trimmed, page: current.page };
    this.decisions.push({
      document_hash: this.documentHash,
      element_key: `line|${id}|${field}`,
      extracted_text: current.text,
      outcome: "edited",
      page: line[field].page,
      field,
      before: current.text,
      after: trimmed,
      decided_by: this.name,
      decided_at: this.at,
    });
  }

  join(headIndex: number, tailIndex: number): void {
    if (headIndex === tailIndex) throw new ReviewError("A line cannot join with itself.");
    const head = this.unresolved[headIndex];
    const tail = this.unresolved[tailIndex];
    if (head === undefined || tail === undefined) throw new ReviewError("Those fragments are not on the invoice.");
    if (head.container === undefined || head.amount !== undefined) throw new ReviewError("The head needs a container and no amount.");
    if (tail.container !== undefined) throw new ReviewError("The tail needs no container.");
    if (tail.amount === undefined) throw new ReviewError("The tail needs an amount.");
    const line = joinedLine(head, tail, nextLineId(this.chargeLines));
    const drop = new Set([headIndex, tailIndex]);
    this.unresolved = this.unresolved.filter((_, index) => !drop.has(index));
    this.chargeLines = [...this.chargeLines, line];
    this.decisions.push({
      document_hash: this.documentHash,
      element_key: `join|${fragmentKey(head)}|${fragmentKey(tail)}`,
      extracted_text: null,
      outcome: "joined",
      page: head.page,
      decided_by: this.name,
      decided_at: this.at,
    });
  }

  split(lineId: string): void {
    const line = this.chargeLines.find((entry) => entry.id === lineId);
    if (line === undefined) throw new ReviewError(`Line ${lineId} is not on the invoice.`);
    if (line.amount === undefined || line.container === undefined) throw new ReviewError(`Line ${lineId} cannot be split.`);
    const head: UnresolvedFragment = {
      kind: "open_head",
      page: line.container.page,
      container: line.container.text,
    };
    copyLineFields(line, head, ["charge", "charged_from", "charged_to", "days", "rate"]);
    const tail: UnresolvedFragment = { kind: "orphan_tail", page: line.amount.page, amount: line.amount.text };
    this.chargeLines = this.chargeLines.filter((entry) => entry.id !== lineId);
    this.unresolved = [...this.unresolved, head, tail];
    this.decisions.push({
      document_hash: this.documentHash,
      element_key: `split|${lineId}`,
      extracted_text: line.amount.text,
      outcome: "split",
      page: line.container.page,
      decided_by: this.name,
      decided_at: this.at,
    });
  }

  dismissFragment(index: number, reason: string): void {
    const trimmed = requiredText(reason, "A dismissal needs a reason.");
    const fragment = this.unresolved[index];
    if (fragment === undefined) throw new ReviewError("That fragment is not on the invoice.");
    this.unresolved = this.unresolved.filter((_, item) => item !== index);
    this.decisions.push({
      document_hash: this.documentHash,
      element_key: fragmentKey(fragment),
      extracted_text: fragment.amount ?? fragment.container ?? null,
      outcome: "dismissed",
      page: fragment.page,
      reason: trimmed,
      decided_by: this.name,
      decided_at: this.at,
    });
  }

  finish(): ReviewResult {
    for (const key of ELEMENT_KEYS) {
      const element = this.elements[key];
      if (!isConfirmedAbsent(element) && (element.state === "suggested_absent" || element.state === "unreadable")) {
        throw new ReviewError(`Finish while ${key} is ${element.state}.`);
      }
    }
    if (this.lineApproval === null) throw new ReviewError("Finish while the charge lines are unapproved.");
    if (this.unresolved.length > 0) throw new ReviewError("Finish while a fragment is unresolved.");
    return {
      document_hash: this.documentHash,
      acknowledged_pages: [...this.acknowledged].sort((left, right) => left - right),
      elements: this.elements,
      invoice: stitchedInvoiceSchema.parse({
        ...this.source,
        charge_lines: this.chargeLines,
        unresolved: this.unresolved,
      }),
      decisions: this.decisions,
      line_approval: this.lineApproval,
    };
  }

  private pagesAcknowledged(): boolean {
    for (let page = 1; page <= this.pages; page += 1) {
      if (!this.acknowledged.has(page)) return false;
    }
    return true;
  }

  private requirePage(page: number): void {
    if (!Number.isInteger(page) || page < 1 || page > this.pages) {
      throw new ReviewError(`Page ${page} is not in this invoice.`);
    }
  }

  private elementDecision(
    key: ElementKey,
    current: ReviewedElement,
    outcome: ElementOutcome,
    extra: { page: number | null; text?: string | undefined; value?: string | undefined; reason?: string | undefined },
  ): SavedDecision {
    const decision: SavedDecision = {
      document_hash: this.documentHash,
      element_key: key,
      extracted_text: isConfirmedAbsent(current) ? null : (current.text ?? null),
      outcome,
      page: extra.page,
      decided_by: this.name,
      decided_at: this.at,
    };
    if (extra.text !== undefined) decision.text = extra.text;
    if (extra.value !== undefined) decision.value = extra.value;
    if (extra.reason !== undefined) decision.reason = extra.reason;
    return decision;
  }
}

function confirmAbsent(input: { decided_by: string; decided_at: string }): ConfirmedAbsent {
  return {
    [confirmedAbsentBrand]: true,
    state: "confirmed_absent",
    page: null,
    decided_by: input.decided_by,
    decided_at: input.decided_at,
  };
}

function presentElement(
  parsed: { text: string; value?: string },
  page: number,
  name: string,
  at: string,
): ElementValue {
  const element: ElementValue = { state: "present", text: parsed.text, page, decided_by: name, decided_at: at };
  if (parsed.value !== undefined) element.value = parsed.value;
  return element;
}

function parseReviewValue(
  key: ElementKey,
  raw: string,
  dateHint: FormatHint | undefined,
  currency: string | undefined,
): { text: string; value?: string } {
  const text = raw.trim();
  if (text === "") throw new ReviewError("The value is empty.");
  if (key === "container_number") {
    const parsed = parseContainer(text);
    if (isUnreadable(parsed)) throw new ReviewError("The value does not parse.");
    return { text, value: parsed };
  }
  if (DATE_KEYS.has(key)) {
    const parsed = parseDate(text, dateHint);
    if (isUnreadable(parsed)) throw new ReviewError("The value does not parse.");
    return { text, value: parsed };
  }
  if (key === "total_due") {
    const parsed = parseMoney(text);
    if ("status" in parsed) throw new ReviewError("The value does not parse.");
    if (parsed.currency !== null && currency !== undefined && parsed.currency !== currency) {
      throw new ReviewError("The currency does not match the invoice.");
    }
    return { text, value: parsed.amount.toFixed(2) };
  }
  return { text };
}

function extractedText(element: ElementValue): string | null {
  if (element.state === "suggested_absent" || element.state === "not_applicable") return null;
  return element.text ?? null;
}

function isElementKey(value: string): value is ElementKey {
  return (ELEMENT_KEYS as readonly string[]).includes(value);
}

function isCarriedOutcome(value: SavedDecision["outcome"]): value is (typeof CARRIED_OUTCOMES)[number] {
  return (CARRIED_OUTCOMES as readonly string[]).includes(value);
}

function restoreCarried(decision: SavedDecision): ElementValue {
  const saved = savedDecisionSchema.parse(decision);
  if (saved.outcome === "present") {
    if (saved.text === undefined || saved.page === null) throw new ReviewError("A present decision has text and a page.");
    const element: ElementValue = {
      state: "present",
      text: saved.text,
      page: saved.page,
      decided_by: saved.decided_by,
      decided_at: saved.decided_at,
    };
    if (saved.value !== undefined) element.value = saved.value;
    return element;
  }
  if (saved.outcome === "unreadable") {
    if (saved.text === undefined || saved.page === null) throw new ReviewError("An unreadable decision has text and a page.");
    return {
      state: "unreadable",
      text: saved.text,
      page: saved.page,
      decided_by: saved.decided_by,
      decided_at: saved.decided_at,
    };
  }
  throw new ReviewError("A confirmed absence is restored from a finished review.");
}

function requireAcknowledged(acknowledged: readonly number[], pages: number): void {
  const seen = new Set<number>();
  for (const page of acknowledged) {
    if (page > pages) throw new ReviewError(`Page ${page} is not in this invoice.`);
    seen.add(page);
  }
  for (let page = 1; page <= pages; page += 1) {
    if (!seen.has(page)) throw new ReviewError("A finished review acknowledges every page.");
  }
}

function isLineField(value: string): value is LineField {
  return (LINE_FIELDS as readonly string[]).includes(value);
}

function requiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new ReviewError(message);
  return trimmed;
}

function fragmentKey(fragment: UnresolvedFragment): string {
  return [
    "fragment",
    fragment.page,
    fragment.kind,
    fragment.container ?? "",
    fragment.charge ?? "",
    fragment.charged_from ?? "",
    fragment.charged_to ?? "",
    fragment.days ?? "",
    fragment.rate ?? "",
    fragment.amount ?? "",
  ].join("|");
}

function nextLineId(lines: readonly StitchedChargeLine[]): string {
  let max = 0;
  for (const line of lines) {
    const match = /^ln_(\d+)$/.exec(line.id);
    if (match?.[1] !== undefined) max = Math.max(max, Number(match[1]));
  }
  return `ln_${max + 1}`;
}

function joinedLine(head: UnresolvedFragment, tail: UnresolvedFragment, id: string): StitchedChargeLine {
  const line: StitchedChargeLine = {
    id,
    container: { text: head.container ?? "", page: head.page },
    amount: { text: tail.amount ?? "", page: tail.page },
    placement: head.page === tail.page
      ? { kind: "row", page: head.page }
      : { kind: "split", head_page: head.page, tail_page: tail.page },
  };
  copyFragmentFields(head, tail, line);
  return line;
}

function copyFragmentFields(head: UnresolvedFragment, tail: UnresolvedFragment, line: StitchedChargeLine): void {
  for (const field of ["charge", "charged_from", "charged_to", "days", "rate"] as const) {
    const headText = head[field];
    const tailText = tail[field];
    if (headText !== undefined) line[field] = { text: headText, page: head.page };
    else if (tailText !== undefined) line[field] = { text: tailText, page: tail.page };
  }
}

function copyLineFields(line: StitchedChargeLine, fragment: UnresolvedFragment, fields: readonly LineField[]): void {
  for (const field of fields) {
    const value = line[field];
    if (value !== undefined) fragment[field] = value.text;
  }
}
