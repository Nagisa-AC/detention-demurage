import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appDatabaseUrl, testDatabaseUrl } from "./guard";
import { lookupPortalCustomer, resolvePortalCustomer } from "../portal/customer";
import { withPortalQuery } from "../portal/query";
import { recordPublication } from "../publish";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("portal database", () => {
  let ownerUrl = "";
  let owner: Client;
  let app: Client;
  let portal: Client;

  beforeAll(async () => {
    const base = new URL(testDatabaseUrl());
    base.pathname = "/dd_portal_test";
    ownerUrl = base.toString();
    await ensureDatabase(ownerUrl);
    await ensurePortalRoles(ownerUrl);
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: webRoot,
      env: { ...process.env, DATABASE_URL: ownerUrl },
      stdio: "inherit",
    });
    owner = new Client({ connectionString: ownerUrl });
    await owner.connect();
    await owner.query("ALTER ROLE dd_app WITH LOGIN PASSWORD 'dd_app_test'");
    await owner.query("ALTER ROLE dd_portal WITH LOGIN PASSWORD 'dd_portal_test'");
    app = new Client({ connectionString: appDatabaseUrl(ownerUrl) });
    portal = new Client({ connectionString: portalDatabaseUrl(ownerUrl) });
    await app.connect();
    await portal.connect();
    process.env.PORTAL_DATABASE_URL = portalDatabaseUrl(ownerUrl);
  }, 60_000);

  afterAll(async () => {
    await portal?.end();
    await app?.end();
    await owner?.end();
  });

  beforeEach(async () => {
    await owner.query(`TRUNCATE TABLE
      "ReportExport", "Finding", "ProcessingRun", "ChargeLine", "ElementValue", "Invoice", "Document",
      "CaseLine", "Case", "Submission", "LedgerEntry", "FeeInvoice", "AuditEvent", "PortalUser",
      "CustomerConfigVersion", "FirmProfileVersion", "Customer"`);
  });

  it("shows one customer's rows and none of the other's", async () => {
    const world = await seed();
    const invoices = await asCustomer(world.a, `SELECT invoice_number, status FROM portal_invoice ORDER BY invoice_number`);
    expect(invoices).toEqual([
      { invoice_number: "A-CHECKED", status: "Checked" },
      { invoice_number: "A-OPEN", status: "Being checked" },
      { invoice_number: "A-RECEIVED", status: "Received" },
      { invoice_number: "A-SKIP", status: "Checked" },
    ]);
    const findings = await asCustomer(
      world.a,
      `SELECT invoice_number, title, plain_text, counted_amount::text AS counted_amount
       FROM portal_finding ORDER BY invoice_number, plain_text`,
    );
    expect(findings).toEqual([
      {
        invoice_number: "A-CHECKED",
        title: "Missing information",
        plain_text: "Checked against .",
        counted_amount: "8.00",
      },
    ]);
    expect(JSON.stringify(findings)).not.toMatch(/\bR[1-5]\b/);
    const reports = await asCustomer(
      world.a,
      `SELECT report_number, total_amount::text AS total_amount, currency, storage_key
       FROM portal_report ORDER BY report_number`,
    );
    expect(reports).toEqual([
      { report_number: "TMR-2026-001", total_amount: "8.00", currency: "USD", storage_key: "reports/a.pdf" },
    ]);

    const other = await asCustomer(world.b, `SELECT invoice_number FROM portal_invoice ORDER BY invoice_number`);
    expect(other.map((row) => row.invoice_number)).toEqual(["B-ATTENTION", "B-CHECKED"]);
    const hidden = await asCustomer(world.b, `SELECT count(*)::int AS n FROM portal_finding`);
    expect(hidden[0]?.n).toBe(0);
    const attention = await asCustomer(world.b, `SELECT status FROM portal_invoice WHERE invoice_number = 'B-ATTENTION'`);
    expect(attention[0]?.status).toBe("Needs attention");
    const failed = await asCustomer(world.c, `SELECT status FROM portal_invoice`);
    expect(failed).toEqual([{ status: "Needs attention" }]);
  });

  it("returns nothing when no customer is set", async () => {
    await seed();
    for (const view of ["portal_invoice", "portal_finding", "portal_report"]) {
      const open = await portal.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${view}`);
      expect(open.rows[0]?.n, view).toBe(0);
      for (const value of ["", "not-a-uuid", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]) {
        const rows = await asCustomer(value, `SELECT count(*)::int AS n FROM ${view}`);
        expect(rows[0]?.n, `${view} ${value}`).toBe(0);
      }
    }
  });

  it("refuses base tables and every write", async () => {
    const tables = await owner.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    expect(tables.rows.length).toBeGreaterThan(0);
    for (const table of tables.rows) {
      await expectDenied(portal.query(`SELECT * FROM ${quoteTable(table.table_name)}`));
    }
    await expectDenied(portal.query(`INSERT INTO "Customer" (config_id, display_name) VALUES ('x', 'X')`));
    await expectDenied(portal.query(`UPDATE "Customer" SET display_name = display_name`));
    await expectDenied(portal.query(`DELETE FROM "Customer"`));
    await expectDenied(portal.query(`TRUNCATE "Customer"`));
    const viewWrites = await owner.query<{ can_insert: boolean; can_update: boolean; can_delete: boolean }>(
      `SELECT has_table_privilege('dd_portal', 'portal_invoice', 'INSERT') AS can_insert,
              has_table_privilege('dd_portal', 'portal_finding', 'UPDATE') AS can_update,
              has_table_privilege('dd_portal', 'portal_report', 'DELETE') AS can_delete`,
    );
    expect(viewWrites.rows[0]).toEqual({ can_insert: false, can_update: false, can_delete: false });
    await expectDenied(portal.query(`INSERT INTO portal_invoice (invoice_number, currency, status) VALUES ('x', 'USD', 'Received')`), ["42501", "55000"]);
    await expectDenied(portal.query(`UPDATE portal_finding SET title = title`), ["42501", "55000"]);
    await expectDenied(portal.query(`DELETE FROM portal_report`), ["42501", "55000"]);
  });

  it("hides findings until the rules run is published, then shows the counted amount", async () => {
    const world = await seed();
    const before = await asCustomer(world.b, `SELECT invoice_number, counted_amount::text AS counted_amount FROM portal_finding`);
    expect(before).toEqual([]);
    const published = await recordPublication(appSql(), world.b, "Reviewer");
    expect(published).toBe(true);
    const again = await recordPublication(appSql(), world.b, "Reviewer");
    expect(again).toBe(false);
    const event = await app.query<{ actor: string; run_id: string }>(
      `SELECT actor, payload->>'processing_run_id' AS run_id
       FROM "AuditEvent" WHERE customer_id = $1 AND action = 'results_published'`,
      [world.b],
    );
    expect(event.rows).toEqual([{ actor: "Reviewer", run_id: world.bRun }]);
    const after = await asCustomer(
      world.b,
      `SELECT invoice_number, counted_amount::text AS counted_amount, plain_text FROM portal_finding`,
    );
    expect(after).toEqual([{ invoice_number: "B-CHECKED", counted_amount: "8.00", plain_text: "Billed twice." }]);
    const skipped = await asCustomer(world.a, `SELECT plain_text FROM portal_finding`);
    expect(skipped.map((row) => row.plain_text)).not.toContain("Do not show this.");
    expect(skipped.map((row) => row.plain_text)).not.toContain("Day zero only.");
  });

  it("keeps dd_app able to read every customer", async () => {
    await seed();
    const rows = await app.query<{ invoice_number: string }>(`SELECT invoice_number FROM "Invoice" ORDER BY invoice_number`);
    expect(rows.rows.map((row) => row.invoice_number)).toEqual([
      "A-CHECKED",
      "A-OPEN",
      "A-RECEIVED",
      "A-SKIP",
      "B-ATTENTION",
      "B-CHECKED",
      "C-FAILED",
    ]);
  });

  it("resolves the customer from the sub and ignores the request", async () => {
    const world = await seed();
    const customer = await resolvePortalCustomer(
      {
        url: `https://portal.example/invoices?customerId=${world.b}`,
        headers: {
          get(name: string) {
            if (name === "authorization") return "Bearer header.payload.sig";
            if (name === "x-customer-id") return world.b;
            return null;
          },
        },
      },
      {
        verify: async () => ({ sub: "sub-a" }),
        lookup: (sub) => lookupPortalCustomer(appSql(), sub),
      },
    );
    expect(customer?.customerId).toBe(world.a);
    const seen = await withPortalQuery(customer!, async (views) => (await views.invoices()).map((row) => row.invoice_number));
    expect(seen).toEqual(["A-CHECKED", "A-OPEN", "A-RECEIVED", "A-SKIP"]);
    await app.query(
      `INSERT INTO "AuditEvent" (customer_id, actor, action, payload)
       SELECT customer_id, 'Staff', 'portal_user_disabled', jsonb_build_object('portal_user_id', id::text)
       FROM "PortalUser" WHERE cognito_sub = 'sub-a'`,
    );
    expect(await lookupPortalCustomer(appSql(), "sub-a")).toBeNull();
  });

  it("publishes the latest successful run, not an earlier one", async () => {
    const customerId = await insertCustomer("later_line", "Later Line");
    const older = await app.query<{ id: string }>(
      `INSERT INTO "ProcessingRun" (customer_id, kind, started_at, finished_at, page_records)
       VALUES ($1, 'rules', now() - interval '2 hours', now() - interval '1 hour', '{"failed":false}'::jsonb)
       RETURNING id`,
      [customerId],
    );
    const newer = await app.query<{ id: string }>(
      `INSERT INTO "ProcessingRun" (customer_id, kind, finished_at, page_records)
       VALUES ($1, 'rules', now(), '{"failed":false}'::jsonb)
       RETURNING id`,
      [customerId],
    );
    expect(await recordPublication(appSql(), customerId, "Reviewer")).toBe(true);
    const event = await app.query<{ run_id: string }>(
      `SELECT payload->>'processing_run_id' AS run_id FROM "AuditEvent" WHERE customer_id = $1`,
      [customerId],
    );
    expect(event.rows[0]?.run_id).toBe(newer.rows[0]?.id);
    expect(event.rows[0]?.run_id).not.toBe(older.rows[0]?.id);
    const failedCustomer = await insertCustomer("failed_line", "Failed Line");
    await app.query(
      `INSERT INTO "ProcessingRun" (customer_id, kind, finished_at, page_records)
       VALUES ($1, 'rules', now(), '{"failed":true}'::jsonb)`,
      [failedCustomer],
    );
    expect(await recordPublication(appSql(), failedCustomer, "Reviewer")).toBe(false);
  });

  it("exposes only the portal columns and keeps the views security invoker", async () => {
    const columns = await owner.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('portal_invoice', 'portal_finding', 'portal_report')
       ORDER BY table_name, ordinal_position`,
    );
    const byView = new Map<string, string[]>();
    for (const row of columns.rows) {
      const list = byView.get(row.table_name) ?? [];
      list.push(row.column_name);
      byView.set(row.table_name, list);
    }
    expect(byView.get("portal_invoice")).toEqual(["invoice_number", "invoice_date", "currency", "status"]);
    expect(byView.get("portal_finding")).toEqual(["invoice_number", "title", "plain_text", "counted_amount", "currency"]);
    expect(byView.get("portal_report")).toEqual([
      "report_number",
      "issued_on",
      "total_amount",
      "currency",
      "storage_key",
      "csv_key",
    ]);
    const options = await owner.query<{ relname: string; reloptions: string[] | null }>(
      `SELECT relname, reloptions FROM pg_class
       WHERE relname IN ('portal_invoice', 'portal_finding', 'portal_report')`,
    );
    for (const row of options.rows) expect(row.reloptions ?? [], row.relname).toContain("security_invoker=true");
    const roleSql = fs.readFileSync(path.join(webRoot, "prisma/create-portal-role.sql"), "utf8");
    expect(roleSql).toContain("CREATE ROLE dd_portal LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT");
    const statements = roleSql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements.toLowerCase()).not.toContain("password");
  });

  async function asCustomer(customerId: string, text: string): Promise<Record<string, unknown>[]> {
    await portal.query("BEGIN");
    try {
      await portal.query("SELECT set_config('app.customer_id', $1, true)", [customerId]);
      const result = await portal.query<Record<string, unknown>>(text);
      await portal.query("COMMIT");
      return result.rows;
    } catch (error) {
      await portal.query("ROLLBACK");
      throw error;
    }
  }

  function appSql() {
    return {
      async query<T extends Record<string, unknown>>(text: string, values?: readonly unknown[]) {
        const result = await app.query<T>(text, values === undefined ? undefined : [...values]);
        return { rows: result.rows };
      },
    };
  }

  async function seed(): Promise<{ a: string; b: string; c: string; bRun: string }> {
    const a = await insertCustomer("harbor_home", "Harbor Home Goods");
    const b = await insertCustomer("sample_line", "Sample Line Logistics");
    const c = await insertCustomer("north_pier", "North Pier");
    const aChecked = await insertInvoice(a, "A-CHECKED");
    const aReceived = await insertInvoice(a, "A-RECEIVED");
    const aOpen = await insertInvoice(a, "A-OPEN");
    const aSkip = await insertInvoice(a, "A-SKIP");
    const bChecked = await insertInvoice(b, "B-CHECKED");
    const bAttention = await insertInvoice(b, "B-ATTENTION");
    await insertInvoice(c, "C-FAILED");
    void aReceived;

    const aRun = await insertRules(a, [
      { id: aChecked.id, pursue: true },
      { id: aSkip.id, pursue: false },
    ]);
    const bRun = await insertRules(b, [{ id: bChecked.id, pursue: true }]);
    await owner.query(
      `INSERT INTO "ProcessingRun" (customer_id, kind, finished_at, page_records)
       VALUES ($1, 'rules', now(), '{"failed":true,"message":"staff detail"}'::jsonb)`,
      [c],
    );
    await owner.query(
      `INSERT INTO "ProcessingRun" (customer_id, document_id, invoice_id, kind)
       VALUES ($1, $2, $3, 'extract')`,
      [a, aOpen.documentId, aOpen.id],
    );
    await owner.query(`UPDATE "Invoice" SET unresolved = '[{"note":"staff only"}]'::jsonb WHERE id = $1`, [bAttention.id]);

    await insertFinding(a, aChecked.id, aRun, "day1", "Checked against R1.");
    await insertFinding(a, aChecked.id, aRun, "day0", "Day zero only.");
    await insertFinding(a, aSkip.id, aRun, "day1", "Do not show this.");
    await insertFinding(b, bChecked.id, bRun, "day1", "Billed twice.");
    await insertReport(a, aRun, "TMR-2026-001", 1, "reports/a.pdf");
    await insertReport(b, bRun, "TMR-2026-002", 2, "reports/b.pdf");
    await owner.query(
      `INSERT INTO "PortalUser" (customer_id, cognito_sub, email) VALUES ($1, 'sub-a', 'a@example.com')`,
      [a],
    );
    await owner.query(
      `INSERT INTO "AuditEvent" (customer_id, actor, action, payload)
       VALUES ($1, 'Staff', 'results_published', jsonb_build_object('processing_run_id', $2::text))`,
      [a, aRun],
    );
    return { a, b, c, bRun };
  }

  async function insertCustomer(configId: string, name: string): Promise<string> {
    const inserted = await owner.query<{ id: string }>(
      `INSERT INTO "Customer" (config_id, display_name) VALUES ($1, $2) RETURNING id`,
      [configId, name],
    );
    const id = inserted.rows[0]?.id;
    if (id === undefined) throw new Error("missing customer");
    return id;
  }

  async function insertInvoice(customerId: string, number: string): Promise<{ id: string; documentId: string }> {
    const hash = createHash("sha256").update(number).digest("hex");
    const document = await owner.query<{ id: string }>(
      `INSERT INTO "Document" (customer_id, sha256, byte_size) VALUES ($1, $2, 128) RETURNING id`,
      [customerId, hash],
    );
    const documentId = document.rows[0]?.id;
    if (documentId === undefined) throw new Error("missing document");
    const invoice = await owner.query<{ id: string }>(
      `INSERT INTO "Invoice" (
         customer_id, document_id, invoice_number, billing_party, billed_party, currency, invoice_date, page_count
       ) VALUES ($1, $2, $3, 'Carrier', 'Customer', 'USD', DATE '2026-02-25', 1)
       RETURNING id`,
      [customerId, documentId, number],
    );
    const id = invoice.rows[0]?.id;
    if (id === undefined) throw new Error("missing invoice");
    return { id, documentId };
  }

  async function insertRules(customerId: string, invoices: { id: string; pursue: boolean }[]): Promise<string> {
    const line = (invoice: { id: string; pursue: boolean }, amount: string) => ({
      invoice_id: invoice.id,
      disputable: amount,
      do_not_pursue: !invoice.pursue,
      superseded_by: "",
    });
    const payload = {
      failed: false,
      settings_version: 1,
      invoice_ids: invoices.map((invoice) => invoice.id),
      total_disputable: {
        day0: [{ currency: "USD", amount: "10.00" }],
        day1: [{ currency: "USD", amount: "8.00" }],
      },
      invoices: {
        day0: invoices.map((invoice) => line(invoice, "10.00")),
        day1: invoices.map((invoice) => line(invoice, "8.00")),
      },
    };
    const inserted = await owner.query<{ id: string }>(
      `INSERT INTO "ProcessingRun" (customer_id, kind, finished_at, page_records)
       VALUES ($1, 'rules', now(), $2::jsonb) RETURNING id`,
      [customerId, JSON.stringify(payload)],
    );
    const id = inserted.rows[0]?.id;
    if (id === undefined) throw new Error("missing rules run");
    return id;
  }

  async function insertFinding(
    customerId: string,
    invoiceId: string,
    runId: string,
    convention: "day0" | "day1",
    explain: string,
  ): Promise<void> {
    await owner.query(
      `INSERT INTO "Finding" (
         customer_id, invoice_id, processing_run_id, rule, rule_version, ground,
         citations, line_ids, expected, actual, disputable_amount, currency, evidence, explain, convention
       ) VALUES (
         $1, $2, $3, 'R1', 1, 'missing_information',
         '[]'::jsonb, '[]'::jsonb, 'present', 'absent', numeric '99.00', 'USD', '[]'::jsonb, $4, $5
       )`,
      [customerId, invoiceId, runId, explain, convention],
    );
  }

  async function insertReport(customerId: string, rulesRunId: string, number: string, sequence: number, key: string): Promise<void> {
    const firm = await owner.query<{ id: string }>(
      `INSERT INTO "FirmProfileVersion" (version, firm_name, city_state, reply_to, signer_name, signer_title, created_by)
       VALUES ($1, 'Tidemark Recovery', 'New Haven, CT', 'disputes@tidemark.example', 'Ibrahim Kebbeh', 'Principal', 'seed')
       ON CONFLICT (version) DO UPDATE SET version = EXCLUDED.version
       RETURNING id`,
      [sequence],
    );
    const firmId = firm.rows[0]?.id;
    if (firmId === undefined) throw new Error("missing firm");
    const reportRun = await owner.query<{ id: string }>(
      `INSERT INTO "ProcessingRun" (customer_id, kind, finished_at, page_records)
       VALUES ($1, 'report', now(), $2::jsonb) RETURNING id`,
      [customerId, JSON.stringify({ rules_run_id: rulesRunId, firm_profile_version: sequence, actor: "Staff" })],
    );
    const reportRunId = reportRun.rows[0]?.id;
    if (reportRunId === undefined) throw new Error("missing report run");
    const hash = createHash("sha256").update(number).digest("hex");
    await owner.query(
      `INSERT INTO "ReportExport" (
         customer_id, processing_run_id, firm_profile_id, report_number, series, year, sequence,
         settings_version, firm_version, convention, pdf_sha256, csv_sha256, pdf_key, csv_key, created_by
       ) VALUES (
         $1, $2, $3, $4, 'TMR', 2026, $5,
         1, $5, 'day1', $6, $6, $7, $8, 'Staff'
       )`,
      [customerId, reportRunId, firmId, number, sequence, hash, key, key.replace(".pdf", ".csv")],
    );
  }
});

function portalDatabaseUrl(ownerUrl: string): string {
  const url = new URL(ownerUrl);
  url.username = "dd_portal";
  url.password = "dd_portal_test";
  return url.toString();
}

function quoteTable(table: string): string {
  if (!/^[A-Za-z_]+$/.test(table)) throw new Error("unexpected table name");
  return `"${table}"`;
}

async function expectDenied(run: Promise<unknown>, codes: readonly string[] = ["42501"]): Promise<void> {
  try {
    await run;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    expect(codes, code).toContain(code);
    return;
  }
  throw new Error(`expected SQLSTATE ${codes.join(" or ")}`);
}

async function ensurePortalRoles(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const existing = await client.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('dd_app', 'dd_portal', 'dd_portal_reader')`,
    );
    const names = new Set(existing.rows.map((row) => row.rolname));
    if (!names.has("dd_app")) await createRole(client, `CREATE ROLE dd_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    if (!names.has("dd_portal")) await createRole(client, `CREATE ROLE dd_portal LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    if (!names.has("dd_portal_reader")) {
      await createRole(client, `CREATE ROLE dd_portal_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    }
    await client.query(`GRANT dd_portal_reader TO CURRENT_USER`);
  } finally {
    await client.end();
  }
}

async function createRole(client: Client, sql: string): Promise<void> {
  try {
    await client.query(sql);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "42710") return;
    throw error;
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
