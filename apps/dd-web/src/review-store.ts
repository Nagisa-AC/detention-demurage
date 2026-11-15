import {
  ELEMENT_KEYS,
  ReviewError,
  loadReview,
  savedDecisionSchema,
  type ElementKey,
  type ElementValue,
  type ReviewResult,
} from "dd-core";

const STORED_STATES = ["present", "unreadable", "suggested_absent", "not_applicable"] as const;
type StoredState = (typeof STORED_STATES)[number];

export type StoredElementRow = {
  elementKey: string;
  state: string;
  text: string | null;
  value: string | null;
  page: number | null;
};

export type StoredInvoiceHeader = {
  invoiceNumber: string;
  billingParty: string;
  billedParty: string;
  currency: string;
  pageCount: number;
};

/**
 * Rebuild a finished review from stored rows and call loadReview.
 * confirmed_absent is applied in memory from decision rows. It is not a stored state.
 */
export function replayReview(input: {
  documentHash: string;
  acknowledgedPages: number[];
  invoice: StoredInvoiceHeader;
  elements: readonly StoredElementRow[];
  decisions: readonly unknown[];
  lineApproval: { decided_by: string; decided_at: string };
}): ReviewResult {
  const decisions = input.decisions.map((decision) => {
    const parsed = savedDecisionSchema.safeParse(decision);
    if (!parsed.success) throw new ReviewError("That decision is not a saved decision.");
    return parsed.data;
  });

  const byKey = new Map(input.elements.map((row) => [row.elementKey, row]));
  const elements = {} as Record<ElementKey, ElementValue | PlainAbsence>;
  for (const key of ELEMENT_KEYS) {
    const row = byKey.get(key);
    if (row === undefined) throw new ReviewError(`Missing ${key}.`);
    elements[key] = storedElement(row);
  }

  for (const decision of decisions) {
    if (decision.outcome !== "confirmed_absent") continue;
    if (!isElementKey(decision.element_key)) throw new ReviewError("That decision is not an element.");
    elements[decision.element_key] = {
      state: "confirmed_absent",
      page: null,
      decided_by: decision.decided_by,
      decided_at: decision.decided_at,
    };
  }

  return loadReview(
    {
      document_hash: input.documentHash,
      acknowledged_pages: input.acknowledgedPages,
      elements,
      invoice: {
        invoice_number: { text: input.invoice.invoiceNumber, page: 1 },
        billing_party: { text: input.invoice.billingParty, page: 1 },
        billed_party: { text: input.invoice.billedParty, page: 1 },
        currency: { text: input.invoice.currency, page: 1 },
        elements: {},
        conflicts: [],
        header_conflicts: [],
        charge_lines: [],
        unresolved: [],
      },
      decisions,
      line_approval: input.lineApproval,
    },
    input.invoice.pageCount,
  );
}

type PlainAbsence = {
  state: "confirmed_absent";
  page: null;
  decided_by: string;
  decided_at: string;
};

function storedElement(row: StoredElementRow): ElementValue {
  if (row.state === "confirmed_absent") {
    throw new ReviewError("confirmed_absent is not a stored state.");
  }
  if (!isStoredState(row.state)) throw new ReviewError("That element state is not stored.");
  if (row.state === "present" || row.state === "unreadable") {
    if (row.page === null || row.text === null) throw new ReviewError("A seen element has a page and text.");
    if (row.value === null) return { state: row.state, text: row.text, page: row.page };
    return { state: row.state, text: row.text, value: row.value, page: row.page };
  }
  return { state: row.state, page: null };
}

function isStoredState(state: string): state is StoredState {
  return (STORED_STATES as readonly string[]).includes(state);
}

function isElementKey(key: string): key is ElementKey {
  return (ELEMENT_KEYS as readonly string[]).includes(key);
}
