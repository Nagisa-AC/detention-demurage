import {
  ELEMENT_KEYS,
  ELEMENTS,
  ReviewError,
  carryDecisions,
  isConfirmedAbsent,
  savedDecisionSchema,
  startReview,
  type ElementKey,
  type ElementRecord,
  type ElementValue,
  type ReviewedElement,
  type ReviewSession,
  type SavedDecision,
  type StitchedInvoice,
} from "dd-core";

export { formatAmount, matchingIndexes, sumAmounts } from "./review-format";

export type StoredElement = {
  elementKey: string;
  state: string;
  text: string | null;
  value: string | null;
  page: number | null;
  grounded: boolean | null;
};

export type ReviewHeader = {
  invoiceNumber: string;
  billingParty: string;
  billedParty: string;
  currency: string;
  pageCount: number;
};

export type PillTone = "settled" | "flag" | "export";

export type ReviewElement = {
  key: ElementKey;
  label: string;
  pill: string;
  tone: PillTone;
  needsDecision: boolean;
  text: string | null;
  page: number | null;
  storedState: string;
  grounded: boolean | null;
};

export type DecisionCommand =
  | { kind: "confirm_missing"; key: ElementKey }
  | { kind: "mark_present"; key: ElementKey; page: number; text: string }
  | { kind: "correct"; key: ElementKey; text: string }
  | { kind: "keep"; key: ElementKey };

const TEXT_LIMIT = 2000;

/** Design wording for the review screen. Keys and citations stay on ELEMENTS. */
const REVIEW_LABELS: Partial<Record<ElementKey, string>> = {
  billed_party_basis: "Why this party is billed",
  free_time_days: "Free time allowed",
  charged_dates: "Charged dates",
  total_due: "Total due",
  dispute_info_link: "Dispute info link",
  cert_rules_compliance: "Certification: rules compliance",
  cert_no_contribution: "Certification: no contribution",
};

function reviewLabel(key: ElementKey): string {
  return REVIEW_LABELS[key] ?? ELEMENTS[key].label;
}

/**
 * Pill for one stored state.
 * A decision that dd-core carried, or a confirmed absence, is no longer open.
 * confirmed_absent is not a stored state. carryDecisions leaves it on the stored row.
 */
export function pillFor(input: {
  state: string;
  grounded: boolean | null;
  decided: boolean;
}): { label: string; tone: PillTone } {
  if (input.state === "not_applicable") return { label: "Export only", tone: "export" };
  if (input.state === "confirmed_absent") return { label: "Confirmed missing", tone: "settled" };
  if (input.state === "suggested_absent") return { label: "Suggested missing", tone: "flag" };
  if (input.state === "unreadable") return { label: "Unreadable", tone: input.decided ? "settled" : "flag" };
  if (input.state === "present" && input.grounded === false && !input.decided) {
    return { label: "Not found on page, check it", tone: "flag" };
  }
  if (input.state === "present") return { label: "Present", tone: "settled" };
  throw new ReviewError("That element state is not stored.");
}

export function isFlagged(state: string, grounded: boolean | null): boolean {
  if (state === "suggested_absent" || state === "unreadable") return true;
  return state === "present" && grounded === false;
}

export function readDecisions(payloads: readonly unknown[], documentHash: string): SavedDecision[] {
  const decisions: SavedDecision[] = [];
  for (const payload of payloads) {
    const parsed = savedDecisionSchema.safeParse(payload);
    if (!parsed.success) continue;
    if (parsed.data.document_hash !== documentHash) continue;
    decisions.push(parsed.data);
  }
  return decisions;
}

export function isApproved(decisions: readonly SavedDecision[]): boolean {
  return decisions.some((decision) => decision.outcome === "approved");
}

/** Replay stored rows through startReview. Decisions sit on top of the saved values. */
export function presentReview(input: {
  documentHash: string;
  header: ReviewHeader;
  rows: readonly StoredElement[];
  decisions: readonly SavedDecision[];
}): { elements: ReviewElement[]; openCount: number } {
  const packed = elementRecord(input.rows);
  const session = openSession({
    documentHash: input.documentHash,
    header: input.header,
    elements: packed.record,
    actor: "replay",
    at: "2026-01-01T00:00:00.000Z",
    prior: input.decisions,
  });
  const view = session.view();
  const elements = ELEMENT_KEYS.map((key) => {
    const stored = packed.byKey.get(key);
    if (stored === undefined) throw new ReviewError(`Missing ${key}.`);
    const replayed = view.elements[key];
    const latest = latestDecision(input.decisions, input.documentHash, key);
    const decided = decisionApplied(replayed, latest);
    const confirmed = latest?.outcome === "confirmed_absent";
    const state = confirmed ? "confirmed_absent" : isConfirmedAbsent(replayed) ? "confirmed_absent" : replayed.state;
    const pill = pillFor({ state, grounded: stored.grounded, decided });
    const text = confirmed || isConfirmedAbsent(replayed) ? null : (replayed.text ?? null);
    const page = confirmed || isConfirmedAbsent(replayed) ? null : replayed.page;
    return {
      key,
      label: reviewLabel(key),
      pill: pill.label,
      tone: pill.tone,
      needsDecision: !decided && isFlagged(stored.state, stored.grounded),
      text,
      page,
      storedState: stored.state,
      grounded: stored.grounded,
    };
  });
  elements.sort((left, right) => {
    if (left.needsDecision !== right.needsDecision) return left.needsDecision ? -1 : 1;
    return ELEMENT_KEYS.indexOf(left.key) - ELEMENT_KEYS.indexOf(right.key);
  });
  return { elements, openCount: elements.filter((element) => element.needsDecision).length };
}

export function pagesCovered(pages: readonly number[], pageCount: number): boolean {
  if (!Number.isInteger(pageCount) || pageCount < 1) return false;
  const seen = new Set<number>();
  for (const page of pages) {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) return false;
    seen.add(page);
  }
  return seen.size === pageCount;
}

export function buildDecision(input: {
  documentHash: string;
  header: ReviewHeader;
  rows: readonly StoredElement[];
  prior: readonly SavedDecision[];
  actor: string;
  at: string;
  command: DecisionCommand;
}): SavedDecision {
  if (isApproved(input.prior)) throw new ReviewError("This invoice is already approved.");
  const packed = elementRecord(input.rows);
  const row = packed.byKey.get(input.command.key);
  if (row === undefined) throw new ReviewError(`Missing ${input.command.key}.`);
  const replay = presentReview({
    documentHash: input.documentHash,
    header: input.header,
    rows: input.rows,
    decisions: input.prior,
  });
  const current = replay.elements.find((element) => element.key === input.command.key);
  if (current?.needsDecision !== true) {
    throw new ReviewError(
      current !== undefined && !isFlagged(row.state, row.grounded)
        ? "That element does not need a decision."
        : "That element already has a decision.",
    );
  }
  const invoice = stitchedHeader(input.header);
  if (input.command.kind === "confirm_missing" || input.command.kind === "mark_present") {
    if (row.state !== "suggested_absent") throw new ReviewError(`${input.command.key} is not suggested absent.`);
  } else if (!isFlagged(row.state, row.grounded) || row.state === "suggested_absent") {
    throw new ReviewError(`${input.command.key} is ${row.state}.`);
  }

  if (input.command.kind === "confirm_missing") {
    const session = openSession({ ...input, elements: packed.record });
    for (let page = 1; page <= input.header.pageCount; page += 1) session.acknowledge(page);
    session.confirmAbsent(input.command.key);
    const decision = taken(session);
    if (decision.outcome !== "confirmed_absent" || decision.page !== null) {
      throw new ReviewError("That decision was not applied.");
    }
    return decision;
  }

  if (input.command.kind === "mark_present") {
    const text = cleanText(input.command.text);
    if (!Number.isInteger(input.command.page)) throw new ReviewError("That page is not in this invoice.");
    const session = openSession({ ...input, elements: packed.record });
    session.found(input.command.key, input.command.page, text);
    const decision = taken(session);
    assertCarried(input, packed.record, invoice, decision, "present");
    return decision;
  }

  const stored = packed.record[input.command.key];
  if (input.command.kind === "keep" && stored.state === "present") {
    return keepPresent(input, stored, packed.record, invoice);
  }
  if (input.command.kind === "keep") {
    return keepUnreadable(input, stored, packed.record, invoice);
  }
  return correctElement(input, input.command.text, stored, packed.record, invoice);
}

export function approvalDecision(input: {
  documentHash: string;
  header: ReviewHeader;
  rows: readonly StoredElement[];
  prior: readonly SavedDecision[];
  acknowledgedPages: readonly number[];
  actor: string;
  at: string;
}): SavedDecision {
  if (isApproved(input.prior)) throw new ReviewError("This invoice is already approved.");
  if (!pagesCovered(input.acknowledgedPages, input.header.pageCount)) {
    throw new ReviewError("View every page before approving.");
  }
  const replay = presentReview({
    documentHash: input.documentHash,
    header: input.header,
    rows: input.rows,
    decisions: input.prior,
  });
  if (replay.elements.some((element) => element.needsDecision)) {
    throw new ReviewError("Every flagged element needs a decision.");
  }
  const packed = elementRecord(input.rows);
  const session = openSession({ ...input, elements: packed.record, prior: input.prior });
  session.approveLines();
  const decision = taken(session);
  if (decision.outcome !== "approved") throw new ReviewError("The invoice was not approved.");
  return decision;
}

export type QueueInvoice = {
  id: string;
  customerId: string;
  customer: string;
  invoiceNumber: string;
  billingParty: string;
  pageCount: number;
  createdAt: string;
  documentHash: string;
  openCount: number;
};

export type QueueSource = {
  id: string;
  customerId: string;
  customer: string;
  invoiceNumber: string;
  billingParty: string;
  billedParty: string;
  currency: string;
  pageCount: number;
  createdAt: string;
  documentHash: string;
  rows: readonly StoredElement[];
  decisions: readonly unknown[];
};

/** Invoices with no approval, oldest first, with the open-element count. */
export function reviewQueue(invoices: readonly QueueSource[]): QueueInvoice[] {
  const open: QueueInvoice[] = [];
  for (const invoice of invoices) {
    const decisions = readDecisions(invoice.decisions, invoice.documentHash);
    if (isApproved(decisions)) continue;
    let openCount: number = ELEMENT_KEYS.length;
    try {
      openCount = presentReview({
        documentHash: invoice.documentHash,
        header: {
          invoiceNumber: invoice.invoiceNumber,
          billingParty: invoice.billingParty,
          billedParty: invoice.billedParty,
          currency: invoice.currency,
          pageCount: invoice.pageCount,
        },
        rows: invoice.rows,
        decisions,
      }).openCount;
    } catch (error) {
      if (!(error instanceof ReviewError)) throw error;
    }
    open.push({
      id: invoice.id,
      customerId: invoice.customerId,
      customer: invoice.customer,
      invoiceNumber: invoice.invoiceNumber,
      billingParty: invoice.billingParty,
      pageCount: invoice.pageCount,
      createdAt: invoice.createdAt,
      documentHash: invoice.documentHash,
      openCount,
    });
  }
  open.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  return open;
}

export type ManualDocument = {
  id: string;
  customer: string;
  receivedAt: string;
};

export type FinishedRun = {
  documentId: string;
  customer: string;
  receivedAt: string;
  invoiceId: string | null;
  finishedAt: string;
  pageRecords: unknown;
};

/** Latest finished run per document, when that run saved no invoice and a page has no text layer. */
export function manualEntries(runs: readonly FinishedRun[]): ManualDocument[] {
  const latest = new Map<string, FinishedRun>();
  for (const run of runs) {
    const current = latest.get(run.documentId);
    if (current === undefined || run.finishedAt > current.finishedAt) latest.set(run.documentId, run);
  }
  const documents: ManualDocument[] = [];
  for (const run of latest.values()) {
    if (run.invoiceId !== null) continue;
    if (!hasNoTextLayer(run.pageRecords)) continue;
    documents.push({ id: run.documentId, customer: run.customer, receivedAt: run.receivedAt });
  }
  documents.sort((left, right) => left.receivedAt.localeCompare(right.receivedAt) || left.id.localeCompare(right.id));
  return documents;
}

function hasNoTextLayer(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    if (item === null || typeof item !== "object") return false;
    return (item as { status?: unknown }).status === "no_text_layer";
  });
}

function latestDecision(
  decisions: readonly SavedDecision[],
  documentHash: string,
  key: ElementKey,
): SavedDecision | undefined {
  let found: SavedDecision | undefined;
  for (const decision of decisions) {
    if (decision.document_hash !== documentHash || decision.element_key !== key) continue;
    if (decision.outcome === "confirmed_absent" || decision.outcome === "present" || decision.outcome === "unreadable") {
      found = decision;
    }
  }
  return found;
}

function decisionApplied(replayed: ReviewedElement, latest: SavedDecision | undefined): boolean {
  if (latest === undefined) return false;
  if (latest.outcome === "confirmed_absent") return true;
  if (isConfirmedAbsent(replayed)) return false;
  if (replayed.decided_by === undefined) return false;
  if (latest.outcome === "present") return replayed.state === "present" && replayed.text === latest.text;
  if (latest.outcome === "unreadable") return replayed.state === "unreadable" && replayed.text === latest.text;
  return false;
}

function elementRecord(rows: readonly StoredElement[]): { record: ElementRecord; byKey: Map<ElementKey, StoredElement> } {
  const byKey = new Map<ElementKey, StoredElement>();
  for (const row of rows) {
    if (!isElementKey(row.elementKey)) throw new ReviewError("That element is not stored.");
    if (byKey.has(row.elementKey)) throw new ReviewError("That element is duplicated.");
    byKey.set(row.elementKey, row);
  }
  const record = {} as ElementRecord;
  for (const key of ELEMENT_KEYS) {
    const row = byKey.get(key);
    if (row === undefined) throw new ReviewError(`Missing ${key}.`);
    record[key] = toElement(row);
  }
  return { record, byKey };
}

function toElement(row: StoredElement): ElementValue {
  if (row.state === "present" || row.state === "unreadable") {
    if (row.page === null || row.text === null || row.text === "") throw new ReviewError("A seen element has a page and text.");
    const element: ElementValue = { state: row.state, text: row.text, page: row.page };
    if (row.value !== null && row.value !== "") element.value = row.value;
    return element;
  }
  if (row.state === "suggested_absent" || row.state === "not_applicable") {
    return { state: row.state, page: null };
  }
  throw new ReviewError("That element state is not stored.");
}

function openSession(input: {
  documentHash: string;
  header: ReviewHeader;
  elements: ElementRecord;
  actor: string;
  at: string;
  prior?: readonly SavedDecision[];
}): ReviewSession {
  return startReview({
    documentHash: input.documentHash,
    invoice: stitchedHeader(input.header),
    elements: input.elements,
    pages: input.header.pageCount,
    name: input.actor,
    at: input.at,
    ...(input.prior === undefined ? {} : { priorDecisions: input.prior }),
  });
}

function stitchedHeader(header: ReviewHeader): StitchedInvoice {
  if (!/^[A-Z]{3}$/.test(header.currency)) throw new ReviewError("The invoice has no currency.");
  if (!Number.isInteger(header.pageCount) || header.pageCount < 1) throw new ReviewError("A review needs at least one page.");
  return {
    invoice_number: { text: requiredHeader(header.invoiceNumber), page: 1 },
    billing_party: { text: requiredHeader(header.billingParty), page: 1 },
    billed_party: { text: requiredHeader(header.billedParty), page: 1 },
    currency: { text: header.currency, page: 1 },
    elements: {},
    conflicts: [],
    header_conflicts: [],
    charge_lines: [],
    unresolved: [],
  };
}

function requiredHeader(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new ReviewError("The invoice is missing a header.");
  return trimmed;
}

function taken(session: ReviewSession): SavedDecision {
  const decisions = session.view().decisions;
  const last = decisions[decisions.length - 1];
  if (last === undefined) throw new ReviewError("The decision was not recorded.");
  return savedDecisionSchema.parse(last);
}

function keepPresent(
  input: {
    documentHash: string;
    header: ReviewHeader;
    actor: string;
    at: string;
    command: DecisionCommand;
  },
  stored: ElementValue,
  elements: ElementRecord,
  invoice: StitchedInvoice,
): SavedDecision {
  if (stored.state !== "present" || stored.text === undefined || stored.page === null) {
    throw new ReviewError("That element is not present.");
  }
  const decision = savedDecisionSchema.parse({
    document_hash: input.documentHash,
    element_key: input.command.key,
    extracted_text: stored.text,
    outcome: "present",
    text: stored.text,
    page: stored.page,
    decided_by: input.actor,
    decided_at: input.at,
    ...(stored.value === undefined ? {} : { value: stored.value }),
  });
  assertCarried(
    { documentHash: input.documentHash, header: input.header },
    elements,
    invoice,
    decision,
    "present",
  );
  return decision;
}

function keepUnreadable(
  input: {
    documentHash: string;
    header: ReviewHeader;
    actor: string;
    at: string;
    command: DecisionCommand;
  },
  stored: ElementValue,
  elements: ElementRecord,
  invoice: StitchedInvoice,
): SavedDecision {
  if (stored.state !== "unreadable" || stored.text === undefined || stored.page === null) {
    throw new ReviewError("That element is not unreadable.");
  }
  const copy: ElementRecord = {
    ...elements,
    [input.command.key]: {
      state: "present",
      text: stored.text,
      page: stored.page,
      ...(stored.value === undefined ? {} : { value: stored.value }),
    },
  };
  const session = openSession({
    documentHash: input.documentHash,
    header: input.header,
    elements: copy,
    actor: input.actor,
    at: input.at,
  });
  session.markUnreadable(input.command.key, "The text is right.");
  const decision = taken(session);
  assertCarried(
    { documentHash: input.documentHash, header: input.header },
    elements,
    invoice,
    decision,
    "unreadable",
  );
  return decision;
}

function correctElement(
  input: {
    documentHash: string;
    header: ReviewHeader;
    actor: string;
    at: string;
    command: DecisionCommand;
  },
  raw: string,
  stored: ElementValue,
  elements: ElementRecord,
  invoice: StitchedInvoice,
): SavedDecision {
  const text = cleanText(raw);
  if (stored.state === "unreadable") {
    const session = openSession({
      documentHash: input.documentHash,
      header: input.header,
      elements,
      actor: input.actor,
      at: input.at,
    });
    session.correct(input.command.key, text);
    const decision = taken(session);
    assertCarried(
      { documentHash: input.documentHash, header: input.header },
      elements,
      invoice,
      decision,
      "present",
    );
    return decision;
  }
  if (stored.state !== "present" || stored.text === undefined || stored.page === null) {
    throw new ReviewError("That element is not present.");
  }
  const copy: ElementRecord = {
    ...elements,
    [input.command.key]: { state: "unreadable", text: stored.text, page: stored.page },
  };
  const session = openSession({
    documentHash: input.documentHash,
    header: input.header,
    elements: copy,
    actor: input.actor,
    at: input.at,
  });
  session.correct(input.command.key, text);
  const decision = taken(session);
  assertCarried(
    { documentHash: input.documentHash, header: input.header },
    elements,
    invoice,
    decision,
    "present",
  );
  return decision;
}

function assertCarried(
  input: { documentHash: string; header: ReviewHeader },
  elements: ElementRecord,
  invoice: StitchedInvoice,
  decision: SavedDecision,
  state: "present" | "unreadable",
): void {
  const carried = carryDecisions(input.documentHash, [decision], elements, invoice);
  const next = carried.elements[decision.element_key as ElementKey];
  if (next === undefined || isConfirmedAbsent(next) || next.state !== state || next.decided_by === undefined) {
    throw new ReviewError("That decision was not applied.");
  }
}

function cleanText(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new ReviewError("The value is empty.");
  if (trimmed.length > TEXT_LIMIT) throw new ReviewError("The value is too long.");
  return trimmed;
}

function isElementKey(value: string): value is ElementKey {
  return (ELEMENT_KEYS as readonly string[]).includes(value);
}
