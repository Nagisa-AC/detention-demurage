import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { customerConfigSchema, type CustomerConfig } from "dd-core";
import { readLatestFirm, type FirmProfile } from "../firm";
import { uploadConfig, webS3 } from "../intake/aws";
import { isUuid } from "../intake/limits";
import { withReviewDb, type ReviewSql } from "../review-data";
import { readDecisions } from "../review-view";
import { exportRefusal, type ExportGate } from "./gate";

export type ReportStore = {
  get(key: string): Promise<Uint8Array | null>;
};

export type EnqueueResult = { ok: true } | { ok: false; reason: string };

export type ExportPhase = "blocked" | "ready" | "generating" | "failed";

export type ExportView = {
  phase: ExportPhase;
  reason: string | null;
  latest: { id: string; number: string } | null;
};

const FAILURES = new Set([
  "The report could not be built.",
  "The report could not be stored.",
  "This report is too large to build at once.",
]);

export function reportObjectKey(customerId: string, exportId: string, ext: "pdf" | "csv"): string {
  return `reports/${customerId}/${exportId}.${ext}`;
}

export function isReportObjectKey(customerId: string, key: string): boolean {
  const prefix = `reports/${customerId}/`;
  return key.startsWith(prefix) && !key.includes("..") && key.length > prefix.length;
}

export function knownFailure(reason: unknown): string {
  return typeof reason === "string" && FAILURES.has(reason) ? reason : "The report could not be built.";
}

export function s3ReportStore(): ReportStore | null {
  const config = uploadConfig();
  if (config === null) return null;
  return objectStore(webS3(), config.bucket);
}

export function objectStore(client: S3Client, bucket: string): ReportStore {
  return {
    async get(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (out.Body === undefined || out.Body === null || typeof out.Body.transformToByteArray !== "function") return null;
        return out.Body.transformToByteArray();
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
  };
}

export async function exportStatus(customerId: string): Promise<ExportView> {
  const view = await withReviewDb((sql) => readExportView(sql, customerId));
  return view ?? { phase: "blocked", reason: "The database is not configured.", latest: null };
}

export async function readExportView(sql: ReviewSql, customerId: string): Promise<ExportView> {
  const customer = await sql.query<{ display_name: string }>(`SELECT display_name FROM "Customer" WHERE id = $1::uuid`, [customerId]);
  const latest = await latestExport(sql, customerId);
  if (customer.rows[0] === undefined) return { phase: "blocked", reason: "This customer was not found.", latest };
  const job = await latestReportJob(sql, customerId);
  if (job !== null && job.finishedAt === null) return { phase: "generating", reason: null, latest };
  const loaded = await loadGate(sql, customerId);
  if (loaded.kind === "missing") return { phase: "blocked", reason: "This customer was not found.", latest };
  const reason = exportRefusal(loaded.gate);
  if (reason !== null) return { phase: "blocked", reason, latest };
  if (job?.failed === true) return { phase: "failed", reason: job.reason, latest };
  return { phase: "ready", reason: null, latest };
}

export async function enqueueReport(sql: ReviewSql, input: { customerId: string; actor: string }): Promise<EnqueueResult> {
  if (!isUuid(input.customerId)) return { ok: false, reason: "This customer was not found." };
  if (input.actor.trim() === "" || input.actor.length > 200) return { ok: false, reason: "The report could not be built." };
  await sql.query("BEGIN");
  try {
    const customer = await sql.query<{ display_name: string }>(
      `SELECT display_name FROM "Customer" WHERE id = $1::uuid FOR UPDATE`,
      [input.customerId],
    );
    if (customer.rows[0] === undefined) {
      await sql.query("ROLLBACK");
      return { ok: false, reason: "This customer was not found." };
    }
    const loaded = await loadGate(sql, input.customerId);
    if (loaded.kind === "missing") {
      await sql.query("ROLLBACK");
      return { ok: false, reason: "This customer was not found." };
    }
    if (loaded.kind === "blocked") {
      await sql.query("ROLLBACK");
      return { ok: false, reason: exportRefusal(loaded.gate) ?? "The report could not be built." };
    }
    const open = await sql.query<{ id: string }>(
      `SELECT id FROM "ProcessingRun"
       WHERE customer_id = $1::uuid AND kind = 'report' AND finished_at IS NULL
       LIMIT 1`,
      [input.customerId],
    );
    if (open.rows[0] !== undefined) {
      await sql.query("COMMIT");
      return { ok: true };
    }
    await sql.query(
      `INSERT INTO "ProcessingRun" (customer_id, kind, page_records)
       VALUES ($1::uuid, 'report', $2::jsonb)`,
      [
        input.customerId,
        JSON.stringify({
          rules_run_id: loaded.runId,
          firm_profile_version: loaded.firmVersion,
          actor: input.actor,
        }),
      ],
    );
    await sql.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  }
}

export async function openReport(sql: ReviewSql, store: ReportStore, customerId: string, exportId: string, ext: "pdf" | "csv"): Promise<{ bytes: Uint8Array; filename: string; contentType: string } | null> {
  if (!isUuid(customerId) || !isUuid(exportId)) return null;
  const result = await sql.query<{ report_number: string; pdf_key: string; csv_key: string }>(
    `SELECT report_number, pdf_key, csv_key FROM "ReportExport" WHERE id = $1::uuid AND customer_id = $2::uuid`,
    [exportId, customerId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  const key = ext === "pdf" ? row.pdf_key : row.csv_key;
  const expected = reportObjectKey(customerId, exportId, ext);
  if (key !== expected || !isReportObjectKey(customerId, key)) return null;
  const bytes = await store.get(key);
  if (bytes === null) return null;
  return {
    bytes,
    filename: `${row.report_number}.${ext}`,
    contentType: ext === "pdf" ? "application/pdf" : "text/csv; charset=utf-8",
  };
}

type Loaded =
  | { kind: "missing" }
  | { kind: "blocked"; gate: ExportGate }
  | { kind: "ready"; gate: ExportGate; runId: string; firmVersion: number };

async function loadGate(sql: ReviewSql, customerId: string): Promise<Loaded> {
  const customer = await sql.query<{ display_name: string }>(`SELECT display_name FROM "Customer" WHERE id = $1::uuid`, [customerId]);
  if (customer.rows[0] === undefined) return { kind: "missing" };
  const firm = await readLatestFirm(sql);
  const settings = await currentConfig(sql, customerId);
  const run = await latestRulesRun(sql, customerId);
  const invoices = await loadInvoices(sql, customerId);
  const pending = await pendingDocuments(sql, customerId);
  const approved = invoices.filter((invoice) => invoice.approved);
  const gate = gateOf({ firm, settings, run, invoices, pending, approvedIds: approved.map((invoice) => invoice.id) });
  if (exportRefusal(gate) !== null || firm === null || settings === null || run === null || run.summary === null) {
    return { kind: "blocked", gate };
  }
  return { kind: "ready", gate, runId: run.id, firmVersion: firm.version };
}

function gateOf(input: {
  firm: FirmProfile | null;
  settings: { version: number } | null;
  run: RulesRun | null;
  invoices: readonly { id: string; approved: boolean }[];
  pending: number;
  approvedIds: readonly string[];
}): ExportGate {
  const recorded = input.run?.summary !== null && input.run?.summary !== undefined;
  const runIds = input.run?.summary?.invoice_ids ?? [];
  const checksCurrent = sameIds(runIds, input.approvedIds);
  return {
    firmReady: input.firm !== null,
    hasSettings: input.settings !== null,
    checks: input.run === null ? "missing" : input.run.state,
    recorded: input.run?.state === "ok" && recorded,
    checksCurrent: input.run?.state === "ok" && recorded && checksCurrent,
    invoiceCount: input.invoices.length,
    unapproved: input.invoices.filter((invoice) => !invoice.approved).length,
    pendingDocuments: input.pending,
  };
}

async function latestExport(sql: ReviewSql, customerId: string): Promise<{ id: string; number: string } | null> {
  const result = await sql.query<{ id: string; report_number: string }>(
    `SELECT id, report_number FROM "ReportExport" WHERE customer_id = $1::uuid ORDER BY created_at DESC, sequence DESC LIMIT 1`,
    [customerId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return { id: row.id, number: row.report_number };
}

type ReportJob = { finishedAt: Date | null; failed: boolean; reason: string };

async function latestReportJob(sql: ReviewSql, customerId: string): Promise<ReportJob | null> {
  const result = await sql.query<{ finished_at: Date | null; page_records: unknown }>(
    `SELECT finished_at, page_records
     FROM "ProcessingRun"
     WHERE customer_id = $1::uuid AND kind = 'report'
     ORDER BY started_at DESC, id DESC
     LIMIT 1`,
    [customerId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  const failed = isRecord(row.page_records) && row.page_records.failed === true;
  return {
    finishedAt: row.finished_at,
    failed,
    reason: knownFailure(isRecord(row.page_records) ? row.page_records.reason : null),
  };
}

type RulesRun = {
  id: string;
  finishedAt: Date;
  state: "running" | "failed" | "ok";
  summary: Summary | null;
};

type Summary = {
  settingsVersion: number;
  invoice_ids: string[];
  total: { day0: { currency: string; amount: string }[]; day1: { currency: string; amount: string }[] };
  invoices: { day0: AmountRow[]; day1: AmountRow[] };
};

type AmountRow = { invoice_id: string; disputable: string; do_not_pursue: boolean; superseded_by: string };

async function latestRulesRun(sql: ReviewSql, customerId: string): Promise<RulesRun | null> {
  const result = await sql.query<{ id: string; finished_at: Date | null; page_records: unknown }>(
    `SELECT id, finished_at, page_records
     FROM "ProcessingRun"
     WHERE customer_id = $1::uuid AND kind = 'rules'
     ORDER BY started_at DESC, id DESC
     LIMIT 1`,
    [customerId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  if (row.finished_at === null) return { id: row.id, finishedAt: new Date(0), state: "running", summary: null };
  if (isRecord(row.page_records) && row.page_records.failed === true) {
    return { id: row.id, finishedAt: row.finished_at, state: "failed", summary: null };
  }
  return { id: row.id, finishedAt: row.finished_at, state: "ok", summary: parseSummary(row.page_records) };
}

async function currentConfig(sql: ReviewSql, customerId: string): Promise<{ version: number; config: CustomerConfig } | null> {
  const result = await sql.query<{ version: number; config: unknown }>(
    `SELECT version, config FROM "CustomerConfigVersion" WHERE customer_id = $1::uuid ORDER BY version DESC LIMIT 1`,
    [customerId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  const parsed = customerConfigSchema.safeParse(row.config);
  if (!parsed.success) return null;
  return { version: row.version, config: parsed.data };
}

async function loadInvoices(sql: ReviewSql, customerId: string): Promise<{ id: string; approved: boolean }[]> {
  const headers = await sql.query<{ id: string; sha256: string }>(
    `SELECT i.id, d.sha256
     FROM "Invoice" i
     JOIN "Document" d ON d.id = i.document_id
     WHERE i.customer_id = $1::uuid
     ORDER BY i.invoice_number, i.id`,
    [customerId],
  );
  const events = await sql.query<{ payload: unknown }>(
    `SELECT payload FROM "AuditEvent" WHERE customer_id = $1::uuid AND action = 'review_decision' ORDER BY at, id`,
    [customerId],
  );
  const payloads = events.rows.map((event) => event.payload);
  return headers.rows.map((header) => ({
    id: header.id,
    approved: readDecisions(payloads, header.sha256).some((decision) => decision.outcome === "approved"),
  }));
}

async function pendingDocuments(sql: ReviewSql, customerId: string): Promise<number> {
  const result = await sql.query<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM "Document" d
     WHERE d.customer_id = $1::uuid
       AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i.document_id = d.id)`,
    [customerId],
  );
  return result.rows[0]?.n ?? 0;
}

function parseSummary(value: unknown): Summary | null {
  if (!isRecord(value) || value.failed !== false) return null;
  if (typeof value.settings_version !== "number" || !Array.isArray(value.invoice_ids)) return null;
  if (!value.invoice_ids.every((id) => typeof id === "string")) return null;
  if (!isRecord(value.total_disputable) || !isRecord(value.invoices)) return null;
  const day0 = parseTotals(value.total_disputable.day0);
  const day1 = parseTotals(value.total_disputable.day1);
  const invoices0 = parseAmounts(value.invoices.day0);
  const invoices1 = parseAmounts(value.invoices.day1);
  if (day0 === null || day1 === null || invoices0 === null || invoices1 === null) return null;
  return {
    settingsVersion: value.settings_version,
    invoice_ids: value.invoice_ids,
    total: { day0, day1 },
    invoices: { day0: invoices0, day1: invoices1 },
  };
}

function parseTotals(value: unknown): { currency: string; amount: string }[] | null {
  if (!Array.isArray(value)) return null;
  const totals: { currency: string; amount: string }[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.currency !== "string" || typeof item.amount !== "string") return null;
    totals.push({ currency: item.currency, amount: item.amount });
  }
  return totals;
}

function parseAmounts(value: unknown): AmountRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: AmountRow[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.invoice_id !== "string" || typeof item.disputable !== "string") return null;
    if (typeof item.do_not_pursue !== "boolean" || typeof item.superseded_by !== "string") return null;
    rows.push({
      invoice_id: item.invoice_id,
      disputable: item.disputable,
      do_not_pursue: item.do_not_pursue,
      superseded_by: item.superseded_by,
    });
  }
  return rows;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return record.name === "NotFound" || record.name === "NoSuchKey" || record.$metadata?.httpStatusCode === 404;
}
