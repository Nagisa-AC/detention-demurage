import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ELEMENT_KEYS, carryDecisions, isConfirmedAbsent, savedDecisionSchema, type ElementRecord } from "dd-core";
import type { PrismaClient } from "@prisma/client";
import { appDatabaseUrl, testDatabaseUrl } from "./guard";
import { replayReview } from "../review-store";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const documentHash = createHash("sha256").update("synthetic-db-fixture").digest("hex");
const appendOnly = ["Submission", "LedgerEntry", "AuditEvent"] as const;
const laterTables = ["Case", "CaseLine", "Submission", "LedgerEntry", "FeeInvoice"] as const;
const customerTables = [
  "AuditEvent",
  "Case",
  "CaseLine",
  "ChargeLine",
  "Customer",
  "Document",
  "ElementValue",
  "FeeInvoice",
  "Finding",
  "Invoice",
  "LedgerEntry",
  "ProcessingRun",
  "Submission",
] as const;

describe("database", () => {
  let ownerUrl = "";
  let owner!: Client;
  let app!: Client;
  let prisma!: PrismaClient;

  beforeAll(async () => {
    ownerUrl = testDatabaseUrl();
    await ensureDatabase(ownerUrl);
    await ensureAppRole(ownerUrl);
    execFileSync("pnpm", ["exec", "prisma", "generate"], {
      cwd: webRoot,
      env: { ...process.env, DATABASE_URL: ownerUrl },
      stdio: "inherit",
    });
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: webRoot,
      env: { ...process.env, DATABASE_URL: ownerUrl },
      stdio: "inherit",
    });
    owner = new Client({ connectionString: ownerUrl });
    await owner.connect();
    await owner.query("ALTER ROLE dd_app WITH LOGIN PASSWORD 'dd_app_test'");
    app = new Client({ connectionString: appDatabaseUrl(ownerUrl) });
    sharedApp = app;
    await app.connect();
    const { PrismaClient: ClientCtor } = await import("@prisma/client");
    prisma = new ClientCtor({ datasources: { db: { url: ownerUrl } } });

    const tables = await owner.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const names = tables.rows.map((row) => row.table_name).sort();
    for (const table of customerTables) expect(names).toContain(table);

    for (const table of laterTables) {
      const count = await owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${quoteTable(table)}`);
      expect(count.rows[0]?.n).toBe(0);
    }
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await app?.end();
    await owner?.end();
  });

  beforeEach(async () => {
    await owner.query(`TRUNCATE TABLE
      "Finding", "ProcessingRun", "ChargeLine", "ElementValue", "Invoice", "Document",
      "CaseLine", "Case", "Submission", "LedgerEntry", "FeeInvoice", "AuditEvent", "Customer"`);
  });

  it("gives dd_app no update, delete, or truncate on the append-only tables", async () => {
    const privileges = await owner.query<{
      table_name: string;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
    }>(
      `SELECT table_name,
              has_table_privilege('dd_app', format('%I', table_name)::regclass, 'UPDATE') AS can_update,
              has_table_privilege('dd_app', format('%I', table_name)::regclass, 'DELETE') AS can_delete,
              has_table_privilege('dd_app', format('%I', table_name)::regclass, 'TRUNCATE') AS can_truncate
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    for (const row of privileges.rows) {
      expect(row.can_truncate, row.table_name).toBe(false);
      if ((appendOnly as readonly string[]).includes(row.table_name)) {
        expect(row.can_update, row.table_name).toBe(false);
        expect(row.can_delete, row.table_name).toBe(false);
      }
    }

    const customerId = await insertCustomer();
    await app.query(
      `INSERT INTO "AuditEvent" (customer_id, actor, action, payload)
       VALUES ($1, 'Reviewer', 'note', '{}'::jsonb)`,
      [customerId],
    );
    await app.query(
      `INSERT INTO "Submission" (customer_id) VALUES ($1)`,
      [customerId],
    );
    await app.query(
      `INSERT INTO "LedgerEntry" (customer_id, amount, currency, kind)
       VALUES ($1, numeric '0.00', 'USD', 'sample')`,
      [customerId],
    );
    const kept = await app.query<{ actor: string }>(`SELECT actor FROM "AuditEvent" WHERE customer_id = $1`, [
      customerId,
    ]);
    expect(kept.rows[0]?.actor).toBe("Reviewer");

    for (const table of appendOnly) {
      await expectSqlState(app.query(`UPDATE ${quoteTable(table)} SET customer_id = customer_id`), "42501");
      await expectSqlState(app.query(`DELETE FROM ${quoteTable(table)}`), "42501");
      await expectSqlState(app.query(`TRUNCATE ${quoteTable(table)}`), "42501");
    }
    const still = await app.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "AuditEvent" WHERE customer_id = $1`,
      [customerId],
    );
    expect(still.rows[0]?.n).toBe(1);
  });

  it("refuses to delete or rekey a customer that has audit rows", async () => {
    const customerId = await insertCustomer();
    await app.query(
      `INSERT INTO "AuditEvent" (customer_id, actor, action, payload)
       VALUES ($1, 'Reviewer', 'note', '{}'::jsonb)`,
      [customerId],
    );

    await expectSqlState(app.query(`DELETE FROM "Customer" WHERE id = $1`, [customerId]), "23503");
    await expectSqlState(
      app.query(`UPDATE "Customer" SET id = gen_random_uuid() WHERE id = $1`, [customerId]),
      "23503",
    );

    const rows = await app.query<{ customer_id: string }>(
      `SELECT customer_id FROM "AuditEvent" WHERE customer_id = $1`,
      [customerId],
    );
    expect(rows.rows.map((row) => row.customer_id)).toEqual([customerId]);
    const customer = await app.query<{ n: number }>(`SELECT count(*)::int AS n FROM "Customer" WHERE id = $1`, [
      customerId,
    ]);
    expect(customer.rows[0]?.n).toBe(1);
  });

  it("keeps foreign keys on the append-only tables restrict", async () => {
    const rules = await owner.query<{ from_table: string; to_table: string; delete_rule: string; update_rule: string }>(
      `SELECT tc.table_name AS from_table,
              ccu.table_name AS to_table,
              rc.delete_rule,
              rc.update_rule
       FROM information_schema.referential_constraints rc
       JOIN information_schema.table_constraints tc
         ON tc.constraint_schema = rc.constraint_schema
        AND tc.constraint_name = rc.constraint_name
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_schema = rc.constraint_schema
        AND ccu.constraint_name = rc.constraint_name
       WHERE tc.table_schema = 'public'
         AND (tc.table_name = ANY ($1::text[]) OR ccu.table_name = ANY ($1::text[]))`,
      [appendOnly],
    );
    expect(rules.rows.length).toBeGreaterThanOrEqual(appendOnly.length);
    for (const table of appendOnly) {
      expect(rules.rows.some((row) => row.from_table === table)).toBe(true);
    }
    for (const row of rules.rows) {
      expect(row.delete_rule, `${row.from_table} -> ${row.to_table}`).toBe("RESTRICT");
      expect(row.update_rule, `${row.from_table} -> ${row.to_table}`).toBe("RESTRICT");
    }
  });

  it("grants the same privileges to a table created by a later migration", async () => {
    await owner.query(`DROP TABLE IF EXISTS "PrivilegeProbe"`);
    try {
      await owner.query(`CREATE TABLE "PrivilegeProbe" (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`);
      const probe = await owner.query<{
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
        can_truncate: boolean;
      }>(
        `SELECT has_table_privilege('dd_app', '"PrivilegeProbe"', 'SELECT') AS can_select,
                has_table_privilege('dd_app', '"PrivilegeProbe"', 'INSERT') AS can_insert,
                has_table_privilege('dd_app', '"PrivilegeProbe"', 'UPDATE') AS can_update,
                has_table_privilege('dd_app', '"PrivilegeProbe"', 'DELETE') AS can_delete,
                has_table_privilege('dd_app', '"PrivilegeProbe"', 'TRUNCATE') AS can_truncate`,
      );
      expect(probe.rows[0]).toEqual({
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: true,
        can_truncate: false,
      });
    } finally {
      await owner.query(`DROP TABLE IF EXISTS "PrivilegeProbe"`);
    }
  });

  it("rejects confirmed_absent as a stored element state", async () => {
    const invoiceId = await insertInvoice();
    await expectSqlState(
      app.query(
        `INSERT INTO "ElementValue" (customer_id, invoice_id, element_key, state, page)
         SELECT customer_id, id, 'bl_number', 'confirmed_absent', NULL FROM "Invoice" WHERE id = $1`,
        [invoiceId],
      ),
      "23514",
    );
  });

  it("stores money as an exact decimal and dates as calendar dates", async () => {
    const invoiceId = await insertInvoice();
    await app.query(
      `INSERT INTO "ChargeLine" (
         customer_id, invoice_id, line_id, container, charge,
         charged_from, charged_to, days, rate, amount, currency
       )
       SELECT customer_id, id, 'ln_1', 'SLLU0000027', 'demurrage',
              DATE '2026-01-01', DATE '2026-01-02', 2, numeric '10.00', numeric '1.10', 'USD'
       FROM "Invoice" WHERE id = $1`,
      [invoiceId],
    );
    const summed = await app.query<{ amount: string }>(
      `UPDATE "ChargeLine" SET amount = amount + numeric '0.20' WHERE invoice_id = $1 RETURNING amount::text`,
      [invoiceId],
    );
    expect(summed.rows[0]?.amount).toBe("1.30");

    const line = await prisma.chargeLine.findFirstOrThrow({ where: { invoiceId } });
    expect(typeof line.amount).toBe("object");
    expect(line.amount.toFixed(2)).toBe("1.30");

    await owner.query("BEGIN");
    try {
      await owner.query("SET LOCAL TIME ZONE 'America/New_York'");
      const zoned = await owner.query<{ invoice_date: string; due_date: string }>(
        `SELECT invoice_date::text AS invoice_date, due_date::text AS due_date FROM "Invoice" WHERE id = $1`,
        [invoiceId],
      );
      expect(zoned.rows[0]).toEqual({ invoice_date: "2026-02-25", due_date: "2026-03-27" });
    } finally {
      await owner.query("ROLLBACK");
    }

    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(stored.invoiceDate?.toISOString().slice(0, 10)).toBe("2026-02-25");
    expect(stored.dueDate?.toISOString().slice(0, 10)).toBe("2026-03-27");

    const floats = await owner.query(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type IN ('real', 'double precision')`,
    );
    expect(floats.rows).toEqual([]);
  });

  it("puts customer_id on every customer table except Customer", async () => {
    const columns = await owner.query<{ table_name: string; column_name: string | null; is_nullable: string | null }>(
      `SELECT t.table_name, c.column_name, c.is_nullable
       FROM information_schema.tables t
       LEFT JOIN information_schema.columns c
         ON c.table_schema = t.table_schema
        AND c.table_name = t.table_name
        AND c.column_name = 'customer_id'
       WHERE t.table_schema = 'public'
         AND t.table_type = 'BASE TABLE'
         AND t.table_name <> '_prisma_migrations'`,
    );
    const byTable = new Map(columns.rows.map((row) => [row.table_name, row]));
    expect(byTable.get("Customer")?.column_name).toBeNull();
    for (const table of customerTables) {
      if (table === "Customer") continue;
      expect(byTable.get(table)?.column_name, table).toBe("customer_id");
      expect(byTable.get(table)?.is_nullable, table).toBe("NO");
    }
  });

  it("replays append-only decisions through loadReview", async () => {
    const invoiceId = await insertInvoice();
    const customer = await app.query<{ customer_id: string }>(
      `SELECT customer_id FROM "Invoice" WHERE id = $1`,
      [invoiceId],
    );
    const customerId = customer.rows[0]?.customer_id;
    if (customerId === undefined) throw new Error("missing customer");

    for (const key of ELEMENT_KEYS) {
      const suggested = key === "free_time_start" || key === "free_time_end";
      await app.query(
        `INSERT INTO "ElementValue" (customer_id, invoice_id, element_key, state, page)
         VALUES ($1, $2, $3, $4, NULL)`,
        [customerId, invoiceId, key, suggested ? "suggested_absent" : "not_applicable"],
      );
    }

    const when = ["2026-11-15T20:00:00Z", "2026-11-15T20:00:01Z"];
    for (const [index, key] of ["free_time_start", "free_time_end"].entries()) {
      await app.query(
        `INSERT INTO "AuditEvent" (customer_id, at, actor, action, payload)
         VALUES ($1, $2::timestamptz, 'Reviewer', 'review_decision', $3::jsonb)`,
        [
          customerId,
          when[index],
          JSON.stringify({
            document_hash: documentHash,
            element_key: key,
            extracted_text: null,
            outcome: "confirmed_absent",
            page: null,
            decided_by: "Reviewer",
            decided_at: "2026-11-15T20:00:00Z",
          }),
        ],
      );
    }

    const stored = await prisma.elementValue.findMany({ where: { invoiceId } });
    expect(stored.every((row) => row.state !== "confirmed_absent")).toBe(true);
    const events = await app.query<{ payload: unknown }>(
      `SELECT payload FROM "AuditEvent"
       WHERE customer_id = $1 AND action = 'review_decision'
       ORDER BY at, id`,
      [customerId],
    );
    expect(events.rows).toHaveLength(2);
    for (const event of events.rows) expect(isConfirmedAbsent(event.payload)).toBe(false);

    const decisions = events.rows.map((event) => {
      const parsed = savedDecisionSchema.safeParse(event.payload);
      if (!parsed.success) throw new Error("decision payload failed");
      return parsed.data;
    });
    const elements = {} as ElementRecord;
    for (const key of ELEMENT_KEYS) {
      elements[key] =
        key === "free_time_start" || key === "free_time_end"
          ? { state: "suggested_absent", page: null }
          : { state: "not_applicable", page: null };
    }
    const invoice = {
      invoice_number: { text: "SYN-1002", page: 1 },
      billing_party: { text: "Sample Line Logistics", page: 1 },
      billed_party: { text: "Harbor Home Goods", page: 1 },
      currency: { text: "USD", page: 1 },
      elements: {},
      conflicts: [],
      header_conflicts: [],
      charge_lines: [],
      unresolved: [],
    };
    const carried = carryDecisions(documentHash, decisions, elements, invoice);
    expect(isConfirmedAbsent(carried.elements.free_time_start)).toBe(false);
    expect(isConfirmedAbsent(carried.elements.free_time_end)).toBe(false);

    const header = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const reviewed = replayReview({
      documentHash,
      acknowledgedPages: [1],
      invoice: {
        invoiceNumber: header.invoiceNumber,
        billingParty: header.billingParty,
        billedParty: header.billedParty,
        currency: header.currency,
        pageCount: header.pageCount,
      },
      elements: stored.map((row) => ({
        elementKey: row.elementKey,
        state: row.state,
        text: row.text,
        value: row.value,
        page: row.page,
      })),
      decisions: events.rows.map((event) => event.payload),
      lineApproval: { decided_by: "Reviewer", decided_at: "2026-11-15T20:00:00Z" },
    });
    expect(isConfirmedAbsent(reviewed.elements.free_time_start)).toBe(true);
    expect(isConfirmedAbsent(reviewed.elements.free_time_end)).toBe(true);
    expect(reviewed.decisions).toHaveLength(2);
  });
});

async function insertCustomer(): Promise<string> {
  const inserted = await appQuery<{ id: string }>(
    `INSERT INTO "Customer" (config_id, display_name)
     VALUES ('sample_line', 'Sample Line Logistics')
     RETURNING id`,
  );
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error("missing customer id");
  return id;
}

async function insertInvoice(): Promise<string> {
  const customerId = await insertCustomer();
  const document = await appQuery<{ id: string }>(
    `INSERT INTO "Document" (customer_id, sha256, byte_size)
     VALUES ($1, $2, 128)
     RETURNING id`,
    [customerId, documentHash],
  );
  const documentId = document.rows[0]?.id;
  if (documentId === undefined) throw new Error("missing document id");
  const invoice = await appQuery<{ id: string }>(
    `INSERT INTO "Invoice" (
       customer_id, document_id, invoice_number, billing_party, billed_party,
       currency, invoice_date, due_date, page_count
     ) VALUES (
       $1, $2, 'SYN-1002', 'Sample Line Logistics', 'Harbor Home Goods',
       'USD', DATE '2026-02-25', DATE '2026-03-27', 1
     )
     RETURNING id`,
    [customerId, documentId],
  );
  const invoiceId = invoice.rows[0]?.id;
  if (invoiceId === undefined) throw new Error("missing invoice id");
  return invoiceId;
}

function appQuery<T extends Record<string, unknown>>(text: string, values?: unknown[]) {
  if (sharedApp === undefined) throw new Error("app client is not connected");
  return sharedApp.query<T>(text, values);
}

let sharedApp: Client | undefined;

function quoteTable(table: string): string {
  if (!/^[A-Za-z]+$/.test(table)) throw new Error("unexpected table name");
  return `"${table}"`;
}

async function expectSqlState(run: Promise<unknown>, code: string): Promise<void> {
  try {
    await run;
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`expected SQLSTATE ${code}`);
}

async function ensureAppRole(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const existing = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'dd_app'");
    if ((existing.rowCount ?? 0) > 0) return;
    const sql = fs.readFileSync(path.join(webRoot, "prisma/create-app-role.sql"), "utf8");
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function ensureDatabase(url: string): Promise<void> {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, "");
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error("Test database name is not a simple identifier.");
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (existing.rowCount === 0) await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
}
