import { unresolvedFragmentSchema, type RunInvoice, type RunLine, type SavedDecision } from "dd-core";
import { replayedElements, type ReviewHeader, type StoredElement } from "./review-view";

export class RulesInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RulesInputError";
  }
}

export type StoredChargeLine = {
  lineId: string;
  container: string;
  charge: string;
  chargedFrom: string;
  chargedTo: string;
  days: number | string;
  rate: string;
  amount: string;
  containerPage: number | null;
  fromPage: number | null;
  toPage: number | null;
  daysPage: number | null;
  ratePage: number | null;
  amountPage: number | null;
};

export type StoredRulesInvoice = {
  invoiceNumber: string;
  billingParty: string;
  billedParty: string;
  currency: string;
  pageCount: number;
  documentHash: string;
  elements: readonly StoredElement[];
  lines: readonly StoredChargeLine[];
  unresolved: unknown;
  decisions: readonly SavedDecision[];
};

const LINE_EDITS = new Set(["edited", "joined", "split", "dismissed"]);
const PAGES_MISSING = "Charge line pages were not saved. Requeue the invoice.";
const FRAGMENTS_MISSING = "Unresolved fragments were not saved. Requeue the invoice.";

/** Saved rows plus the review screen's replay. Missing pages and fragments are refused. */
export function buildRunInvoice(input: StoredRulesInvoice): RunInvoice {
  if (input.decisions.some((decision) => LINE_EDITS.has(decision.outcome))) {
    throw new RulesInputError("A line edit is not on the saved invoice.");
  }
  const header: ReviewHeader = {
    invoiceNumber: input.invoiceNumber,
    billingParty: input.billingParty,
    billedParty: input.billedParty,
    currency: input.currency,
    pageCount: input.pageCount,
  };
  return {
    invoice_number: input.invoiceNumber,
    currency: input.currency,
    elements: replayedElements({
      documentHash: input.documentHash,
      header,
      rows: input.elements,
      decisions: input.decisions,
    }),
    lines: input.lines.map(toRunLine),
    unresolved: fragmentsOf(input.unresolved),
  };
}

function fragmentsOf(value: unknown): { page: number }[] {
  if (value === null || value === undefined) throw new RulesInputError(FRAGMENTS_MISSING);
  const parsed = unresolvedFragmentSchema.array().safeParse(value);
  if (!parsed.success) throw new RulesInputError(FRAGMENTS_MISSING);
  return parsed.data.map((fragment) => ({ page: fragment.page }));
}

function toRunLine(line: StoredChargeLine): RunLine {
  return {
    id: line.lineId,
    container: line.container,
    charge: line.charge,
    charged_from: line.chargedFrom,
    charged_to: line.chargedTo,
    days: typeof line.days === "number" ? String(line.days) : line.days,
    rate: line.rate,
    amount: line.amount,
    container_page: pageOf(line.containerPage),
    from_page: pageOf(line.fromPage),
    to_page: pageOf(line.toPage),
    days_page: pageOf(line.daysPage),
    rate_page: pageOf(line.ratePage),
    amount_page: pageOf(line.amountPage),
  };
}

function pageOf(page: number | null): number {
  if (page === null || !Number.isInteger(page) || page < 1) throw new RulesInputError(PAGES_MISSING);
  return page;
}
