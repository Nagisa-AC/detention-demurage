import { ELEMENT_KEYS, ELEMENTS, savedDecisionSchema, type ElementKey } from "dd-core";
import { elementStateSummary } from "./review-format";
import { describe, expect, it } from "vitest";
import {
  approvalDecision,
  buildDecision,
  formatAmount,
  manualEntries,
  matchingIndexes,
  pillFor,
  presentReview,
  reviewQueue,
  type QueueSource,
  type StoredElement,
} from "./review-view";

const HASH = "ab".repeat(32);
const AT = "2026-11-17T20:00:00.000Z";

describe("element state summary", () => {
  it("counts by state and never treats export only as present", () => {
    const present = (count: number) => Array.from({ length: count }, () => "present");
    const missing = Array.from({ length: 4 }, () => "suggested_absent");
    expect(elementStateSummary([...present(16), ...missing])).toBe("16 present · 4 suggested missing");
    expect(elementStateSummary([...present(19), "not_applicable"])).toBe("19 present · 1 export only");
    expect(elementStateSummary([...present(15), ...missing, "not_applicable"])).toBe(
      "15 present · 4 suggested missing · 1 export only",
    );
    expect(elementStateSummary(["present", "unreadable", "confirmed_absent"])).toBe(
      "1 present · 1 unreadable · 1 confirmed missing",
    );
  });
});

describe("review pills", () => {
  it("maps every state to its pill and lists elements that need a decision first", () => {
    expect(pillFor({ state: "present", grounded: true, decided: false })).toEqual({ label: "Present", tone: "settled" });
    expect(pillFor({ state: "present", grounded: false, decided: false })).toEqual({
      label: "Not found on page, check it",
      tone: "flag",
    });
    expect(pillFor({ state: "suggested_absent", grounded: null, decided: false })).toEqual({
      label: "Suggested missing",
      tone: "flag",
    });
    expect(pillFor({ state: "unreadable", grounded: true, decided: false })).toEqual({ label: "Unreadable", tone: "flag" });
    expect(pillFor({ state: "not_applicable", grounded: null, decided: false })).toEqual({
      label: "Export only",
      tone: "export",
    });

    const replay = presentReview({
      documentHash: HASH,
      header: header(),
      rows: rows({
        container_number: { state: "present", text: "SLLU0000027", page: 1, grounded: false },
        port_of_discharge: { state: "suggested_absent" },
        billed_party_basis: { state: "unreadable", text: "consignee", page: 1, grounded: true },
      }),
      decisions: [],
    });
    expect(replay.elements.slice(0, 3).map((element) => element.key)).toEqual([
      "container_number",
      "port_of_discharge",
      "billed_party_basis",
    ]);
    expect(replay.elements.slice(0, 3).map((element) => element.pill)).toEqual([
      "Not found on page, check it",
      "Suggested missing",
      "Unreadable",
    ]);
    expect(replay.elements.slice(0, 3).every((element) => element.needsDecision)).toBe(true);
    expect(replay.elements.slice(3).some((element) => element.needsDecision)).toBe(false);
    expect(replay.elements.find((element) => element.key === "bl_number")?.pill).toBe("Present");
    expect(replay.elements.find((element) => element.key === "earliest_return_date")?.pill).toBe("Export only");
    expect(replay.elements.find((element) => element.key === "container_number")?.text).toBe("SLLU0000027");
    expect(replay.openCount).toBe(3);
  });

  it("keeps a grounded miss open until a decision is replayed, then shows Present", () => {
    const stored = rows({
      container_number: { state: "present", text: "SLLU0000027", page: 1, grounded: false },
    });
    const kept = buildDecision({
      documentHash: HASH,
      header: header(),
      rows: stored,
      prior: [],
      actor: "Ibrahim",
      at: AT,
      command: { kind: "keep", key: "container_number" },
    });
    expect(savedDecisionSchema.parse(kept).outcome).toBe("present");
    expect(kept.extracted_text).toBe("SLLU0000027");
    const replay = presentReview({
      documentHash: HASH,
      header: header(),
      rows: stored,
      decisions: [kept],
    });
    const element = replay.elements.find((item) => item.key === "container_number");
    expect(element?.pill).toBe("Present");
    expect(element?.needsDecision).toBe(false);
    expect(replay.elements[0]?.needsDecision).toBe(false);
  });

  it("confirms a suggested absence without changing how the stored state is described to the rules", () => {
    const stored = rows({ dispute_contact: { state: "suggested_absent" } });
    const decision = buildDecision({
      documentHash: HASH,
      header: header(),
      rows: stored,
      prior: [],
      actor: "Ibrahim",
      at: AT,
      command: { kind: "confirm_missing", key: "dispute_contact" },
    });
    expect(decision.outcome).toBe("confirmed_absent");
    expect(decision.page).toBeNull();
    const replay = presentReview({
      documentHash: HASH,
      header: header(),
      rows: stored,
      decisions: [decision],
    });
    const element = replay.elements.find((item) => item.key === "dispute_contact");
    expect(element?.pill).toBe("Confirmed missing");
    expect(element?.needsDecision).toBe(false);
    expect(stored.find((row) => row.elementKey === "dispute_contact")?.state).toBe("suggested_absent");
  });
});

describe("review labels", () => {
  it("uses the design wording and leaves the element keys and citations alone", () => {
    const replay = presentReview({
      documentHash: HASH,
      header: header(),
      rows: rows(),
      decisions: [],
    });
    const label = (key: ElementKey) => replay.elements.find((element) => element.key === key)?.label;
    expect(label("billed_party_basis")).toBe("Why this party is billed");
    expect(label("free_time_days")).toBe("Free time allowed");
    expect(label("charged_dates")).toBe("Charged dates");
    expect(label("total_due")).toBe("Total due");
    expect(label("dispute_info_link")).toBe("Dispute info link");
    expect(label("cert_rules_compliance")).toBe("Certification: rules compliance");
    expect(label("cert_no_contribution")).toBe("Certification: no contribution");
    expect(ELEMENTS.billed_party_basis).toEqual({
      citation: "46 CFR 541.6(a)(4)",
      applicability: "both",
      label: "Billed party basis",
    });
    expect(ELEMENTS.free_time_days.label).toBe("Free time");
    expect(ELEMENTS.charged_dates.label).toBe("Dates charged");
    expect(ELEMENTS.total_due.label).toBe("Total amount due");
    expect(ELEMENTS.dispute_info_link.label).toBe("Dispute information link");
    expect(ELEMENTS.cert_rules_compliance.label).toBe("Rules certification");
    expect(ELEMENTS.cert_no_contribution.label).toBe("No-contribution certification");
  });
});

describe("approval", () => {
  it("refuses when a page has not been viewed or a flagged element has no decision", () => {
    const stored = rows({ dispute_contact: { state: "suggested_absent" } });
    const base = {
      documentHash: HASH,
      header: header(),
      rows: stored,
      prior: [] as const,
      actor: "Ibrahim",
      at: AT,
    };
    expect(() => approvalDecision({ ...base, acknowledgedPages: [1] })).toThrow("View every page before approving.");
    expect(() => approvalDecision({ ...base, acknowledgedPages: [1, 3] })).toThrow("View every page before approving.");
    expect(() => approvalDecision({ ...base, acknowledgedPages: [1, 2] })).toThrow(
      "Every flagged element needs a decision.",
    );
    const decision = buildDecision({
      ...base,
      prior: [],
      command: { kind: "confirm_missing", key: "dispute_contact" },
    });
    const approved = approvalDecision({ ...base, prior: [decision], acknowledgedPages: [1, 2] });
    expect(approved.outcome).toBe("approved");
    expect(approved.element_key).toBe("charge_lines");
  });
});

describe("review queue", () => {
  it("lists unapproved invoices oldest first and documents that finished with no text layer", () => {
    const older = source("2026-11-01T00:00:00.000Z", "invoice-old");
    const newer = source("2026-11-02T00:00:00.000Z", "invoice-new");
    const approved = source("2026-10-01T00:00:00.000Z", "invoice-done");
    approved.decisions = [
      {
        document_hash: approved.documentHash,
        element_key: "charge_lines",
        extracted_text: null,
        outcome: "approved",
        page: null,
        decided_by: "Ibrahim",
        decided_at: AT,
      },
    ];
    const queue = reviewQueue([newer, approved, older]);
    expect(queue.map((invoice) => invoice.id)).toEqual(["invoice-old", "invoice-new"]);
    expect(queue[0]?.customer).toBe("Harbor Home Goods");
    expect(queue[0]?.invoiceNumber).toBe("SYN-1002");
    expect(queue[0]?.billingParty).toBe("Sample Line Logistics");
    expect(queue[0]?.pageCount).toBe(2);

    const manual = manualEntries([
      {
        documentId: "doc-done",
        customer: "Harbor Home Goods",
        receivedAt: "2026-11-01T00:00:00.000Z",
        invoiceId: null,
        finishedAt: "2026-11-01T01:00:00.000Z",
        pageRecords: [{ page: 1, status: "no_text_layer", ungrounded: [] }],
      },
      {
        documentId: "doc-done",
        customer: "Harbor Home Goods",
        receivedAt: "2026-11-01T00:00:00.000Z",
        invoiceId: "invoice-1",
        finishedAt: "2026-11-02T01:00:00.000Z",
        pageRecords: [{ page: 1, status: "ok", ungrounded: [] }],
      },
      {
        documentId: "doc-scan",
        customer: "Other Goods",
        receivedAt: "2026-11-03T00:00:00.000Z",
        invoiceId: null,
        finishedAt: "2026-11-03T01:00:00.000Z",
        pageRecords: [
          { page: 1, status: "ok", ungrounded: [] },
          { page: 2, status: "no_text_layer", ungrounded: [] },
        ],
      },
    ]);
    expect(manual).toEqual([
      { id: "doc-scan", customer: "Other Goods", receivedAt: "2026-11-03T00:00:00.000Z" },
    ]);

    const refused = manualEntries([
      {
        documentId: "doc-real",
        customer: "Harbor Home Goods",
        receivedAt: "2026-11-04T00:00:00.000Z",
        invoiceId: null,
        finishedAt: "2026-11-04T01:00:00.000Z",
        pageRecords: [{ page: 1, status: "failed", reason: "encrypted", ungrounded: [] }],
      },
    ]);
    expect(refused).toEqual([
      {
        id: "doc-real",
        customer: "Harbor Home Goods",
        receivedAt: "2026-11-04T00:00:00.000Z",
        label: "This PDF is encrypted or password-protected.",
      },
    ]);

    const labels = [
      ["too_large", "This PDF is over 25 MB."],
      ["too_many_pages", "This PDF has more than 30 pages."],
      ["encrypted", "This PDF is encrypted or password-protected."],
      ["malformed", "This PDF could not be read."],
    ] as const;
    for (const [reason, label] of labels) {
      const rows = manualEntries([
        {
          documentId: "doc-real",
          customer: "Harbor Home Goods",
          receivedAt: "2026-11-04T00:00:00.000Z",
          invoiceId: null,
          finishedAt: "2026-11-04T01:00:00.000Z",
          pageRecords: [{ page: 1, status: "failed", reason, ungrounded: [] }],
        },
      ]);
      expect(rows[0]?.label).toBe(label);
    }
  });
});

describe("text highlights", () => {
  it("highlights every match, including a value split across items, and nothing when it is absent", () => {
    expect(matchingIndexes(["SLLU0000027", "and", "SLLU0000027"], "SLLU0000027")).toEqual([0, 2]);
    expect(matchingIndexes(["Harbor ", "Home Goods"], "Harbor Home Goods")).toEqual([0, 1]);
    expect(matchingIndexes(["Invoice SYN-1002"], "not on the page")).toEqual([]);
    expect(matchingIndexes(["Invoice SYN-1002"], "")).toEqual([]);
  });

  it("formats a charge amount with thousands separators", () => {
    expect(formatAmount("1600.00")).toBe("1,600.00");
    expect(formatAmount("150.00")).toBe("150.00");
  });
});

function header() {
  return {
    invoiceNumber: "SYN-1002",
    billingParty: "Sample Line Logistics",
    billedParty: "Harbor Home Goods",
    currency: "USD",
    pageCount: 2,
  };
}

function rows(overrides: Partial<Record<ElementKey, Partial<StoredElement>>> = {}): StoredElement[] {
  return ELEMENT_KEYS.map((key) => {
    const base: StoredElement =
      key === "earliest_return_date"
        ? { elementKey: key, state: "not_applicable", text: null, value: null, page: null, grounded: null }
        : { elementKey: key, state: "present", text: `${key} text`, value: null, page: 1, grounded: true };
    const patch = overrides[key];
    if (patch === undefined) return base;
    const next: StoredElement = { ...base, ...patch, elementKey: key };
    if (next.state === "suggested_absent" || next.state === "not_applicable") {
      next.text = null;
      next.value = null;
      next.page = null;
      next.grounded = null;
    }
    return next;
  });
}

function source(createdAt: string, id: string): QueueSource {
  return {
    id,
    customerId: "customer-1",
    customer: "Harbor Home Goods",
    invoiceNumber: "SYN-1002",
    billingParty: "Sample Line Logistics",
    billedParty: "Harbor Home Goods",
    currency: "USD",
    pageCount: 2,
    createdAt,
    documentHash: `${id}${"0".repeat(64)}`.slice(0, 64),
    rows: rows(),
    decisions: [],
  };
}
