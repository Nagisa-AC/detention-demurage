import { customerConfigSchema, ELEMENT_KEYS, savedDecisionSchema, type CustomerConfig, type ElementKey } from "dd-core";
import { describe, expect, it } from "vitest";
import { parseBillingParty } from "./billing-party";
import { readBillingChoice, recordApproval, recordBillingParty, recordDecision, type ReviewSql } from "./review-data";
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

    const ready = fakeSql({ decided: true, settings: { version: 4, config: sampleConfig() }, parties: [party("sample_line", 1)] });
    const approved = await recordApproval(ready, {
      invoiceId: INVOICE,
      actor: "Ibrahim",
      at: AT,
      acknowledgedPages: [1, 2],
    });
    expect(approved).toEqual({ ok: true });
    const insert = ready.calls.find((call) => call.text.includes("INSERT") && call.text.includes("review_decision"));
    const payload = savedDecisionSchema.parse(JSON.parse(String(insert?.values[3])));
    expect(payload).toMatchObject({ outcome: "approved", party_id: "sample_line", settings_version: 4 });
    expect(ready.calls.some((call) => call.text.trim().startsWith("UPDATE"))).toBe(false);
  });

  it("refuses approval when there are no settings, no party, or the party left the current settings", async () => {
    const noSettings = fakeSql({ decided: true, settings: null, parties: [party("sample_line", 1)] });
    expect(
      await recordApproval(noSettings, { invoiceId: INVOICE, actor: "Ibrahim", at: AT, acknowledgedPages: [1, 2] }),
    ).toEqual({ ok: false, message: "This customer has no settings." });
    expect(noSettings.calls.some((call) => call.text.includes("INSERT"))).toBe(false);

    const noParty = fakeSql({ decided: true, settings: { version: 1, config: sampleConfig() } });
    expect(
      await recordApproval(noParty, { invoiceId: INVOICE, actor: "Ibrahim", at: AT, acknowledgedPages: [1, 2] }),
    ).toEqual({ ok: false, message: "Choose a billing party before approving." });
    expect(noParty.calls.some((call) => call.text.includes("INSERT"))).toBe(false);

    const dropped = fakeSql({
      decided: true,
      settings: { version: 2, config: sampleConfig() },
      parties: [party("retired_line", 1)],
    });
    expect(
      await recordApproval(dropped, { invoiceId: INVOICE, actor: "Ibrahim", at: AT, acknowledgedPages: [1, 2] }),
    ).toEqual({ ok: false, message: "That billing party is not in the current settings." });
    expect(dropped.calls.some((call) => call.text.includes("INSERT"))).toBe(false);
  });

  it("keeps the first billing-party event and approves with the second choice", async () => {
    const settings = { version: 1, config: sampleConfig() };
    const sql = fakeSql({ decided: true, settings, parties: [] });
    const first = await recordBillingParty(sql, {
      invoiceId: INVOICE,
      partyId: "sample_line",
      actor: "Ibrahim",
      at: "2026-11-17T20:01:00.000Z",
      backfill: false,
    });
    expect(first).toEqual({ ok: true });
    const snapshot = structuredClone(sql.parties[0]?.payload);
    settings.version = 2;
    const second = await recordBillingParty(sql, {
      invoiceId: INVOICE,
      partyId: "northbay_line",
      actor: "Ibrahim",
      at: "2026-11-17T20:02:00.000Z",
      backfill: false,
    });
    expect(second).toEqual({ ok: true });
    expect(sql.parties.map((row) => parseBillingParty(row.payload)?.party_id)).toEqual([
      "sample_line",
      "northbay_line",
    ]);
    expect(sql.parties[0]?.payload).toEqual(snapshot);
    expect(parseBillingParty(snapshot)?.settings_version).toBe(1);
    expect(sql.calls.some((call) => /^\s*(UPDATE|DELETE)/.test(call.text))).toBe(false);

    const approved = await recordApproval(sql, {
      invoiceId: INVOICE,
      actor: "Ibrahim",
      at: AT,
      acknowledgedPages: [1, 2],
    });
    expect(approved).toEqual({ ok: true });
    const insert = sql.calls.find((call) => call.text.includes("INSERT") && call.text.includes("review_decision"));
    expect(savedDecisionSchema.parse(JSON.parse(String(insert?.values[3])))).toMatchObject({
      party_id: "northbay_line",
      settings_version: 2,
    });
  });

  it("backfills an approved invoice once, and refuses any other backfill", async () => {
    const settings = { version: 3, config: sampleConfig() };
    const open = fakeSql({ settings, parties: [] });
    expect(
      await recordBillingParty(open, {
        invoiceId: INVOICE,
        partyId: "sample_line",
        actor: "Ibrahim",
        at: AT,
        backfill: true,
      }),
    ).toEqual({ ok: false, message: "That invoice is not approved." });
    expect(open.parties).toHaveLength(0);

    const approved = fakeSql({ approved: true, settings, parties: [] });
    expect(
      await recordBillingParty(approved, {
        invoiceId: INVOICE,
        partyId: "retired_line",
        actor: "Ibrahim",
        at: AT,
        backfill: true,
      }),
    ).toEqual({ ok: false, message: "That billing party is not in the current settings." });

    const missing = fakeSql({ approved: true, settings: null, parties: [] });
    expect(
      await recordBillingParty(missing, {
        invoiceId: INVOICE,
        partyId: "sample_line",
        actor: "Ibrahim",
        at: AT,
        backfill: true,
      }),
    ).toEqual({ ok: false, message: "This customer has no settings." });

    const once = fakeSql({ approved: true, settings, parties: [] });
    expect(
      await recordBillingParty(once, {
        invoiceId: INVOICE,
        partyId: "cobalt_line",
        actor: "Ibrahim",
        at: AT,
        backfill: true,
      }),
    ).toEqual({ ok: true });
    expect(parseBillingParty(once.parties[0]?.payload)).toEqual({
      invoice_id: INVOICE,
      party_id: "cobalt_line",
      settings_version: 3,
    });
    expect(
      await recordBillingParty(once, {
        invoiceId: INVOICE,
        partyId: "sample_line",
        actor: "Ibrahim",
        at: "2026-11-17T21:00:00.000Z",
        backfill: true,
      }),
    ).toEqual({ ok: false, message: "A billing party is already set." });
    expect(once.parties).toHaveLength(1);
    expect(
      await recordBillingParty(once, {
        invoiceId: INVOICE,
        partyId: "sample_line",
        actor: "Ibrahim",
        at: "2026-11-17T21:00:00.000Z",
        backfill: false,
      }),
    ).toEqual({ ok: false, message: "This invoice is already approved." });

    const recorded = fakeSql({ approved: true, approvalParty: "sample_line", settings, parties: [] });
    expect(
      await recordBillingParty(recorded, {
        invoiceId: INVOICE,
        partyId: "cobalt_line",
        actor: "Ibrahim",
        at: AT,
        backfill: true,
      }),
    ).toEqual({ ok: false, message: "A billing party is already set." });
    expect(recorded.parties).toHaveLength(0);
    expect(recorded.calls.some((call) => /^\s*(UPDATE|DELETE)/.test(call.text))).toBe(false);
  });

  it("offers the current pursue and do-not-pursue parties, and backfill only when none is set", async () => {
    const sql = fakeSql({
      settings: { version: 2, config: sampleConfig() },
      parties: [party("sample_line", 1)],
    });
    const choice = await readBillingChoice(sql, shell(false));
    expect(choice.options).toEqual([
      { id: "sample_line", label: "sample_line" },
      { id: "cobalt_line", label: "cobalt_line" },
      { id: "northbay_line", label: "northbay_line (do not pursue)" },
    ]);
    expect(choice.chosenPartyId).toBe("sample_line");
    expect(choice.canBackfill).toBe(false);
    expect(sql.calls.some((call) => call.text.includes("ORDER BY version DESC") && call.text.includes("LIMIT 1"))).toBe(
      true,
    );

    const bare = fakeSql({ approved: true, settings: { version: 2, config: sampleConfig() }, parties: [] });
    const backfill = await readBillingChoice(bare, shell(true));
    expect(backfill.chosenPartyId).toBeNull();
    expect(backfill.canBackfill).toBe(true);
  });
});

function shell(approved: boolean) {
  return {
    id: INVOICE,
    customerId: CUSTOMER,
    customer: "Harbor Home Goods",
    invoiceNumber: "SYN-1002",
    billingParty: "Sample Line Logistics",
    billedParty: "Harbor Home Goods",
    currency: "USD",
    invoiceDate: "2026-02-25",
    pageCount: 2,
    documentHash: HASH,
    rows: [],
    lines: [],
    decisions: approved
      ? [
          {
            document_hash: HASH,
            element_key: "charge_lines",
            extracted_text: null,
            outcome: "approved" as const,
            page: null,
            decided_by: "Ibrahim",
            decided_at: AT,
          },
        ]
      : [],
    approved,
  };
}

function party(partyId: string, version: number) {
  return { payload: { invoice_id: INVOICE, party_id: partyId, settings_version: version } };
}

function sampleConfig(): CustomerConfig {
  return customerConfigSchema.parse({
    id: "harbor_home",
    name: "Harbor Home Goods",
    fee_pct: "0.25",
    billed_party_role: "direct",
    nvocc: null,
    authorization: {
      document: "auth.pdf",
      signed_on: "2027-01-10",
      valid_until: "2028-01-10",
      covers: ["sample_line", "cobalt_line", "northbay_line"],
    },
    billing_parties: {
      pursue: ["sample_line", "cobalt_line"],
      do_not_pursue: ["northbay_line"],
    },
    lookback_from: "2022-06-16",
    retention_days_after_close: 730,
  });
}

function fakeSql(options?: {
  decided?: boolean;
  approved?: boolean;
  approvalParty?: string;
  settings?: { version: number; config: CustomerConfig } | null;
  parties?: { payload: unknown }[];
}): ReviewSql & {
  calls: { text: string; values: readonly unknown[] }[];
  elementRows: StoredElement[];
  parties: { payload: unknown }[];
} {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const elementRows = ELEMENT_KEYS.map((key) => stored(key));
  const parties = options?.parties ?? [];
  const decisions = [
    ...(options?.decided === true
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
      : []),
    ...(options?.approved === true
      ? [
          {
            payload: {
              document_hash: HASH,
              element_key: "charge_lines",
              extracted_text: null,
              outcome: "approved",
              page: null,
              decided_by: "Ibrahim",
              decided_at: AT,
              ...(options.approvalParty === undefined
                ? {}
                : { party_id: options.approvalParty, settings_version: 1 }),
            },
          },
        ]
      : []),
  ];
  return {
    calls,
    elementRows,
    parties,
    async query<T extends Record<string, unknown>>(text: string, values?: readonly unknown[]) {
      calls.push({ text, values: values ?? [] });
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] as T[] };
      if (text.includes("CustomerConfigVersion")) {
        const settings = options?.settings;
        if (settings === undefined || settings === null) return { rows: [] as T[] };
        return { rows: [{ version: settings.version, config: settings.config }] as unknown as T[] };
      }
      if (text.includes("billing_party_set") && text.includes("INSERT")) {
        parties.push({ payload: JSON.parse(String(values?.[3])) as unknown });
        return { rows: [] as T[] };
      }
      if (text.includes("billing_party_set")) return { rows: parties as unknown as T[] };
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
