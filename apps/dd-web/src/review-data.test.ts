import { ELEMENT_KEYS, savedDecisionSchema, type ElementKey } from "dd-core";
import { describe, expect, it } from "vitest";
import { recordApproval, recordDecision, type ReviewSql } from "./review-data";
import type { StoredElement } from "./review-view";

const INVOICE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CUSTOMER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const HASH = "cd".repeat(32);
const AT = "2026-11-17T20:00:00.000Z";

describe("review decisions", () => {
  it("writes one audit event and does not change an element row", async () => {
    const sql = fakeSql();
    const result = await recordDecision(sql, {
      invoiceId: INVOICE,
      actor: "Ibrahim",
      at: AT,
      command: { kind: "confirm_missing", key: "dispute_contact" },
    });
    expect(result).toEqual({ ok: true });
    const statements = sql.calls.map((call) => call.text.trim());
    expect(statements.some((text) => text.startsWith("UPDATE") || text.startsWith("DELETE"))).toBe(false);
    const inserts = sql.calls.filter((call) => call.text.includes('INSERT INTO "AuditEvent"'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.values.slice(0, 3)).toEqual([CUSTOMER, AT, "Ibrahim"]);
    const payload = savedDecisionSchema.parse(JSON.parse(String(inserts[0]?.values[3])));
    expect(payload).toMatchObject({
      document_hash: HASH,
      element_key: "dispute_contact",
      outcome: "confirmed_absent",
      page: null,
      decided_by: "Ibrahim",
      decided_at: AT,
    });
    expect(sql.elementRows.find((row) => row.elementKey === "dispute_contact")?.state).toBe("suggested_absent");
  });

  it("refuses approval on the server when a page is unseen or a flag has no decision", async () => {
    const unseen = fakeSql();
    const missingPage = await recordApproval(unseen, {
      invoiceId: INVOICE,
      actor: "Ibrahim",
      at: AT,
      acknowledgedPages: [1],
    });
    expect(missingPage).toEqual({ ok: false, message: "View every page before approving." });
    expect(unseen.calls.some((call) => call.text.includes('INSERT INTO "AuditEvent"'))).toBe(false);
    expect(unseen.calls.at(-1)?.text).toBe("ROLLBACK");

    const open = fakeSql();
    const missingDecision = await recordApproval(open, {
      invoiceId: INVOICE,
      actor: "Ibrahim",
      at: AT,
      acknowledgedPages: [1, 2],
    });
    expect(missingDecision).toEqual({ ok: false, message: "Every flagged element needs a decision." });
    expect(open.calls.some((call) => call.text.includes("INSERT"))).toBe(false);

    const ready = fakeSql({ decided: true });
    const approved = await recordApproval(ready, {
      invoiceId: INVOICE,
      actor: "Ibrahim",
      at: AT,
      acknowledgedPages: [1, 2],
    });
    expect(approved).toEqual({ ok: true });
    const insert = ready.calls.find((call) => call.text.includes('INSERT INTO "AuditEvent"'));
    const payload = savedDecisionSchema.parse(JSON.parse(String(insert?.values[3])));
    expect(payload.outcome).toBe("approved");
    expect(ready.calls.some((call) => call.text.trim().startsWith("UPDATE"))).toBe(false);
  });
});

function fakeSql(options?: { decided?: boolean }): ReviewSql & {
  calls: { text: string; values: readonly unknown[] }[];
  elementRows: StoredElement[];
} {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const elementRows = ELEMENT_KEYS.map((key) => stored(key));
  const decisions =
    options?.decided === true
      ? [
          {
            payload: {
              document_hash: HASH,
              element_key: "dispute_contact",
              extracted_text: null,
              outcome: "confirmed_absent",
              page: null,
              decided_by: "Ibrahim",
              decided_at: AT,
            },
          },
        ]
      : [];
  return {
    calls,
    elementRows,
    async query<T extends Record<string, unknown>>(text: string, values?: readonly unknown[]) {
      calls.push({ text, values: values ?? [] });
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] as T[] };
      if (text.includes("FOR UPDATE") || text.includes('FROM "Invoice"')) {
        return {
          rows: [
            {
              customer_id: CUSTOMER,
              invoice_number: "SYN-1002",
              billing_party: "Sample Line Logistics",
              billed_party: "Harbor Home Goods",
              currency: "USD",
              invoice_date: "2026-02-25",
              page_count: 2,
              display_name: "Harbor Home Goods",
              sha256: HASH,
            },
          ] as unknown as T[],
        };
      }
      if (text.includes('FROM "ElementValue"')) return { rows: elementRows.map(sqlElement) as unknown as T[] };
      if (text.includes('FROM "ChargeLine"')) return { rows: [] as T[] };
      if (text.includes('FROM "AuditEvent"')) return { rows: decisions as unknown as T[] };
      if (text.includes('INSERT INTO "AuditEvent"')) return { rows: [] as T[] };
      throw new Error(`unexpected sql: ${text}`);
    },
  };
}

function stored(key: ElementKey): StoredElement {
  if (key === "dispute_contact") {
    return { elementKey: key, state: "suggested_absent", text: null, value: null, page: null, grounded: null };
  }
  if (key === "earliest_return_date") {
    return { elementKey: key, state: "not_applicable", text: null, value: null, page: null, grounded: null };
  }
  return { elementKey: key, state: "present", text: `${key} text`, value: null, page: 1, grounded: true };
}

function sqlElement(row: StoredElement) {
  return {
    element_key: row.elementKey,
    state: row.state,
    text: row.text,
    value: row.value,
    page: row.page,
    grounded: row.grounded,
  };
}
