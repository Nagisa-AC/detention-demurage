import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ELEMENT_KEYS, pageExtractionSchema, type PageExtraction } from "dd-core";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { extractionValues } from "./model.js";
import { processDocument, sha256Hex, type GroundPage, type ProcessResult } from "./process.js";
import { claimNext, finishRun, loadRunDocument, requeueRun, type ClaimedExtract, type ClaimedRun } from "./queue.js";
import { pagesFromFixture, textOf } from "./synthetic-pages.js";
import { runOnce } from "./loop.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const webRoot = path.join(repoRoot, "apps/dd-web");
const ownerUrl = workerDatabaseUrl();
const appUrl = appDatabaseUrl(ownerUrl);
const hash = "a".repeat(64);

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
  const app = await pool.connect();
  try {
    await app.query(`DELETE FROM "ProcessingRun"`);
    await app.query(`DELETE FROM "Document"`);
    await app.query(`DELETE FROM "Customer"`);
  } finally {
    app.release();
  }
}, 60_000);

afterAll(async () => {
  await pool?.end();
  await owner?.end();
});

describe("extract queue", () => {
  it("lets one worker take a run, picks a crashed run up again, and finishes the third failure", async () => {
    const sql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "queue.ts"), "utf8");
    expect(sql).toContain("FOR UPDATE OF r SKIP LOCKED");
    const customer = await pool.query<{ id: string }>(
      `INSERT INTO "Customer" (config_id, display_name) VALUES ('worker_queue', 'Sample') RETURNING id`,
    );
    const customerId = customer.rows[0]?.id;
    if (customerId === undefined) throw new Error("missing customer");
    const document = await pool.query<{ id: string }>(
      `INSERT INTO "Document" (customer_id, sha256, byte_size, storage_key)
       VALUES ($1, $2, 10, $3)
       RETURNING id`,
      [customerId, hash, `documents/${customerId}/${hash}.pdf`],
    );
    const documentId = document.rows[0]?.id;
    if (documentId === undefined) throw new Error("missing document");
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO "ProcessingRun" (customer_id, document_id, kind) VALUES ($1, $2, 'extract') RETURNING id`,
      [customerId, documentId],
    );
    const runId = inserted.rows[0]?.id;
    if (runId === undefined) throw new Error("missing run");
    expect(await loadRunDocument(pool, runId)).toEqual({
      storageKey: `documents/${customerId}/${hash}.pdf`,
      sha256: hash,
    });
    expect(await loadRunDocument(pool, "00000000-0000-4000-8000-000000000000")).toBeNull();

    const [first, second] = await Promise.all([claimNext(pool, 3600), claimNext(pool, 3600)]);
    const claimed = [first, second].filter((row) => row !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.attempts).toBe(1);

    const crashed = await claimNext(pool, 0);
    expect(crashed?.id).toBe(claimed[0]?.id);
    expect(crashed?.attempts).toBe(2);
    if (crashed === null || crashed.kind !== "extract") throw new Error("missing reclaim");
    await finishRun(pool, crashed, {
      permanent: false,
      pages: [{ page: 1, status: "failed", reason: "checksum", ungrounded: [] }],
      modelVersion: null,
      promptVersion: null,
      schemaVersion: null,
    });

    const third = await claimNext(pool, 3600);
    expect(third?.attempts).toBe(3);
    if (third === null || third.kind !== "extract") throw new Error("missing third claim");
    await finishRun(pool, third, {
      permanent: true,
      pages: [{ page: 1, status: "failed", reason: "checksum", ungrounded: [] }],
      modelVersion: "fake",
      promptVersion: "1",
      schemaVersion: "1",
    });
    expect(await claimNext(pool, 3600)).toBeNull();

    const stored = await pool.query<{ finished_at: Date | null; page_records: unknown; attempts: number }>(
      `SELECT finished_at, page_records, attempts FROM "ProcessingRun" WHERE id = $1`,
      [third.id],
    );
    expect(stored.rows[0]?.attempts).toBe(3);
    expect(stored.rows[0]?.finished_at).not.toBeNull();
    const recorded = JSON.stringify(stored.rows[0]?.page_records);
    expect(recorded).toContain("checksum");
    expect(recorded).not.toContain("marked-secret-filename");

    expect(await requeueRun(pool, third.id)).toBe(true);
    const again = await pool.query<{
      finished_at: Date | null;
      attempts: number;
      lease_token: string | null;
      leased_at: Date | null;
      page_records: unknown;
    }>(
      `SELECT finished_at, attempts, lease_token, leased_at, page_records FROM "ProcessingRun" WHERE id = $1`,
      [third.id],
    );
    expect(again.rows[0]).toEqual({
      finished_at: null,
      attempts: 0,
      lease_token: null,
      leased_at: null,
      page_records: null,
    });
    expect(await requeueRun(pool, "00000000-0000-4000-8000-000000000000")).toBe(false);
  });

  it("claims a report run beside an extract run, oldest first", async () => {
    const customer = await pool.query<{ id: string }>(
      `INSERT INTO "Customer" (config_id, display_name) VALUES ('worker_report_claim', 'Sample') RETURNING id`,
    );
    const customerId = requiredId(customer.rows[0]?.id);
    const document = await pool.query<{ id: string }>(
      `INSERT INTO "Document" (customer_id, sha256, byte_size, storage_key)
       VALUES ($1, $2, 10, $3) RETURNING id`,
      [customerId, hash, `documents/${customerId}/${hash}.pdf`],
    );
    const documentId = requiredId(document.rows[0]?.id);
    await pool.query(
      `INSERT INTO "ProcessingRun" (customer_id, kind, page_records, started_at)
       VALUES ($1, 'report', $2::jsonb, now() - interval '2 hours')`,
      [customerId, JSON.stringify({ rules_run_id: "00000000-0000-4000-8000-0000000000aa", firm_profile_version: 1, actor: "Ada" })],
    );
    await pool.query(
      `INSERT INTO "ProcessingRun" (customer_id, document_id, kind, started_at)
       VALUES ($1, $2, 'extract', now() - interval '1 hour')`,
      [customerId, documentId],
    );
    try {
      const first = await claimNext(pool, 3600);
      const second = await claimNext(pool, 3600);
      expect(first).toMatchObject({ kind: "report", customerId });
      expect(second).toMatchObject({ kind: "extract", customerId });
    } finally {
      await pool.query(`DELETE FROM "ProcessingRun" WHERE customer_id = $1`, [customerId]);
      await pool.query(`DELETE FROM "Document" WHERE customer_id = $1`, [customerId]);
      await pool.query(`DELETE FROM "Customer" WHERE id = $1`, [customerId]);
    }
  });
});

describe("saved read", () => {
  const pdf = new Uint8Array([8, 8, 8]);
  const hash = sha256Hex(pdf);

  beforeEach(async () => {
    await pool.query(`DELETE FROM "ChargeLine"`);
    await pool.query(`DELETE FROM "ElementValue"`);
    await pool.query(`DELETE FROM "Finding"`);
    await pool.query(`DELETE FROM "ProcessingRun"`);
    await pool.query(`DELETE FROM "Invoice"`);
    await pool.query(`DELETE FROM "Document"`);
    await pool.query(`DELETE FROM "Customer"`);
  });

  it("writes the clean fixture in one transaction and links the run", async () => {
    const claimed = await seed("save_clean", hash);
    const result = await readFixture(pdf, hash, pagesFromFixture("clean"));
    await finishRun(pool, claimed, { ...result, permanent: true });

    const invoice = await pool.query<{
      id: string;
      customer_id: string;
      document_id: string;
      invoice_number: string;
      billing_party: string;
      billed_party: string;
      currency: string;
      invoice_date: string;
      due_date: string;
      page_count: number;
    }>(
      `SELECT id, customer_id, document_id, invoice_number, billing_party, billed_party, currency,
              invoice_date::text AS invoice_date, due_date::text AS due_date, page_count
       FROM "Invoice"`,
    );
    expect(invoice.rows).toHaveLength(1);
    expect(invoice.rows[0]).toMatchObject({
      customer_id: claimed.customerId,
      document_id: claimed.documentId,
      invoice_number: "SYN-1001",
      billing_party: "Sample Line Logistics",
      billed_party: "Harbor Home Goods",
      currency: "USD",
      invoice_date: "2026-01-20",
      due_date: "2026-02-19",
      page_count: 1,
    });
    const invoiceId = invoice.rows[0]?.id;
    if (invoiceId === undefined) throw new Error("missing invoice");

    const elements = await pool.query<{ element_key: string; state: string; grounded: boolean | null; text: string | null; value: string | null }>(
      `SELECT element_key, state, grounded, text, value FROM "ElementValue" ORDER BY element_key`,
    );
    expect(elements.rows).toHaveLength(20);
    expect(elements.rows.map((row) => row.element_key).sort()).toEqual([...ELEMENT_KEYS].sort());
    const saved = result.read?.elements ?? [];
    for (const row of elements.rows) {
      const expected = saved.find((element) => element.key === row.element_key);
      expect(row.state, row.element_key).toBe(expected?.state);
      expect(row.grounded, row.element_key).toBe(expected?.grounded ?? null);
      expect(row.text, row.element_key).toBe(expected?.text ?? null);
      expect(row.value, row.element_key).toBe(expected?.value ?? null);
    }
    expect(elements.rows.find((row) => row.element_key === "earliest_return_date")).toMatchObject({
      state: "not_applicable",
      grounded: null,
      text: null,
    });

    const lines = await pool.query<{
      line_id: string;
      container: string;
      charge: string;
      charged_from: string;
      charged_to: string;
      days: number;
      rate: string;
      amount: string;
      currency: string;
      grounded: boolean | null;
      container_page: number | null;
      from_page: number | null;
      to_page: number | null;
      days_page: number | null;
      rate_page: number | null;
      amount_page: number | null;
    }>(
      `SELECT line_id, container, charge, charged_from::text AS charged_from, charged_to::text AS charged_to,
              days, rate::text AS rate, amount::text AS amount, currency, grounded,
              container_page, from_page, to_page, days_page, rate_page, amount_page
       FROM "ChargeLine"`,
    );
    expect(lines.rows).toEqual([
      {
        line_id: "ln_1",
        container: "SLLU0000011",
        charge: "demurrage",
        charged_from: "2026-01-10",
        charged_to: "2026-01-12",
        days: 3,
        rate: "150.00",
        amount: "450.00",
        currency: "USD",
        grounded: true,
        container_page: 1,
        from_page: 1,
        to_page: 1,
        days_page: 1,
        rate_page: 1,
        amount_page: 1,
      },
    ]);
    const unresolved = await pool.query<{ unresolved: unknown }>(`SELECT unresolved FROM "Invoice" WHERE id = $1`, [
      invoiceId,
    ]);
    expect(unresolved.rows[0]?.unresolved).toEqual([]);

    const run = await pool.query<{ invoice_id: string | null; finished_at: Date | null; lease_token: string | null; page_records: unknown }>(
      `SELECT invoice_id, finished_at, lease_token, page_records FROM "ProcessingRun" WHERE id = $1`,
      [claimed.id],
    );
    expect(run.rows[0]?.invoice_id).toBe(invoiceId);
    expect(run.rows[0]?.finished_at).not.toBeNull();
    expect(run.rows[0]?.lease_token).toBeNull();
    expect(JSON.stringify(run.rows[0]?.page_records)).not.toContain("SYN-1001");
  });

  it("stores an ungrounded value apart from a missing element and an export-only element", async () => {
    const invented = "NOT-ON-PAGE";
    const [clean] = pagesFromFixture("clean");
    if (clean === undefined) throw new Error("missing page");
    const pageText = textOf(clean);
    const elements = { ...clean.elements };
    delete elements.port_of_discharge;
    elements.bl_number = { text: invented, page: 1 };
    elements.earliest_return_date = { text: "Export Yard", page: 1 };
    const page = pageExtractionSchema.parse({ ...clean, elements });
    const claimed = await seed("save_ground", hash);
    const result = await readFixture(pdf, hash, [page], [pageText]);
    await finishRun(pool, claimed, { ...result, permanent: true });

    const rows = await pool.query<{ element_key: string; state: string; text: string | null; grounded: boolean | null }>(
      `SELECT element_key, state, text, grounded FROM "ElementValue"
       WHERE element_key IN ('bl_number', 'port_of_discharge', 'earliest_return_date')`,
    );
    const byKey = new Map(rows.rows.map((row) => [row.element_key, row]));
    expect(byKey.get("bl_number")).toMatchObject({ state: "present", text: invented, grounded: false });
    expect(byKey.get("port_of_discharge")).toMatchObject({ state: "suggested_absent", text: null, grounded: null });
    expect(byKey.get("earliest_return_date")).toMatchObject({ state: "not_applicable", text: null, grounded: null });
    const recorded = await pool.query<{ page_records: { ungrounded: string[] }[] }>(
      `SELECT page_records FROM "ProcessingRun" WHERE id = $1`,
      [claimed.id],
    );
    expect(recorded.rows[0]?.page_records[0]?.ungrounded).toEqual(["bl_number"]);
    expect(JSON.stringify(recorded.rows[0]?.page_records)).not.toContain(invented);
    expect(await pool.query(`SELECT count(*)::int AS n FROM "Invoice"`)).toMatchObject({ rows: [{ n: 1 }] });
  });

  it("finishes a document with a page that has no text layer and saves no invoice", async () => {
    const [page] = pagesFromFixture("clean");
    if (page === undefined) throw new Error("missing page");
    const claimed = await seed("save_no_text", hash);
    const result = await readFixture(pdf, hash, [page], [textOf(page), ""]);
    expect(result.finish).toBe("ok");
    expect(result.read).toBeUndefined();
    expect(result.pages.map((item) => item.status)).toEqual(["ok", "no_text_layer"]);
    await finishRun(pool, claimed, { ...result, permanent: true });
    expect(await counts()).toEqual({ invoices: 0, elements: 0, lines: 0 });
    const stored = await pool.query<{ finished_at: Date | null; page_records: { page: number; status: string }[] }>(
      `SELECT finished_at, page_records FROM "ProcessingRun" WHERE id = $1`,
      [claimed.id],
    );
    expect(stored.rows[0]?.finished_at).not.toBeNull();
    expect(stored.rows[0]?.page_records[1]).toMatchObject({ page: 2, status: "no_text_layer" });
  });

  it("keeps a conflicting element as unreadable", async () => {
    const [first] = pagesFromFixture("clean");
    if (first === undefined) throw new Error("missing page");
    const second = pageExtractionSchema.parse({
      page: 2,
      elements: { bl_number: { text: "SYN-BL-OTHER", page: 2 } },
      charge_lines: [],
    });
    const claimed = await seed("save_conflict", hash);
    const result = await readFixture(pdf, hash, [first, second], [textOf(first), "SYN-BL-OTHER"]);
    expect(result.finish).toBe("ok");
    await finishRun(pool, claimed, { ...result, permanent: true });
    const row = await pool.query<{ state: string; text: string | null; grounded: boolean | null }>(
      `SELECT state, text, grounded FROM "ElementValue" WHERE element_key = 'bl_number'`,
    );
    expect(row.rows[0]).toEqual({ state: "unreadable", text: "SYN-BL-1001", grounded: true });
    expect(await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "Invoice"`)).toMatchObject({ rows: [{ n: 1 }] });
  });

  it("finishes a stitch or normalize failure with a named reason and no rows", async () => {
    const secret = "NOT-MONEY-SECRET";
    const [clean] = pagesFromFixture("clean");
    if (clean === undefined) throw new Error("missing page");
    const line = clean.charge_lines[0];
    if (line === undefined) throw new Error("missing line");
    const bad = pageExtractionSchema.parse({ ...clean, charge_lines: [{ ...line, amount: secret }] });
    const claimed = await seed("save_normalize", hash);
    expect(claimed.attempts).toBe(1);
    const logs: string[] = [];
    let calls = 0;
    await runOnce({
      claim: async () => claimed,
      download: async () => pdf,
      process: async (file, declaredHash) => {
        calls += 1;
        return readFixture(file, declaredHash, [bad]);
      },
      finish: (run, result) => finishRun(pool, run, result),
      report: async () => "finished",
      log: (entry) => logs.push(entry),
    });
    expect(calls).toBe(1);
    expect(logs[0]).toBe(`run ${claimed.id} failed process NormalizeError`);
    expect(logs[1]).toBe(`run ${claimed.id} finished`);
    expect(logs.join("\n")).not.toContain(secret);
    expect(await claimNext(pool, 3600)).toBeNull();
    expect(await counts()).toEqual({ invoices: 0, elements: 0, lines: 0 });
    const stored = await pool.query<{ finished_at: Date | null; invoice_id: string | null; page_records: { reason?: string }[] }>(
      `SELECT finished_at, invoice_id, page_records FROM "ProcessingRun" WHERE id = $1`,
      [claimed.id],
    );
    expect(stored.rows[0]?.finished_at).not.toBeNull();
    expect(stored.rows[0]?.invoice_id).toBeNull();
    expect(stored.rows[0]?.page_records[0]?.reason).toBe("process NormalizeError");
    expect(JSON.stringify(stored.rows[0]?.page_records)).not.toContain(secret);

    await clearSaved();
    const skipped = pageExtractionSchema.parse({
      page: 3,
      elements: { bl_number: { text: secret, page: 3 } },
      charge_lines: [],
    });
    const stitchClaim = await seed("save_stitch", hash);
    expect(stitchClaim.attempts).toBe(1);
    const stitchLogs: string[] = [];
    await runOnce({
      claim: async () => stitchClaim,
      download: async () => pdf,
      process: (file, declaredHash) => readFixture(file, declaredHash, [clean, skipped], [textOf(clean), "middle page", "tail page"]),
      finish: (run, result) => finishRun(pool, run, result),
      report: async () => "finished",
      log: (entry) => stitchLogs.push(entry),
    });
    expect(stitchLogs[0]).toBe(`run ${stitchClaim.id} failed process StitchFailure`);
    expect(stitchLogs[1]).toBe(`run ${stitchClaim.id} finished`);
    expect(stitchLogs.join("\n")).not.toContain(secret);
    expect(await claimNext(pool, 3600)).toBeNull();
    expect(await counts()).toEqual({ invoices: 0, elements: 0, lines: 0 });
  });

  it("does not save a second invoice when the run already has one", async () => {
    const claimed = await seed("save_once", hash);
    const result = await readFixture(pdf, hash, pagesFromFixture("clean"));
    await finishRun(pool, claimed, { ...result, permanent: true });
    await pool.query(
      `UPDATE "ChargeLine"
       SET container_page = NULL, from_page = NULL, to_page = NULL,
           days_page = NULL, rate_page = NULL, amount_page = NULL`,
    );
    await pool.query(`UPDATE "Invoice" SET unresolved = NULL`);
    expect(await requeueRun(pool, claimed.id)).toBe(true);
    const again = await claimNext(pool, 3600);
    if (again === null || again.kind !== "extract") throw new Error("missing reclaim");
    const [clean] = pagesFromFixture("clean");
    if (clean === undefined) throw new Error("missing page");
    const changed = pageExtractionSchema.parse({ ...clean, invoice_number: "SYN-CHANGED" });
    const second = await readFixture(pdf, hash, [changed]);
    expect(second.read?.invoiceNumber).toBe("SYN-CHANGED");
    await finishRun(pool, again, { ...second, permanent: true });
    const invoices = await pool.query<{ invoice_number: string; unresolved: unknown }>(
      `SELECT invoice_number, unresolved FROM "Invoice"`,
    );
    expect(invoices.rows).toEqual([{ invoice_number: "SYN-1001", unresolved: [] }]);
    const pages = await pool.query<{ container_page: number | null; amount_page: number | null }>(
      `SELECT container_page, amount_page FROM "ChargeLine"`,
    );
    expect(pages.rows).toEqual([{ container_page: 1, amount_page: 1 }]);
    expect(await counts()).toEqual({ invoices: 1, elements: 20, lines: 1 });
  });

  it("saves nothing when the lease does not match", async () => {
    const claimed = await seed("save_lease", hash);
    const result = await readFixture(pdf, hash, pagesFromFixture("clean"));
    const stolen: ClaimedRun = { ...claimed, leaseToken: "00000000-0000-4000-8000-000000000099" };
    await expect(finishRun(pool, stolen, { ...result, permanent: true })).rejects.toThrow("The run lease was lost.");
    expect(await counts()).toEqual({ invoices: 0, elements: 0, lines: 0 });
    const stored = await pool.query<{ finished_at: Date | null; invoice_id: string | null }>(
      `SELECT finished_at, invoice_id FROM "ProcessingRun" WHERE id = $1`,
      [claimed.id],
    );
    expect(stored.rows[0]).toEqual({ finished_at: null, invoice_id: null });
  });

  it("rolls back the invoice when a later insert fails", async () => {
    const claimed = await seed("save_rollback", hash);
    const result = await readFixture(pdf, hash, pagesFromFixture("clean"));
    const line = result.read?.lines[0];
    if (result.read === undefined || line === undefined) throw new Error("missing read");
    const read: ProcessResult = {
      ...result,
      read: { ...result.read, lines: [line, { ...line }] },
    };
    await expect(finishRun(pool, claimed, { ...read, permanent: true })).rejects.toThrow();
    expect(await counts()).toEqual({ invoices: 0, elements: 0, lines: 0 });
    const stored = await pool.query<{ finished_at: Date | null; invoice_id: string | null }>(
      `SELECT finished_at, invoice_id FROM "ProcessingRun" WHERE id = $1`,
      [claimed.id],
    );
    expect(stored.rows[0]).toEqual({ finished_at: null, invoice_id: null });
  });
});

async function seed(configId: string, hash: string, attempts = 0): Promise<ClaimedExtract> {
  const customer = await pool.query<{ id: string }>(
    `INSERT INTO "Customer" (config_id, display_name) VALUES ($1, 'Sample') RETURNING id`,
    [configId],
  );
  const customerId = requiredId(customer.rows[0]?.id);
  const document = await pool.query<{ id: string }>(
    `INSERT INTO "Document" (customer_id, sha256, byte_size, storage_key)
     VALUES ($1, $2, 10, $3)
     RETURNING id`,
    [customerId, hash, `documents/${customerId}/${hash}.pdf`],
  );
  const documentId = requiredId(document.rows[0]?.id);
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO "ProcessingRun" (customer_id, document_id, kind, attempts) VALUES ($1, $2, 'extract', $3) RETURNING id`,
    [customerId, documentId, attempts],
  );
  const runId = requiredId(inserted.rows[0]?.id);
  const claimed = await claimNext(pool, 3600);
  if (claimed === null || claimed.kind !== "extract" || claimed.id !== runId) throw new Error("missing claim");
  return claimed;
}

function readFixture(
  pdf: Uint8Array,
  hash: string,
  pages: readonly PageExtraction[],
  texts: readonly string[] = pages.map(textOf),
): Promise<ProcessResult> {
  return processDocument({
    pdf,
    declaredHash: hash,
    allow: new Set([hash]),
    readPages: async () => texts,
    extract: async () => pages.map(okPage),
  });
}

function okPage(extraction: PageExtraction): GroundPage {
  return {
    page: extraction.page,
    status: "ok",
    attempts: 1,
    model: "fake",
    promptVersion: "1",
    schemaVersion: "1",
    values: extractionValues(extraction),
    extraction,
  };
}

async function counts(): Promise<{ invoices: number; elements: number; lines: number }> {
  const invoices = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "Invoice"`);
  const elements = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "ElementValue"`);
  const lines = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "ChargeLine"`);
  return { invoices: invoices.rows[0]?.n ?? 0, elements: elements.rows[0]?.n ?? 0, lines: lines.rows[0]?.n ?? 0 };
}

async function clearSaved(): Promise<void> {
  await pool.query(`DELETE FROM "ChargeLine"`);
  await pool.query(`DELETE FROM "ElementValue"`);
  await pool.query(`DELETE FROM "Finding"`);
  await pool.query(`DELETE FROM "ProcessingRun"`);
  await pool.query(`DELETE FROM "Invoice"`);
  await pool.query(`DELETE FROM "Document"`);
  await pool.query(`DELETE FROM "Customer"`);
}

function requiredId(value: string | undefined): string {
  if (value === undefined) throw new Error("missing row");
  return value;
}

function workerDatabaseUrl(): string {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/dd_test");
  if (url.hostname === "neon.tech" || url.hostname.endsWith(".neon.tech")) throw new Error("Tests refuse a Neon host.");
  url.pathname = "/dd_worker_test";
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
