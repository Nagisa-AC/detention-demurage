import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCustomerConfig } from "dd-core";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runReport } from "./run.js";
import { REPORT_FAILURES } from "./reasons.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const webRoot = path.join(repoRoot, "apps/dd-web");
const ownerUrl = reportDatabaseUrl();
const appUrl = appDatabaseUrl(ownerUrl);

let owner: Client;
let pool: Pool;

beforeAll(async () => {
  await ensureDatabase(ownerUrl);
  await ensureAppRole(ownerUrl);
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: ownerUrl },
    stdio: "inherit",
  });
  owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  await owner.query("ALTER ROLE dd_app WITH LOGIN PASSWORD 'dd_app_test'");
  pool = new Pool({ connectionString: appUrl, max: 4 });
}, 60_000);

afterAll(async () => {
  await pool?.end();
  await owner?.end();
});

describe("report job", () => {
  it("stores the PDF and CSV, the audit row, and the finished run in one transaction", async () => {
    const fixture = new Uint8Array(fs.readFileSync(path.join(repoRoot, "fixtures/synthetic/clean.pdf")));
    const held = await seed("job_ok");
    const puts: { key: string; body: Uint8Array; type: string }[] = [];
    try {
      const outcome = await runReport({
        pool,
        claimed: held.claimed,
        download: async () => fixture,
        put: async (key, body, type) => {
          puts.push({ key, body, type });
        },
      });
      expect(outcome).toBe("finished");
      expect(puts.map((item) => item.type).sort()).toEqual(["application/pdf", "text/csv; charset=utf-8"]);
      const pdf = puts.find((item) => item.type === "application/pdf");
      expect(pdf?.body[0]).toBe(0x25);
      const csv = puts.find((item) => item.type.startsWith("text/csv"));
      expect(new TextDecoder().decode(csv?.body ?? new Uint8Array())).toContain("invoice,carrier,container,check");

      const stored = await pool.query<{
        report_number: string;
        pdf_sha256: string;
        csv_sha256: string;
        convention: string;
        finished_at: Date | null;
        page_records: unknown;
        payload: unknown;
      }>(
        `SELECT e.report_number, e.pdf_sha256, e.csv_sha256, e.convention, r.finished_at, r.page_records, a.payload
         FROM "ReportExport" e
         JOIN "ProcessingRun" r ON r.customer_id = e.customer_id AND r.kind = 'report'
         JOIN "AuditEvent" a ON a.customer_id = e.customer_id AND a.action = 'report_exported'
         WHERE e.customer_id = $1`,
        [held.customerId],
      );
      const row = stored.rows[0];
      expect(row?.finished_at).toBeInstanceOf(Date);
      expect(row?.pdf_sha256).toBe(sha(pdf?.body ?? new Uint8Array()));
      expect(row?.csv_sha256).toBe(sha(csv?.body ?? new Uint8Array()));
      expect(row?.convention).toBe("day1");
      expect(row?.payload).toMatchObject({
        run_id: held.rulesRunId,
        firm_profile_version: 1,
        report_number: row?.report_number,
      });
      expect(row?.page_records).toMatchObject({ failed: false, rules_run_id: held.rulesRunId });
    } finally {
      await clear(held.customerId);
    }
  }, 60_000);

  it("saves a fixed reason when the rules run is missing, and when the invoices are too large", async () => {
    const missing = await seed("job_missing");
    try {
      await pool.query(
        `UPDATE "ProcessingRun" SET page_records = $2::jsonb WHERE id = $1`,
        [missing.claimed.id, JSON.stringify({ rules_run_id: randomUUID(), firm_profile_version: 1, actor: "Ada" })],
      );
      expect(await runReport({
        pool,
        claimed: missing.claimed,
        download: async () => new Uint8Array([1]),
        put: async () => { throw new Error("should not store"); },
      })).toBe("finished");
      const failed = await pool.query<{ page_records: { reason?: string }; finished_at: Date | null }>(
        `SELECT page_records, finished_at FROM "ProcessingRun" WHERE id = $1`,
        [missing.claimed.id],
      );
      expect(failed.rows[0]?.finished_at).toBeInstanceOf(Date);
      expect(failed.rows[0]?.page_records.reason).toBe(REPORT_FAILURES.build);
      const exports = await pool.query(`SELECT 1 FROM "ReportExport" WHERE customer_id = $1`, [missing.customerId]);
      expect(exports.rowCount).toBe(0);
    } finally {
      await clear(missing.customerId);
    }

    const large = await seed("job_large");
    const puts: string[] = [];
    try {
      expect(await runReport({
        pool,
        claimed: large.claimed,
        download: async () => new Uint8Array(32),
        put: async () => { puts.push("put"); },
        maxPdfBytes: 8,
      })).toBe("finished");
      expect(puts).toEqual([]);
      const failed = await pool.query<{ page_records: { reason?: string } }>(
        `SELECT page_records FROM "ProcessingRun" WHERE id = $1`,
        [large.claimed.id],
      );
      expect(failed.rows[0]?.page_records.reason).toBe(REPORT_FAILURES.large);
    } finally {
      await clear(large.customerId);
    }
  });

  it("leaves the run unfinished when storage fails before the last attempt", async () => {
    const held = await seed("job_store");
    try {
      const error = Object.assign(new Error("slow"), { name: "TimeoutError", $metadata: { httpStatusCode: 503 } });
      expect(await runReport({
        pool,
        claimed: held.claimed,
        download: async () => new Uint8Array(fs.readFileSync(path.join(repoRoot, "fixtures/synthetic/clean.pdf"))),
        put: async () => { throw error; },
      })).toBe("retry");
      const row = await pool.query<{ finished_at: Date | null; lease_token: string | null }>(
        `SELECT finished_at, lease_token FROM "ProcessingRun" WHERE id = $1`,
        [held.claimed.id],
      );
      expect(row.rows[0]).toEqual({ finished_at: null, lease_token: null });
    } finally {
      await clear(held.customerId);
    }
  });
});

async function seed(configId: string): Promise<{ customerId: string; rulesRunId: string; claimed: { kind: "report"; id: string; customerId: string; attempts: number; leaseToken: string } }> {
  const config = loadCustomerConfig(path.join(repoRoot, "fixtures/config/harbor_home.yaml"));
  const customer = await pool.query<{ id: string }>(
    `INSERT INTO "Customer" (config_id, display_name) VALUES ($1, 'Harbor Home Goods') RETURNING id`,
    [`${configId}_${randomUUID().slice(0, 8)}`],
  );
  const customerId = required(customer.rows[0]?.id);
  await pool.query(
    `INSERT INTO "CustomerConfigVersion" (customer_id, version, config, created_by) VALUES ($1, 1, $2::jsonb, 'Ada')`,
    [customerId, JSON.stringify(config)],
  );
  const hash = "b".repeat(64);
  const document = await pool.query<{ id: string }>(
    `INSERT INTO "Document" (customer_id, sha256, byte_size, storage_key)
     VALUES ($1, $2, 10, $3) RETURNING id`,
    [customerId, hash, `documents/${customerId}/${hash}.pdf`],
  );
  const documentId = required(document.rows[0]?.id);
  const invoice = await pool.query<{ id: string }>(
    `INSERT INTO "Invoice" (customer_id, document_id, invoice_number, billing_party, billed_party, currency, page_count, unresolved)
     VALUES ($1, $2, 'SYN-1001', 'Sample Line Logistics', 'Harbor Home Goods', 'USD', 1, '[]'::jsonb)
     RETURNING id`,
    [customerId, documentId],
  );
  const invoiceId = required(invoice.rows[0]?.id);
  const summary = {
    failed: false,
    settings_version: 1,
    invoice_ids: [invoiceId],
    total_disputable: {
      day0: [{ currency: "USD", amount: "0.00" }],
      day1: [{ currency: "USD", amount: "0.00" }],
    },
    invoices: {
      day0: [{ invoice_id: invoiceId, disputable: "0.00", do_not_pursue: false, superseded_by: "" }],
      day1: [{ invoice_id: invoiceId, disputable: "0.00", do_not_pursue: false, superseded_by: "" }],
    },
  };
  const rules = await pool.query<{ id: string }>(
    `INSERT INTO "ProcessingRun" (customer_id, kind, finished_at, page_records)
     VALUES ($1, 'rules', '2026-11-18T16:00:00Z', $2::jsonb) RETURNING id`,
    [customerId, JSON.stringify(summary)],
  );
  const rulesRunId = required(rules.rows[0]?.id);
  const firm = await pool.query<{ version: number }>(`SELECT version FROM "FirmProfileVersion" WHERE version = 1`);
  if (firm.rows[0]?.version !== 1) throw new Error("missing firm profile");
  const token = randomUUID();
  const report = await pool.query<{ id: string }>(
    `INSERT INTO "ProcessingRun" (customer_id, kind, attempts, lease_token, leased_at, page_records)
     VALUES ($1, 'report', 1, $2::uuid, now(), $3::jsonb) RETURNING id`,
    [customerId, token, JSON.stringify({ rules_run_id: rulesRunId, firm_profile_version: 1, actor: "Ada" })],
  );
  return {
    customerId,
    rulesRunId,
    claimed: { kind: "report", id: required(report.rows[0]?.id), customerId, attempts: 1, leaseToken: token },
  };
}

async function clear(customerId: string): Promise<void> {
  await owner.query(`DELETE FROM "AuditEvent" WHERE customer_id = $1`, [customerId]);
  await owner.query(`DELETE FROM "ReportExport" WHERE customer_id = $1`, [customerId]);
  await owner.query(`DELETE FROM "Finding" WHERE customer_id = $1`, [customerId]);
  await owner.query(`DELETE FROM "ChargeLine" WHERE customer_id = $1`, [customerId]);
  await owner.query(`DELETE FROM "ElementValue" WHERE customer_id = $1`, [customerId]);
  await owner.query(`DELETE FROM "ProcessingRun" WHERE customer_id = $1`, [customerId]);
  await owner.query(`DELETE FROM "Invoice" WHERE customer_id = $1`, [customerId]);
  await owner.query(`DELETE FROM "Document" WHERE customer_id = $1`, [customerId]);
  await owner.query(`DELETE FROM "CustomerConfigVersion" WHERE customer_id = $1`, [customerId]);
  await owner.query(`DELETE FROM "Customer" WHERE id = $1`, [customerId]);
}

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function required(value: string | undefined): string {
  if (value === undefined) throw new Error("missing row");
  return value;
}

function reportDatabaseUrl(): string {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/dd_test");
  if (url.hostname === "neon.tech" || url.hostname.endsWith(".neon.tech")) throw new Error("Tests refuse a Neon host.");
  url.pathname = "/dd_worker_report_test";
  return url.toString();
}

function appDatabaseUrl(owner: string): string {
  const url = new URL(owner);
  url.username = "dd_app";
  url.password = "dd_app_test";
  return url.toString();
}

async function ensureAppRole(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const existing = await client.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('dd_app', 'dd_portal', 'dd_portal_reader', 'dd_portal_lookup')`,
    );
    const names = new Set(existing.rows.map((row) => row.rolname));
    if (!names.has("dd_app")) await client.query(fs.readFileSync(path.join(webRoot, "prisma/create-app-role.sql"), "utf8"));
    if (!names.has("dd_portal")) await createRole(client, `CREATE ROLE dd_portal LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    if (!names.has("dd_portal_reader")) {
      await createRole(client, `CREATE ROLE dd_portal_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    }
    if (!names.has("dd_portal_lookup")) {
      await createRole(client, `CREATE ROLE dd_portal_lookup NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    }
    await client.query(`GRANT dd_portal_reader TO CURRENT_USER`);
    await client.query(`GRANT dd_portal_lookup TO CURRENT_USER`);
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
  const name = new URL(url).pathname.replace(/^\//, "");
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
