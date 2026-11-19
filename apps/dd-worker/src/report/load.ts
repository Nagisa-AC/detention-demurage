import { customerConfigSchema, savedDecisionSchema, type CustomerConfig } from "dd-core";
import type { ReportFindingSource, SourceInvoice } from "./model.js";
import { ReportJobError } from "./reasons.js";
import { REPORT_SERIES, type RateBand } from "./wording.js";

export type Sql = {
  query<T extends Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
};

export type ReportRequest = {
  rulesRunId: string;
  firmVersion: number;
  actor: string;
};

/** Source PDFs above this are refused. The 8-fixture report is far under it; a larger set is capped so the 768M worker is not killed. */
export const REPORT_PDF_BYTE_CAP = 8 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY = /^\d+\.\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function reportObjectKey(customerId: string, exportId: string, ext: "pdf" | "csv"): string {
  return `reports/${customerId}/${exportId}.${ext}`;
}

export function parseReportRequest(value: unknown): ReportRequest | null {
  if (!isRecord(value)) return null;
  if (typeof value.rules_run_id !== "string" || !UUID.test(value.rules_run_id)) return null;
  if (typeof value.firm_profile_version !== "number" || !Number.isInteger(value.firm_profile_version) || value.firm_profile_version < 1) {
    return null;
  }
  if (typeof value.actor !== "string" || value.actor.trim() === "" || value.actor.length > 200) return null;
  return { rulesRunId: value.rules_run_id, firmVersion: value.firm_profile_version, actor: value.actor };
}

export type PreparedReport = {
  request: ReportRequest;
  customerName: string;
  runId: string;
  finishedAt: Date;
  settingsVersion: number;
  firmId: string;
  firmVersion: number;
  pdfBytes: number;
  build: {
    firmName: string;
    cityState: string;
    replyTo: string;
    signerName: string;
    signerTitle: string;
    customerName: string;
    runId: string;
    finishedAt: string;
    feeLabel: string;
    rates: { partyId: string; bands: RateBand[] }[];
    day0: Convention;
    day1: Convention;
    invoices: SourceInvoice[];
  };
};

type Convention = {
  total: { currency: string; amount: string }[];
  invoices: { number: string; disputable: string; currency: string; doNotPursue: boolean; supersededBy: string }[];
  findings: ReportFindingSource[];
};

type Summary = {
  settingsVersion: number;
  invoice_ids: string[];
  total: { day0: { currency: string; amount: string }[]; day1: { currency: string; amount: string }[] };
  invoices: { day0: AmountRow[]; day1: AmountRow[] };
};

type AmountRow = { invoice_id: string; disputable: string; do_not_pursue: boolean; superseded_by: string };

type LoadedInvoice = {
  id: string;
  number: string;
  carrier: string;
  container: string;
  billed: string;
  currency: string;
  invoiceDate: string | null;
  partyId: string | null;
  storageKey: string | null;
  lines: SourceInvoice["lines"];
  pdf: Uint8Array | null;
};

export async function prepareReport(
  sql: Sql,
  customerId: string,
  request: ReportRequest,
  download: (key: string) => Promise<Uint8Array>,
  maxPdfBytes: number = REPORT_PDF_BYTE_CAP,
): Promise<PreparedReport> {
  const customer = await sql.query<{ display_name: string }>(`SELECT display_name FROM "Customer" WHERE id = $1::uuid`, [customerId]);
  const customerName = customer.rows[0]?.display_name;
  if (customerName === undefined) throw new ReportJobError("build");
  const run = await rulesRun(sql, customerId, request.rulesRunId);
  const firm = await firmAt(sql, request.firmVersion);
  const settings = await configAt(sql, customerId, run.settingsVersion);
  const invoices = await loadInvoices(sql, customerId);
  const findings = await loadFindings(sql, run.id, invoices);
  let pdfBytes = 0;
  for (const invoice of invoices) {
    const key = invoice.storageKey;
    if (key === null || !key.startsWith("documents/")) continue;
    const pdf = await download(key);
    pdfBytes += pdf.byteLength;
    if (pdfBytes > maxPdfBytes) throw new ReportJobError("large");
    invoice.pdf = pdf;
  }
  const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const sources = run.invoice_ids.flatMap((id) => {
    const invoice = byId.get(id);
    return invoice === undefined ? [] : [toSource(invoice)];
  });
  return {
    request,
    customerName,
    runId: run.id,
    finishedAt: run.finishedAt,
    settingsVersion: settings.version,
    firmId: firm.id,
    firmVersion: firm.version,
    pdfBytes,
    build: {
      firmName: firm.firmName,
      cityState: firm.cityState,
      replyTo: firm.replyTo,
      signerName: firm.signerName,
      signerTitle: firm.signerTitle,
      customerName,
      runId: run.id,
      finishedAt: run.finishedAt.toISOString(),
      feeLabel: feePercent(settings.config.fee_pct),
      rates: ratesOf(settings.config),
      day0: conventionOf(run, "day0", findings, byId),
      day1: conventionOf(run, "day1", findings, byId),
      invoices: sources,
    },
  };
}

export async function nextSequence(sql: Sql, year: number): Promise<number> {
  const result = await sql.query<{ sequence: number }>(
    `SELECT COALESCE(MAX(sequence), 0)::int AS sequence FROM "ReportExport" WHERE series = $1 AND year = $2::int`,
    [REPORT_SERIES, year],
  );
  return (result.rows[0]?.sequence ?? 0) + 1;
}

async function rulesRun(sql: Sql, customerId: string, runId: string): Promise<Summary & { id: string; finishedAt: Date }> {
  const result = await sql.query<{ id: string; finished_at: Date | null; page_records: unknown }>(
    `SELECT id, finished_at, page_records
     FROM "ProcessingRun"
     WHERE id = $1::uuid AND customer_id = $2::uuid AND kind = 'rules'`,
    [runId, customerId],
  );
  const row = result.rows[0];
  if (row === undefined || row.finished_at === null) throw new ReportJobError("build");
  const summary = parseSummary(row.page_records);
  if (summary === null) throw new ReportJobError("build");
  return { ...summary, id: row.id, finishedAt: row.finished_at };
}

async function firmAt(sql: Sql, version: number): Promise<{
  id: string;
  version: number;
  firmName: string;
  cityState: string;
  replyTo: string;
  signerName: string;
  signerTitle: string;
}> {
  const result = await sql.query<{
    id: string;
    version: number;
    firm_name: string;
    city_state: string;
    reply_to: string;
    signer_name: string;
    signer_title: string;
  }>(
    `SELECT id, version, firm_name, city_state, reply_to, signer_name, signer_title
     FROM "FirmProfileVersion" WHERE version = $1::int`,
    [version],
  );
  const row = result.rows[0];
  if (row === undefined) throw new ReportJobError("build");
  return {
    id: row.id,
    version: row.version,
    firmName: row.firm_name,
    cityState: row.city_state,
    replyTo: row.reply_to,
    signerName: row.signer_name,
    signerTitle: row.signer_title,
  };
}

async function configAt(sql: Sql, customerId: string, version: number): Promise<{ version: number; config: CustomerConfig }> {
  const result = await sql.query<{ version: number; config: unknown }>(
    `SELECT version, config FROM "CustomerConfigVersion" WHERE customer_id = $1::uuid AND version = $2::int`,
    [customerId, version],
  );
  const row = result.rows[0];
  if (row === undefined) throw new ReportJobError("build");
  const parsed = customerConfigSchema.safeParse(row.config);
  if (!parsed.success) throw new ReportJobError("build");
  return { version: row.version, config: parsed.data };
}

async function loadInvoices(sql: Sql, customerId: string): Promise<LoadedInvoice[]> {
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
    const saved = payloads.flatMap((payload) => {
      const parsed = savedDecisionSchema.safeParse(payload);
      if (!parsed.success || parsed.data.document_hash !== header.sha256) return [];
      return [parsed.data];
    });
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

async function loadFindings(sql: Sql, runId: string, invoices: readonly LoadedInvoice[]): Promise<(ReportFindingSource & { convention: string | null })[]> {
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

function conventionOf(
  summary: Summary,
  convention: "day0" | "day1",
  findings: readonly (ReportFindingSource & { convention: string | null })[],
  invoices: ReadonlyMap<string, LoadedInvoice>,
): Convention {
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

function feePercent(fee: string): string {
  if (/^1(?:\.0+)?$/.test(fee)) return "100%";
  const fraction = fee.split(".")[1] ?? "";
  const padded = `${fraction}00`;
  const head = padded.slice(0, 2);
  const tail = padded.slice(2).replace(/0+$/, "");
  const whole = head.replace(/^0+/, "") || "0";
  return tail === "" ? `${whole}%` : `${whole}.${tail}%`;
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
