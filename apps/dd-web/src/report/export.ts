import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { customerConfigSchema, type CustomerConfig } from "dd-core";
import { readLatestFirm, type FirmProfile } from "../firm";
import { uploadConfig, webS3 } from "../intake/aws";
import { isUuid } from "../intake/limits";
import { withReviewDb, type ReviewSql } from "../review-data";
import { readDecisions } from "../review-view";
import { feePercent } from "../settings";
import { renderReport, sha256 } from "./assemble";
import { exportRefusal, type ExportGate } from "./gate";
import { buildReport, issuedYear, reportNumber, type ConventionSource, type ReportFindingSource, type SourceInvoice } from "./model";
import { REPORT_SERIES, type RateBand } from "./wording";

export type ReportStore = {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
};

export type ExportResult = { ok: true; id: string; number: string } | { ok: false; reason: string };

export type ExportView = {
  reason: string | null;
  latest: { id: string; number: string } | null;
};

const MONEY = /^\d+\.\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function reportObjectKey(customerId: string, exportId: string, ext: "pdf" | "csv"): string {
  return `reports/${customerId}/${exportId}.${ext}`;
}

export function isReportObjectKey(customerId: string, key: string): boolean {
  const prefix = `reports/${customerId}/`;
  return key.startsWith(prefix) && !key.includes("..") && key.length > prefix.length;
}

export function s3ReportStore(): ReportStore | null {
  const config = uploadConfig();
  if (config === null) return null;
  return objectStore(webS3(), config.bucket);
}

export function objectStore(client: S3Client, bucket: string): ReportStore {
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
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
  return view ?? { reason: "The database is not configured.", latest: null };
}

export async function readExportView(sql: ReviewSql, customerId: string): Promise<ExportView> {
  const loaded = await loadExport(sql, customerId, null);
  const latest = await latestExport(sql, customerId);
  if (loaded.kind !== "ready" && loaded.kind !== "blocked") return { reason: "This customer was not found.", latest };
  return { reason: exportRefusal(loaded.gate), latest };
}

export async function createReportExport(sql: ReviewSql, store: ReportStore, input: { customerId: string; actor: string }): Promise<ExportResult> {
  if (!isUuid(input.customerId)) return { ok: false, reason: "This customer was not found." };
  await sql.query("BEGIN");
  try {
    await sql.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`dd-report-${REPORT_SERIES}`]);
    const loaded = await loadExport(sql, input.customerId, store);
    if (loaded.kind === "missing") {
      await sql.query("ROLLBACK");
      return { ok: false, reason: "This customer was not found." };
    }
    const reason = exportRefusal(loaded.gate);
    if (reason !== null || loaded.kind !== "ready") {
      await sql.query("ROLLBACK");
      return { ok: false, reason: reason ?? "The report could not be built." };
    }
    const year = issuedYear(loaded.finishedAt);
    const sequence = await nextSequence(sql, year);
    const number = reportNumber(year, sequence);
    const model = buildReport({ ...loaded.build, reportNumber: number });
    const pdf = await renderReport(model);
    const csv = new TextEncoder().encode(model.csv);
    const pdfSha = sha256(pdf);
    const csvSha = sha256(csv);
    const id = randomUUID();
    const pdfKey = reportObjectKey(input.customerId, id, "pdf");
    const csvKey = reportObjectKey(input.customerId, id, "csv");
    await store.put(pdfKey, pdf, "application/pdf");
    await store.put(csvKey, csv, "text/csv; charset=utf-8");
    await sql.query(
      `INSERT INTO "ReportExport" (
         id, customer_id, processing_run_id, firm_profile_id, report_number, series, year, sequence,
         settings_version, firm_version, convention, pdf_sha256, csv_sha256, pdf_key, csv_key, created_by
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::int, $8::int,
         $9::int, $10::int, $11, $12, $13, $14, $15, $16
       )`,
      [
        id,
        input.customerId,
        loaded.runId,
        loaded.firm.id,
        number,
        REPORT_SERIES,
        year,
        sequence,
        loaded.settingsVersion,
        loaded.firm.version,
        model.convention,
        pdfSha,
        csvSha,
        pdfKey,
        csvKey,
        input.actor,
      ],
    );
    await sql.query(
      `INSERT INTO "AuditEvent" (customer_id, actor, action, payload)
       VALUES ($1::uuid, $2, 'report_exported', $3::jsonb)`,
      [
        input.customerId,
        input.actor,
        JSON.stringify({
          run_id: loaded.runId,
          settings_version: loaded.settingsVersion,
          firm_profile_version: loaded.firm.version,
          convention: model.convention,
          pdf_sha256: pdfSha,
          csv_sha256: csvSha,
          report_number: number,
        }),
      ],
    );
    await sql.query("COMMIT");
    return { ok: true, id, number };
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
  | {
      kind: "ready";
      gate: ExportGate;
      runId: string;
      finishedAt: Date;
      settingsVersion: number;
      firm: FirmProfile;
      build: Omit<Parameters<typeof buildReport>[0], "reportNumber">;
    };

async function loadExport(sql: ReviewSql, customerId: string, store: ReportStore | null): Promise<Loaded> {
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
  const findings = await loadFindings(sql, run.id, invoices);
  const withPdfs = store === null ? invoices : await attachPdfs(store, invoices);
  const byId = new Map(withPdfs.map((invoice) => [invoice.id, invoice]));
  const sources = run.summary.invoice_ids.flatMap((id) => {
    const invoice = byId.get(id);
    return invoice === undefined ? [] : [toSource(invoice)];
  });
  return {
    kind: "ready",
    gate,
    runId: run.id,
    finishedAt: run.finishedAt,
    settingsVersion: settings.version,
    firm,
    build: {
      firmName: firm.firmName,
      cityState: firm.cityState,
      replyTo: firm.replyTo,
      signerName: firm.signerName,
      signerTitle: firm.signerTitle,
      customerName: customer.rows[0].display_name,
      runId: run.id,
      finishedAt: run.finishedAt.toISOString(),
      feeLabel: feePercent(settings.config.fee_pct),
      rates: ratesOf(settings.config),
      day0: conventionOf(run.summary, "day0", findings, byId),
      day1: conventionOf(run.summary, "day1", findings, byId),
      invoices: sources,
    },
  };
}

function gateOf(input: {
  firm: FirmProfile | null;
  settings: { version: number } | null;
  run: RulesRun | null;
  invoices: readonly LoadedInvoice[];
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

async function nextSequence(sql: ReviewSql, year: number): Promise<number> {
  const result = await sql.query<{ sequence: number }>(
    `SELECT COALESCE(MAX(sequence), 0)::int AS sequence FROM "ReportExport" WHERE series = $1 AND year = $2::int`,
    [REPORT_SERIES, year],
  );
  return (result.rows[0]?.sequence ?? 0) + 1;
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

type LoadedInvoice = {
  id: string;
  number: string;
  carrier: string;
  container: string;
  billed: string;
  currency: string;
  invoiceDate: string | null;
  partyId: string | null;
  approved: boolean;
  storageKey: string | null;
  lines: SourceInvoice["lines"];
  pdf: Uint8Array | null;
};

async function loadInvoices(sql: ReviewSql, customerId: string): Promise<LoadedInvoice[]> {
  const headers = await sql.query<{
    id: string;
    invoice_number: string;
    billing_party: string;
    currency: string;
    sha256: string;
    invoice_date: string | null;
    storage_key: string | null;
  }>(
    `SELECT i.id, i.invoice_number, i.billing_party, i.currency, d.sha256, i.invoice_date::text AS invoice_date, d.storage_key
     FROM "Invoice" i
     JOIN "Document" d ON d.id = i.document_id
     WHERE i.customer_id = $1::uuid
     ORDER BY i.invoice_number, i.id`,
    [customerId],
  );
  const elements = await sql.query<{ invoice_id: string; element_key: string; text: string | null; value: string | null }>(
    `SELECT invoice_id, element_key, text, value FROM "ElementValue" WHERE customer_id = $1::uuid`,
    [customerId],
  );
  const lines = await sql.query<{
    invoice_id: string;
    line_id: string;
    container: string;
    charged_from: string;
    charged_to: string;
    days: number;
    rate: string;
    amount: string;
  }>(
    `SELECT invoice_id, line_id, container, charged_from::text AS charged_from, charged_to::text AS charged_to,
            days, rate::text AS rate, amount::text AS amount
     FROM "ChargeLine" WHERE customer_id = $1::uuid
     ORDER BY invoice_id, line_id`,
    [customerId],
  );
  const events = await sql.query<{ payload: unknown }>(
    `SELECT payload FROM "AuditEvent" WHERE customer_id = $1::uuid AND action = 'review_decision' ORDER BY at, id`,
    [customerId],
  );
  const payloads = events.rows.map((event) => event.payload);
  const elementsByInvoice = group(elements.rows, (row) => row.invoice_id);
  const linesByInvoice = group(lines.rows, (row) => row.invoice_id);
  return headers.rows.map((header) => {
    const saved = readDecisions(payloads, header.sha256);
    const approved = saved.some((decision) => decision.outcome === "approved");
    let partyId: string | null = null;
    for (const decision of saved) {
      if (decision.outcome === "approved" && decision.party_id !== undefined) partyId = decision.party_id;
    }
    const stored = elementsByInvoice.get(header.id) ?? [];
    const chargeLines = linesByInvoice.get(header.id) ?? [];
    const container = chargeLines[0]?.container ?? textOf(stored, "container_number") ?? "";
    return {
      id: header.id,
      number: header.invoice_number,
      carrier: header.billing_party,
      container,
      billed: moneyOf(stored, "total_due") ?? "0.00",
      currency: header.currency,
      invoiceDate: isoOf(textOf(stored, "invoice_date")) ?? isoOf(header.invoice_date),
      partyId,
      approved,
      storageKey: header.storage_key,
      pdf: null,
      lines: chargeLines.map((line) => ({
        id: line.line_id,
        container: line.container,
        chargedFrom: line.charged_from.slice(0, 10),
        chargedTo: line.charged_to.slice(0, 10),
        days: line.days,
        rate: twoDecimals(line.rate),
        amount: twoDecimals(line.amount),
      })),
    };
  });
}

async function loadFindings(sql: ReviewSql, runId: string, invoices: readonly LoadedInvoice[]): Promise<(ReportFindingSource & { convention: string | null })[]> {
  const byId = new Map(invoices.map((invoice) => [invoice.id, invoice.number]));
  const result = await sql.query<{
    invoice_id: string;
    rule: string;
    citations: unknown;
    line_ids: unknown;
    expected: string;
    actual: string;
    amount: string;
    explain: string;
    convention: string | null;
    evidence: unknown;
  }>(
    `SELECT invoice_id, rule, citations, line_ids, expected, actual, disputable_amount::text AS amount, explain, convention, evidence
     FROM "Finding"
     WHERE processing_run_id = $1::uuid
     ORDER BY invoice_id, rule, id`,
    [runId],
  );
  return result.rows.flatMap((row) => {
    const invoiceNumber = byId.get(row.invoice_id);
    if (invoiceNumber === undefined) return [];
    return [{
      invoiceNumber,
      rule: row.rule,
      citations: stringList(row.citations),
      lineIds: stringList(row.line_ids),
      expected: row.expected,
      actual: row.actual,
      amount: twoDecimals(row.amount),
      explain: row.explain,
      evidence: evidenceList(row.evidence),
      convention: row.convention,
    }];
  });
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

async function attachPdfs(store: ReportStore, invoices: readonly LoadedInvoice[]): Promise<LoadedInvoice[]> {
  const next: LoadedInvoice[] = [];
  for (const invoice of invoices) {
    if (invoice.storageKey === null || !invoice.storageKey.startsWith("documents/")) {
      next.push(invoice);
      continue;
    }
    const pdf = await store.get(invoice.storageKey);
    next.push({ ...invoice, pdf });
  }
  return next;
}

function toSource(invoice: LoadedInvoice): SourceInvoice {
  return {
    number: invoice.number,
    carrier: invoice.carrier,
    container: invoice.container,
    billed: invoice.billed,
    currency: invoice.currency,
    invoiceDate: invoice.invoiceDate,
    partyId: invoice.partyId,
    lines: invoice.lines,
    pdf: invoice.pdf,
  };
}

function conventionOf(summary: Summary, convention: "day0" | "day1", findings: readonly (ReportFindingSource & { convention: string | null })[], invoices: ReadonlyMap<string, LoadedInvoice>): ConventionSource {
  return {
    total: summary.total[convention],
    invoices: summary.invoices[convention].flatMap((row) => {
      const invoice = invoices.get(row.invoice_id);
      if (invoice === undefined) return [];
      return [{
        number: invoice.number,
        disputable: row.disputable,
        currency: invoice.currency,
        doNotPursue: row.do_not_pursue,
        supersededBy: row.superseded_by,
      }];
    }),
    findings: findings.flatMap((finding) => {
      const { convention: chosen, ...rest } = finding;
      return chosen === convention ? [rest] : [];
    }),
  };
}

function ratesOf(config: CustomerConfig): { partyId: string; bands: RateBand[] }[] {
  return (config.contract_terms ?? []).map((term) => ({
    partyId: term.billing_party,
    bands: term.rates
      .filter((rate) => rate.charge === "demurrage")
      .map((rate) => {
        const band: RateBand = { fromDay: rate.from_day, perDay: rate.per_day };
        if (rate.to_day !== undefined) band.toDay = rate.to_day;
        return band;
      }),
  }));
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

function group<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const list = map.get(id) ?? [];
    list.push(row);
    map.set(id, list);
  }
  return map;
}

function textOf(rows: readonly { element_key: string; text: string | null; value: string | null }[], key: string): string | null {
  const row = rows.find((item) => item.element_key === key);
  if (row === undefined) return null;
  return row.value ?? row.text;
}

function moneyOf(rows: readonly { element_key: string; text: string | null; value: string | null }[], key: string): string | null {
  const row = rows.find((item) => item.element_key === key);
  if (row === undefined) return null;
  if (row.value !== null && MONEY.test(row.value)) return row.value;
  const match = row.text?.match(/(\d+\.\d{2})/);
  return match?.[1] ?? null;
}

function isoOf(value: string | null): string | null {
  if (value === null) return null;
  return ISO.test(value) ? value : null;
}

function twoDecimals(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (match?.[2] === undefined) return value;
  const frac = (match[3] ?? "00").slice(0, 2).padEnd(2, "0");
  return `${match[1] ?? ""}${match[2]}.${frac}`;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function evidenceList(value: unknown): { page: number | null; field: string }[] {
  if (!Array.isArray(value)) return [];
  const items: { page: number | null; field: string }[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.field !== "string") continue;
    const page = typeof item.page === "number" && Number.isInteger(item.page) && item.page > 0 ? item.page : null;
    items.push({ page, field: item.field });
  }
  return items;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return record.name === "NotFound" || record.name === "NoSuchKey" || record.$metadata?.httpStatusCode === 404;
}
