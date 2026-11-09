import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ELEMENT_KEYS } from "./elements.js";
import { assignPresence, forRules } from "./presence.js";
import {
  carryDecisions,
  isConfirmedAbsent,
  restoreElement,
  ReviewError,
  startReview,
  type SavedDecision,
} from "./review.js";
import {
  fixtureTruthSchema,
  pageExtractionSchema,
  stitchedInvoiceSchema,
  type ElementRecord,
  type FixtureTruth,
  type PageExtraction,
  type PrintedChargeLine,
  type StitchedInvoice,
} from "./schema.js";
import { stitch } from "./stitch.js";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/synthetic");
const removed = ["free_time_start", "free_time_end", "cert_rules_compliance", "cert_no_contribution"] as const;
const when = "2026-11-09T20:20:00Z";
const name = "Reviewer";

describe("review", () => {
  it("confirms the four missing elements after every page is acknowledged", () => {
    const session = sessionFor("missing_elements");
    expect(() => session.finish()).toThrow("suggested_absent");
    expect(() => session.confirmAbsent("free_time_start")).toThrow(ReviewError);
    expect(() => session.confirmAbsent("free_time_start")).toThrow("acknowledged");
    session.acknowledge(1);
    for (const key of removed) session.confirmAbsent(key);
    session.approveLines();
    const result = session.finish();

    for (const key of removed) {
      expect(isConfirmedAbsent(result.elements[key]), key).toBe(true);
      expect(result.elements[key]).toMatchObject({ decided_by: name, decided_at: when, page: null });
    }
    expect(result.acknowledged_pages).toEqual([1]);
    expect(result.line_approval).toEqual({ decided_by: name, decided_at: when });

    const saved = JSON.parse(JSON.stringify(result.elements.free_time_start)) as unknown;
    expect(isConfirmedAbsent(saved)).toBe(false);
    const decision = result.decisions.find((entry) => entry.element_key === "free_time_start");
    expect(decision?.document_hash).toBe("hash-missing");
    expect(isConfirmedAbsent(restoreElement(decision as SavedDecision))).toBe(true);
  });

  it("requires an acknowledgement for every page, not one open of the file", () => {
    const { invoice, elements } = blankInvoice();
    const session = startReview({
      documentHash: "hash-pages",
      invoice,
      elements,
      pages: 3,
      name,
      at: when,
    });
    session.acknowledge(1);
    session.acknowledge(2);
    expect(() => session.confirmAbsent("free_time_start")).toThrow("acknowledged");
    session.acknowledge(3);
    session.confirmAbsent("free_time_start");
    expect(isConfirmedAbsent(session.view().elements.free_time_start)).toBe(true);
  });

  it("carries a decision only for the same document hash and the same extracted text", () => {
    const first = sessionFor("missing_elements");
    first.acknowledge(1);
    first.confirmAbsent("free_time_start");
    const decision = first.view().decisions.find((entry) => entry.element_key === "free_time_start");
    if (decision === undefined) throw new Error("missing decision");

    const { invoice, elements } = prepared("missing_elements");
    const same = carryDecisions("hash-missing", [decision], elements, invoice);
    expect(isConfirmedAbsent(same.elements.free_time_start)).toBe(true);

    const changed: ElementRecord = {
      ...elements,
      free_time_start: { state: "present", text: "2026-06-08", value: "2026-06-08", page: 1 },
    };
    const drifted = carryDecisions("hash-missing", [decision], changed, invoice);
    expect(drifted.elements.free_time_start).toMatchObject({ state: "present", text: "2026-06-08" });

    const reissue = carryDecisions("hash-reissue", [decision], elements, invoice);
    expect(reissue.elements.free_time_start).toEqual({ state: "suggested_absent", page: null });
    expect(reissue.applied).toEqual([]);
  });

  it("dismisses an unresolved fragment with a reason", () => {
    const { invoice, elements } = blankInvoice();
    const withFragment = stitchedInvoiceSchema.parse({
      ...invoice,
      unresolved: [{ kind: "orphan_tail", page: 2, amount: "300.00" }],
    });
    const session = startReview({
      documentHash: "hash-fragment",
      invoice: withFragment,
      elements,
      pages: 1,
      name,
      at: when,
    });
    expect(() => session.dismissFragment(0, "  ")).toThrow("A dismissal needs a reason.");
    session.dismissFragment(0, "a subtotal misread as a row");
    session.acknowledge(1);
    for (const key of ELEMENT_KEYS) {
      const element = session.view().elements[key];
      if (!isConfirmedAbsent(element) && element.state === "suggested_absent") session.confirmAbsent(key);
    }
    session.approveLines();
    const result = session.finish();
    expect(result.invoice.unresolved).toEqual([]);
    expect(result.decisions).toContainEqual(expect.objectContaining({
      document_hash: "hash-fragment",
      outcome: "dismissed",
      reason: "a subtotal misread as a row",
      page: 2,
    }));

    const again = stitchedInvoiceSchema.parse({
      ...invoice,
      unresolved: [{ kind: "orphan_tail", page: 2, amount: "300.00" }],
    });
    const carried = carryDecisions("hash-fragment", result.decisions, elements, again);
    expect(carried.invoice.unresolved).toEqual([]);
    const otherFile = carryDecisions("hash-reissue", result.decisions, elements, again);
    expect(otherFile.invoice.unresolved).toHaveLength(1);
  });

  it("keeps the printed text when a present element is marked unreadable", () => {
    const { invoice, elements } = blankInvoice();
    const present = {
      ...elements,
      bl_number: { state: "present" as const, text: "SYN-BL-1002", page: 1 },
    };
    const session = startReview({
      documentHash: "hash-wrong",
      invoice,
      elements: present,
      pages: 1,
      name,
      at: when,
    });
    session.acknowledge(1);
    session.markUnreadable("bl_number", "The model read the bill of lading wrong.");
    const element = session.view().elements.bl_number;
    expect(element).toMatchObject({ state: "unreadable", text: "SYN-BL-1002", page: 1 });
    if (!isConfirmedAbsent(element)) {
      expect(forRules(element)).toEqual({ state: "unreadable", page: 1 });
    }
  });

  it("joins two fragments and splits a line back into fragments", () => {
    const { invoice, elements } = blankInvoice();
    const withFragments = stitchedInvoiceSchema.parse({
      ...invoice,
      unresolved: [
        { kind: "open_head", page: 2, container: "MSCU1234565" },
        { kind: "orphan_tail", page: 3, amount: "300.00" },
      ],
    });
    const session = startReview({
      documentHash: "hash-join",
      invoice: withFragments,
      elements,
      pages: 1,
      name,
      at: when,
    });
    session.acknowledge(1);
    for (const key of ELEMENT_KEYS) {
      const element = session.view().elements[key];
      if (!isConfirmedAbsent(element) && element.state === "suggested_absent") session.confirmAbsent(key);
    }
    session.approveLines();
    session.join(0, 1);
    session.editLine("ln_1", "amount", "301.00");
    expect(session.view().charge_lines[0]?.amount).toEqual({ text: "301.00", page: 3 });
    expect(session.view().decisions).toContainEqual(expect.objectContaining({
      outcome: "edited",
      before: "300.00",
      after: "301.00",
      document_hash: "hash-join",
    }));
    expect(session.view().unresolved).toEqual([]);
    expect(session.view().charge_lines).toEqual([
      expect.objectContaining({ id: "ln_1", placement: { kind: "split", head_page: 2, tail_page: 3 } }),
    ]);
    session.split("ln_1");
    expect(session.view().charge_lines).toEqual([]);
    expect(session.view().unresolved).toHaveLength(2);
    expect(() => session.finish()).toThrow("unresolved");
  });

  it("refuses a correction that does not parse", () => {
    const { invoice, elements } = blankInvoice();
    const unread = {
      ...elements,
      invoice_date: { state: "unreadable" as const, text: "03/02/2026", page: 1 },
    };
    const session = startReview({
      documentHash: "hash-date",
      invoice,
      elements: unread,
      pages: 1,
      name,
      at: when,
    });
    expect(() => session.correct("invoice_date", "03/02/2026")).toThrow("does not parse");
    const hinted = startReview({
      documentHash: "hash-date",
      invoice,
      elements: unread,
      pages: 1,
      name,
      at: when,
      dateHint: "DMY",
    });
    hinted.correct("invoice_date", "03/02/2026");
    expect(hinted.view().elements.invoice_date).toMatchObject({ state: "present", value: "2026-02-03" });
  });
});

function sessionFor(id: string) {
  const { invoice, elements } = prepared(id);
  return startReview({
    documentHash: `hash-${id === "missing_elements" ? "missing" : id}`,
    invoice,
    elements,
    pages: 1,
    name,
    at: when,
  });
}

function prepared(id: string): { invoice: StitchedInvoice; elements: ElementRecord } {
  const truth = fixtureTruthSchema.parse(JSON.parse(fs.readFileSync(path.join(fixtureDir, `${id}.json`), "utf8"))) as FixtureTruth;
  const invoice = stitch(pagesFromPrinted(truth));
  return { invoice, elements: assignPresence(invoice, "import") };
}

function blankInvoice(): { invoice: StitchedInvoice; elements: ElementRecord } {
  const invoice = stitchedInvoiceSchema.parse({
    elements: {},
    conflicts: [],
    header_conflicts: [],
    charge_lines: [],
    unresolved: [],
  });
  return { invoice, elements: assignPresence(invoice, "import") };
}

function pagesFromPrinted(truth: FixtureTruth): PageExtraction[] {
  const elements: PageExtraction["elements"] = {};
  for (const key of ELEMENT_KEYS) {
    const element = truth.elements[key];
    if (element.state !== "present" || element.page === null || element.text === undefined || element.text === "") continue;
    elements[key] = { text: element.text, page: element.page };
  }
  const charge_lines: PrintedChargeLine[] = truth.charge_lines
    .filter((line) => line.placement.kind === "row")
    .map((line) => ({
      page: line.placement.kind === "row" ? line.placement.page : 1,
      container: line.container,
      charge: line.charge,
      charged_from: line.charged_from,
      charged_to: line.charged_to,
      days: line.days,
      rate: line.rate,
      amount: line.amount,
    }));
  return [
    pageExtractionSchema.parse({
      page: 1,
      invoice_number: truth.invoice_number,
      billing_party: truth.billing_party,
      billed_party: truth.billed_party,
      currency: truth.currency,
      elements,
      charge_lines,
    }),
  ];
}
