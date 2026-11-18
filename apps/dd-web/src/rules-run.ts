import { Client } from "pg";
import {
  ReviewError,
  customerConfigSchema,
  runRules,
  type CustomerConfig,
  type ReportFinding,
  type RunReport,
} from "dd-core";
import { shownPartyId } from "./billing-party";
import type { ReviewSql } from "./review-data";
import { buildRunInvoice, RulesInputError, type StoredChargeLine, type StoredRulesInvoice } from "./rules-input";
import { readDecisions, type StoredElement } from "./review-view";

export type RulesInvoiceAmount = {
  invoice_id: string;
  disputable: string;
  do_not_pursue: boolean;
  superseded_by: string;
};

export type RulesSummary = {
  failed: false;
  settings_version: number;
  invoice_ids: string[];
  not_evaluable: { day0: RunReport["not_evaluable"]; day1: RunReport["not_evaluable"] };
  needs_info: { day0: RunReport["needs_info"]; day1: RunReport["needs_info"] };
  total_disputable: { day0: RunReport["total_disputable"]; day1: RunReport["total_disputable"] };
  invoices: { day0: RulesInvoiceAmount[]; day1: RulesInvoiceAmount[] };
};

export type RulesFailure = {
  failed: true;
  message: string;
};

export type LatestChecks =
  | { status: "failed"; message: string }
  | {
      status: "ok";
      ranAt: string;
      day0Findings: number;
      day1Findings: number;
      day0: string;
      day1: string;
    };

type Prepared = {
  summary: RulesSummary;
  findings: { invoiceId: string; finding: ReportFinding; convention: "day0" | "day1" }[];
};

const NO_PARTY = "Choose a billing party before the checks can run.";
const NO_SETTINGS = "This customer has no settings.";
const NO_INVOICES = "No approved invoices.";
const SHARED_NUMBER = "Two approved invoices share a number.";

/** After an approval commits, check every approved invoice for that customer. A failure is its own finished run. */
export async function runChecksForInvoice(sql: ReviewSql, invoiceId: string): Promise<void> {
  const found = await sql.query<{ customer_id: string }>(`SELECT customer_id FROM "Invoice" WHERE id = $1`, [invoiceId]);
  const customerId = found.rows[0]?.customer_id;
  if (customerId === undefined) return;
  await runCustomerChecks(sql, customerId);
}

export async function runCustomerChecks(sql: ReviewSql, customerId: string): Promise<void> {
  try {
    const prepared = await prepareChecks(sql, customerId);
    await writeSuccess(sql, customerId, prepared);
  } catch (error) {
    await writeFailure(sql, customerId, messageOf(error));
  }
}

export async function readLatestChecks(): Promise<Map<string, LatestChecks>> {
  const url = process.env.DATABASE_URL;
  const checks = new Map<string, LatestChecks>();
  if (url === undefined || url === "") return checks;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query<{
      customer_id: string;
      finished_at: Date;
      page_records: unknown;
      day0_findings: number;
      day1_findings: number;
    }>(
      `SELECT DISTINCT ON (r.customer_id)
              r.customer_id, r.finished_at, r.page_records,
              (SELECT count(*)::int FROM "Finding" f
                WHERE f.processing_run_id = r.id AND f.convention = 'day0') AS day0_findings,
              (SELECT count(*)::int FROM "Finding" f
                WHERE f.processing_run_id = r.id AND f.convention = 'day1') AS day1_findings
       FROM "ProcessingRun" r
       WHERE r.kind = 'rules' AND r.finished_at IS NOT NULL
       ORDER BY r.customer_id, r.finished_at DESC, r.id DESC`,
    );
    for (const row of result.rows) {
      checks.set(
        row.customer_id,
        presentChecks(row.page_records, row.finished_at, countOf(row.day0_findings), countOf(row.day1_findings)),
      );
    }
    return checks;
  } finally {
    await client.end();
  }
}

export function formatDisputable(totals: readonly { currency: string; amount: string }[]): string {
  if (totals.length === 0) return "none";
  return totals.map((total) => `${total.amount} ${total.currency}`).join(", ");
}

async function prepareChecks(sql: ReviewSql, customerId: string): Promise<Prepared> {
  const settings = await currentSettings(sql, customerId);
  if (settings === null) throw new RulesInputError(NO_SETTINGS);
  const invoices = await approvedInvoices(sql, customerId);
  if (invoices.length === 0) throw new RulesInputError(NO_INVOICES);
  const numbers = new Set<string>();
  for (const invoice of invoices) {
    if (numbers.has(invoice.invoiceNumber)) throw new RulesInputError(SHARED_NUMBER);
    numbers.add(invoice.invoiceNumber);
  }
  const parties: Record<string, string> = {};
  const built = invoices.map((invoice) => {
    if (invoice.partyId === null) throw new RulesInputError(NO_PARTY);
    parties[invoice.invoiceNumber] = invoice.partyId;
    return { id: invoice.id, run: buildRunInvoice(invoice.stored) };
  });
  const day0 = runRules(built.map((invoice) => invoice.run), settings.config, "day0", parties, []);
  const day1 = runRules(built.map((invoice) => invoice.run), settings.config, "day1", parties, []);
  const byNumber = new Map(built.map((invoice) => [invoice.run.invoice_number, invoice.id]));
  return {
    summary: {
      failed: false,
      settings_version: settings.version,
      invoice_ids: built.map((invoice) => invoice.id),
      not_evaluable: { day0: day0.not_evaluable, day1: day1.not_evaluable },
      needs_info: { day0: day0.needs_info, day1: day1.needs_info },
      total_disputable: { day0: day0.total_disputable, day1: day1.total_disputable },
      invoices: { day0: invoiceAmounts(day0, byNumber), day1: invoiceAmounts(day1, byNumber) },
    },
    findings: [...rowsOf(day0, byNumber), ...rowsOf(day1, byNumber)],
  };
}

function invoiceAmounts(report: RunReport, byNumber: ReadonlyMap<string, string>): RulesInvoiceAmount[] {
  const rows = report.invoices.map((invoice) => {
    const invoiceId = byNumber.get(invoice.invoice_id);
    if (invoiceId === undefined) throw new RulesInputError(`No invoice for ${invoice.invoice_id}.`);
    return {
      invoice_id: invoiceId,
      disputable: invoice.disputable,
      do_not_pursue: invoice.do_not_pursue,
      superseded_by: invoice.superseded_by,
    };
  });
  rows.sort((left, right) => left.invoice_id.localeCompare(right.invoice_id));
  return rows;
}

function rowsOf(
  report: RunReport,
  byNumber: ReadonlyMap<string, string>,
): Prepared["findings"] {
  return report.findings.map((finding) => {
    const invoiceId = byNumber.get(finding.invoice_id);
    if (invoiceId === undefined) throw new RulesInputError(`No invoice for ${finding.invoice_id}.`);
    return { invoiceId, finding, convention: report.convention };
  });
}

async function writeSuccess(sql: ReviewSql, customerId: string, prepared: Prepared): Promise<void> {
  await sql.query("BEGIN");
  try {
    const runId = await insertRun(sql, customerId, prepared.summary);
    for (const row of prepared.findings) await insertFinding(sql, customerId, runId, row);
    await sql.query("COMMIT");
  } catch (error) {
    await rollback(sql);
    throw error;
  }
}

async function writeFailure(sql: ReviewSql, customerId: string, message: string): Promise<void> {
  const payload: RulesFailure = { failed: true, message };
  await sql.query("BEGIN");
  try {
    await insertRun(sql, customerId, payload);
    await sql.query("COMMIT");
  } catch (error) {
    await rollback(sql);
    throw error;
  }
}

async function insertRun(sql: ReviewSql, customerId: string, payload: RulesSummary | RulesFailure): Promise<string> {
  const inserted = await sql.query<{ id: string }>(
    `INSERT INTO "ProcessingRun" (customer_id, kind, finished_at, page_records)
     VALUES ($1::uuid, 'rules', now(), $2::jsonb)
     RETURNING id`,
    [customerId, JSON.stringify(payload)],
  );
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error("The rules run was not saved.");
  return id;
}

async function insertFinding(
  sql: ReviewSql,
  customerId: string,
  runId: string,
  row: Prepared["findings"][number],
): Promise<void> {
  const finding = row.finding;
  await sql.query(
    `INSERT INTO "Finding" (
       customer_id, invoice_id, processing_run_id, rule, rule_version, ground,
       citations, line_ids, expected, actual, disputable_amount, currency,
       evidence, explain, convention
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
       $7::jsonb, $8::jsonb, $9, $10, $11::numeric, $12,
       $13::jsonb, $14, $15
     )`,
    [
      customerId,
      row.invoiceId,
      runId,
      finding.rule,
      finding.rule_version,
      finding.ground,
      JSON.stringify(finding.citations),
      JSON.stringify(finding.line_ids),
      finding.expected,
      finding.actual,
      finding.disputable_amount,
      finding.currency,
      JSON.stringify(finding.evidence),
      finding.explain,
      row.convention,
    ],
  );
}

type Approved = {
  id: string;
  invoiceNumber: string;
  partyId: string | null;
  stored: StoredRulesInvoice;
};

async function approvedInvoices(sql: ReviewSql, customerId: string): Promise<Approved[]> {
  const headers = await sql.query<{
    id: string;
    invoice_number: string;
    billing_party: string;
    billed_party: string;
    currency: string;
    page_count: number;
    unresolved: unknown;
    sha256: string;
  }>(
    `SELECT i.id, i.invoice_number, i.billing_party, i.billed_party, i.currency,
            i.page_count, i.unresolved, d.sha256
     FROM "Invoice" i
     JOIN "Document" d ON d.id = i.document_id
     WHERE i.customer_id = $1
     ORDER BY i.invoice_number, i.id`,
    [customerId],
  );
  const elements = await sql.query<ElementRow>(
    `SELECT invoice_id, element_key, state, text, value, page, grounded
     FROM "ElementValue"
     WHERE customer_id = $1
     ORDER BY invoice_id, element_key`,
    [customerId],
  );
  const lines = await sql.query<LineRow>(
    `SELECT invoice_id, line_id, container, charge,
            charged_from::text AS charged_from, charged_to::text AS charged_to,
            days, rate::text AS rate, amount::text AS amount,
            container_page, from_page, to_page, days_page, rate_page, amount_page
     FROM "ChargeLine"
     WHERE customer_id = $1
     ORDER BY invoice_id, line_id`,
    [customerId],
  );
  const decisions = await sql.query<{ payload: unknown }>(
    `SELECT payload FROM "AuditEvent"
     WHERE customer_id = $1 AND action = 'review_decision'
     ORDER BY at, id`,
    [customerId],
  );
  const parties = await sql.query<{ payload: unknown }>(
    `SELECT payload FROM "AuditEvent"
     WHERE customer_id = $1 AND action = 'billing_party_set'
     ORDER BY at, id`,
    [customerId],
  );
  const elementsByInvoice = group(elements.rows, (row) => row.invoice_id);
  const linesByInvoice = group(lines.rows, (row) => row.invoice_id);
  const approved: Approved[] = [];
  for (const header of headers.rows) {
    const saved = readDecisions(
      decisions.rows.map((row) => row.payload),
      header.sha256,
    );
    if (!saved.some((decision) => decision.outcome === "approved")) continue;
    approved.push({
      id: header.id,
      invoiceNumber: header.invoice_number,
      partyId: shownPartyId(header.id, saved, parties.rows),
      stored: {
        invoiceNumber: header.invoice_number,
        billingParty: header.billing_party,
        billedParty: header.billed_party,
        currency: header.currency,
        pageCount: header.page_count,
        documentHash: header.sha256,
        elements: (elementsByInvoice.get(header.id) ?? []).map(storedElement),
        lines: (linesByInvoice.get(header.id) ?? []).map(storedLine),
        unresolved: header.unresolved,
        decisions: saved,
      },
    });
  }
  return approved;
}

type ElementRow = {
  invoice_id: string;
  element_key: string;
  state: string;
  text: string | null;
  value: string | null;
  page: number | null;
  grounded: boolean | null;
};

type LineRow = {
  invoice_id: string;
  line_id: string;
  container: string;
  charge: string;
  charged_from: string;
  charged_to: string;
  days: number | string;
  rate: string;
  amount: string;
  container_page: number | null;
  from_page: number | null;
  to_page: number | null;
  days_page: number | null;
  rate_page: number | null;
  amount_page: number | null;
};

function storedElement(row: ElementRow): StoredElement {
  return {
    elementKey: row.element_key,
    state: row.state,
    text: row.text,
    value: row.value,
    page: row.page,
    grounded: row.grounded,
  };
}

function storedLine(row: LineRow): StoredChargeLine {
  return {
    lineId: row.line_id,
    container: row.container,
    charge: row.charge,
    chargedFrom: row.charged_from,
    chargedTo: row.charged_to,
    days: row.days,
    rate: row.rate,
    amount: row.amount,
    containerPage: row.container_page,
    fromPage: row.from_page,
    toPage: row.to_page,
    daysPage: row.days_page,
    ratePage: row.rate_page,
    amountPage: row.amount_page,
  };
}

async function currentSettings(
  sql: ReviewSql,
  customerId: string,
): Promise<{ version: number; config: CustomerConfig } | null> {
  const result = await sql.query<{ version: number | string; config: unknown }>(
    `SELECT version, config FROM "CustomerConfigVersion"
     WHERE customer_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [customerId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  const version = typeof row.version === "number" ? row.version : Number(row.version);
  const parsed = customerConfigSchema.safeParse(row.config);
  if (!Number.isInteger(version) || version < 1 || !parsed.success) return null;
  return { version, config: parsed.data };
}

function presentChecks(payload: unknown, finishedAt: Date, day0Findings: number, day1Findings: number): LatestChecks {
  if (!isRecord(payload) || payload.failed === true) return { status: "failed", message: savedReason(payload) };
  const totals = payload.total_disputable;
  if (!isRecord(totals) || !Array.isArray(totals.day0) || !Array.isArray(totals.day1)) {
    return { status: "failed", message: savedReason(payload) };
  }
  return {
    status: "ok",
    ranAt: finishedAt.toISOString(),
    day0Findings,
    day1Findings,
    day0: formatDisputable(moneyList(totals.day0)),
    day1: formatDisputable(moneyList(totals.day1)),
  };
}

function savedReason(payload: unknown): string {
  if (isRecord(payload) && typeof payload.message === "string" && payload.message.trim() !== "") return payload.message;
  return "Checks failed.";
}

function countOf(value: number | string): number {
  const count = typeof value === "number" ? value : Number(value);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

/** Day 1 is the count on the line. Day 0 is added only when its count or total differs. */
export function formatChecksLine(checks: Extract<LatestChecks, { status: "ok" }>): string {
  const day1 = findingWord(checks.day1Findings);
  if (checks.day1Findings === checks.day0Findings && checks.day1 === checks.day0) {
    return `${day1} · day 1 ${checks.day1}`;
  }
  return `day 1 ${day1} · ${checks.day1} · day 0 ${findingWord(checks.day0Findings)} · ${checks.day0}`;
}

function findingWord(count: number): string {
  return count === 1 ? "1 finding" : `${count} findings`;
}

function moneyList(value: readonly unknown[]): { currency: string; amount: string }[] {
  const totals: { currency: string; amount: string }[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.currency !== "string" || typeof item.amount !== "string") continue;
    totals.push({ currency: item.currency, amount: item.amount });
  }
  return totals;
}

function group<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const list = grouped.get(id) ?? [];
    list.push(row);
    grouped.set(id, list);
  }
  return grouped;
}

function messageOf(error: unknown): string {
  if (error instanceof RulesInputError || error instanceof ReviewError) return error.message;
  return "Checks failed.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function rollback(sql: ReviewSql): Promise<void> {
  try {
    await sql.query("ROLLBACK");
  } catch {
    // The connection may already have rolled back.
  }
}
