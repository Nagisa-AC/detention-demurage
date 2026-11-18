import { customerConfigSchema, dayCount, ELEMENTS, type ElementKey } from "dd-core";
import { initials } from "./initials";
import { withReviewDb, type ReviewSql } from "./review-data";
import { readDecisions } from "./review-view";
import {
  checkCells,
  leadFinding,
  type CheckCell,
  type StoredFindingView,
} from "./findings-view";

export type MoneyTotal = { amount: string; currency: string };

export type ConventionSlice = {
  checks: CheckCell[];
  amounts: string[];
  findingId: string | null;
  daysWarn: boolean;
  manual: boolean;
  needsInfo: boolean;
};

export type FindingsTableRow = {
  invoiceId: string;
  number: string;
  carrier: string;
  initials: string;
  container: string | null;
  bl: string | null;
  pages: number;
  billed: string | null;
  currency: string;
  invoiceDate: string | null;
  days: number | null;
  refused: boolean;
  day0: ConventionSlice;
  day1: ConventionSlice;
};

export type FindingsBoard = {
  ranAt: string;
  settingsVersion: number | null;
  day0Total: MoneyTotal | null;
  day1Total: MoneyTotal | null;
  approved: number;
  waiting: number;
  rows: FindingsTableRow[];
};

export type FindingInput = {
  label: string;
  detail: string;
  value: string;
  confirmed: boolean;
};

export type FindingDetail = {
  id: string;
  customerName: string;
  invoiceId: string;
  invoiceNumber: string;
  pageCount: number;
  page: number;
  highlights: string[];
  title: string;
  rule: string;
  ruleVersion: number;
  citations: string[];
  explain: string;
  expected: string;
  actual: string;
  amount: string;
  currency: string;
  convention: "day0" | "day1";
  otherAmount: string | null;
  otherConvention: "day0" | "day1";
  ranAt: string;
  settingsVersion: number | null;
  inputs: FindingInput[];
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d+\.\d{2}$/;
const LINE_LABELS: Record<string, string> = {
  id: "Line",
  container: "Container",
  charge: "Charge",
  charged_from: "Charged from",
  charged_to: "Charged to",
  days: "Days",
  rate: "Rate",
  amount: "Amount",
};

/** The latest finished rules run, and one row per approved invoice. Null when the database is not configured. */
export async function readFindingsBoard(customerId: string): Promise<FindingsBoard | null> {
  return withReviewDb(async (sql) => {
    const run = await latestRun(sql, customerId);
    const invoices = await loadInvoices(sql, customerId);
    const refused = await refusedParties(sql, customerId, run?.settingsVersion ?? null);
    const approved = invoices.filter((invoice) => invoice.approved);
    const findings = run === null || run.failed ? [] : await loadFindings(sql, run.id);
    return {
      ranAt: run?.ranAt ?? "",
      settingsVersion: run?.settingsVersion ?? null,
      day0Total: run?.day0Total ?? null,
      day1Total: run?.day1Total ?? null,
      approved: approved.length,
      waiting: invoices.length - approved.length,
      rows: approved.map((invoice) => toRow(invoice, findings, run, refused)),
    };
  });
}

export async function readFindingDetail(customerId: string, findingId: string): Promise<FindingDetail | null> {
  return withReviewDb(async (sql) => {
    const found = await sql.query<{
      id: string;
      customer_name: string;
      invoice_id: string;
      invoice_number: string;
      page_count: number;
      sha256: string;
      rule: string;
      rule_version: number;
      citations: unknown;
      line_ids: unknown;
      expected: string;
      actual: string;
      amount: string;
      currency: string;
      explain: string;
      convention: string | null;
      evidence: unknown;
      processing_run_id: string;
      finished_at: Date;
      page_records: unknown;
    }>(
      `SELECT f.id, c.display_name AS customer_name, f.invoice_id, i.invoice_number, i.page_count, d.sha256,
              f.rule, f.rule_version, f.citations, f.line_ids, f.expected, f.actual,
              f.disputable_amount::text AS amount, f.currency, f.explain, f.convention, f.evidence,
              f.processing_run_id, r.finished_at, r.page_records
       FROM "Finding" f
       JOIN "Invoice" i ON i.id = f.invoice_id
       JOIN "Customer" c ON c.id = f.customer_id
       JOIN "Document" d ON d.id = i.document_id
       JOIN "ProcessingRun" r ON r.id = f.processing_run_id
       WHERE f.id = $1 AND f.customer_id = $2`,
      [findingId, customerId],
    );
    const row = found.rows[0];
    if (row === undefined) return null;
    const finding = toFinding(row);
    const siblings = await sql.query<{
      id: string;
      rule: string;
      line_ids: unknown;
      expected: string;
      actual: string;
      amount: string;
      convention: string | null;
    }>(
      `SELECT id, rule, line_ids, expected, actual, disputable_amount::text AS amount, convention
       FROM "Finding"
       WHERE processing_run_id = $1 AND invoice_id = $2 AND id <> $3`,
      [row.processing_run_id, row.invoice_id, row.id],
    );
    const other = siblingAmount(
      finding,
      siblings.rows.map((item) => ({
        rule: item.rule,
        lineIds: stringList(item.line_ids),
        expected: item.expected,
        actual: item.actual,
        amount: item.amount,
        convention: item.convention === "day0" ? "day0" : "day1",
      })),
    );
    const elements = await sql.query<{ element_key: string; state: string; text: string | null; value: string | null; page: number | null }>(
      `SELECT element_key, state, text, value, page FROM "ElementValue" WHERE invoice_id = $1`,
      [row.invoice_id],
    );
    const lines = await sql.query<{
      line_id: string;
      container: string;
      charge: string;
      charged_from: string;
      charged_to: string;
      days: number;
      rate: string;
      amount: string;
    }>(
      `SELECT line_id, container, charge, charged_from::text AS charged_from, charged_to::text AS charged_to,
              days, rate::text AS rate, amount::text AS amount
       FROM "ChargeLine" WHERE invoice_id = $1`,
      [row.invoice_id],
    );
    const events = await sql.query<{ payload: unknown }>(
      `SELECT payload FROM "AuditEvent"
       WHERE customer_id = $1 AND action = 'review_decision'
       ORDER BY at, id`,
      [customerId],
    );
    const decisions = readDecisions(events.rows.map((event) => event.payload), row.sha256);
    const approved = decisions.some((decision) => decision.outcome === "approved");
    const linesApproved = decisions.some((decision) => decision.element_key === "charge_lines" && decision.outcome === "approved");
    const inputs = inputsOf(finding, elements.rows, lines.rows, decisions, approved, linesApproved);
    const page = citedPage(finding, row.page_count);
    const run = parseRun(row.page_records);
    return {
      id: finding.id,
      customerName: row.customer_name,
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      pageCount: row.page_count,
      page,
      highlights: inputs.map((input) => input.value).filter((text) => text.length >= 3 && text !== "confirmed absent"),
      title: checkCells([finding])[0]?.label.split(" · ")[0] ?? finding.rule,
      rule: finding.rule,
      ruleVersion: finding.ruleVersion,
      citations: finding.citations,
      explain: finding.explain,
      expected: finding.expected,
      actual: finding.actual,
      amount: finding.amount,
      currency: finding.currency,
      convention: finding.convention === "day0" ? "day0" : "day1",
      otherAmount: other.amount,
      otherConvention: other.convention,
      ranAt: row.finished_at.toISOString(),
      settingsVersion: run.settingsVersion,
      inputs,
    };
  });
}

type InvoiceFacts = {
  id: string;
  number: string;
  carrier: string;
  pages: number;
  currency: string;
  hash: string;
  approved: boolean;
  partyId: string | null;
  container: string | null;
  bl: string | null;
  billed: string | null;
  invoiceDate: string | null;
  lastCharge: string | null;
};

type RunFacts = {
  id: string;
  ranAt: string;
  failed: boolean;
  settingsVersion: number | null;
  day0Total: MoneyTotal | null;
  day1Total: MoneyTotal | null;
  needsDay0: Set<string>;
  needsDay1: Set<string>;
};

async function latestRun(sql: ReviewSql, customerId: string): Promise<RunFacts | null> {
  const result = await sql.query<{ id: string; finished_at: Date; page_records: unknown }>(
    `SELECT id, finished_at, page_records
     FROM "ProcessingRun"
     WHERE customer_id = $1 AND kind = 'rules' AND finished_at IS NOT NULL
     ORDER BY finished_at DESC, id DESC
     LIMIT 1`,
    [customerId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  const parsed = parseRun(row.page_records);
  return { id: row.id, ranAt: row.finished_at.toISOString(), ...parsed };
}

async function loadFindings(sql: ReviewSql, runId: string): Promise<StoredFindingView[]> {
  const result = await sql.query<{
    id: string;
    invoice_id: string;
    rule: string;
    rule_version: number;
    citations: unknown;
    line_ids: unknown;
    expected: string;
    actual: string;
    amount: string;
    currency: string;
    explain: string;
    convention: string | null;
    evidence: unknown;
  }>(
    `SELECT id, invoice_id, rule, rule_version, citations, line_ids, expected, actual,
            disputable_amount::text AS amount, currency, explain, convention, evidence
     FROM "Finding"
     WHERE processing_run_id = $1
     ORDER BY invoice_id, rule, id`,
    [runId],
  );
  return result.rows.map((row) => toFinding(row));
}

async function loadInvoices(sql: ReviewSql, customerId: string): Promise<InvoiceFacts[]> {
  const headers = await sql.query<{
    id: string;
    invoice_number: string;
    billing_party: string;
    currency: string;
    page_count: number;
    sha256: string;
    invoice_date: string | null;
  }>(
    `SELECT i.id, i.invoice_number, i.billing_party, i.currency, i.page_count, d.sha256, i.invoice_date::text AS invoice_date
     FROM "Invoice" i
     JOIN "Document" d ON d.id = i.document_id
     WHERE i.customer_id = $1
     ORDER BY i.invoice_number, i.id`,
    [customerId],
  );
  const elements = await sql.query<{ invoice_id: string; element_key: string; text: string | null; value: string | null }>(
    `SELECT invoice_id, element_key, text, value FROM "ElementValue" WHERE customer_id = $1`,
    [customerId],
  );
  const lines = await sql.query<{ invoice_id: string; charged_to: string }>(
    `SELECT invoice_id, charged_to::text AS charged_to FROM "ChargeLine" WHERE customer_id = $1`,
    [customerId],
  );
  const events = await sql.query<{ payload: unknown }>(
    `SELECT payload FROM "AuditEvent"
     WHERE customer_id = $1 AND action = 'review_decision'
     ORDER BY at, id`,
    [customerId],
  );
  const payloads = events.rows.map((event) => event.payload);
  const byInvoice = new Map<string, { key: string; text: string | null; value: string | null }[]>();
  for (const element of elements.rows) {
    const list = byInvoice.get(element.invoice_id) ?? [];
    list.push({ key: element.element_key, text: element.text, value: element.value });
    byInvoice.set(element.invoice_id, list);
  }
  const lastCharge = new Map<string, string>();
  for (const line of lines.rows) {
    const current = lastCharge.get(line.invoice_id);
    if (current === undefined || line.charged_to > current) lastCharge.set(line.invoice_id, line.charged_to);
  }
  return headers.rows.map((header) => {
    const saved = readDecisions(payloads, header.sha256);
    const stored = byInvoice.get(header.id) ?? [];
    const approved = saved.some((decision) => decision.outcome === "approved");
    let partyId: string | null = null;
    for (const decision of saved) {
      if (decision.outcome === "approved" && decision.party_id !== undefined) partyId = decision.party_id;
    }
    const date = elementText(stored, "invoice_date");
    return {
      id: header.id,
      number: header.invoice_number,
      carrier: header.billing_party,
      pages: header.page_count,
      currency: header.currency,
      hash: header.sha256,
      approved,
      partyId,
      container: elementText(stored, "container_number"),
      bl: elementText(stored, "bl_number"),
      billed: moneyText(stored, "total_due"),
      invoiceDate: isoText(date) ?? isoText(header.invoice_date),
      lastCharge: lastCharge.get(header.id) ?? null,
    };
  });
}

async function refusedParties(sql: ReviewSql, customerId: string, version: number | null): Promise<Set<string>> {
  if (version === null) return new Set();
  const result = await sql.query<{ config: unknown }>(
    `SELECT config FROM "CustomerConfigVersion" WHERE customer_id = $1 AND version = $2`,
    [customerId, version],
  );
  const parsed = customerConfigSchema.safeParse(result.rows[0]?.config);
  if (!parsed.success) return new Set();
  return new Set(parsed.data.billing_parties.do_not_pursue);
}

function toRow(invoice: InvoiceFacts, findings: readonly StoredFindingView[], run: RunFacts | null, refused: Set<string>): FindingsTableRow {
  const own = findings.filter((finding) => finding.invoiceId === invoice.id);
  const day0 = own.filter((finding) => finding.convention === "day0");
  const day1 = own.filter((finding) => finding.convention !== "day0");
  const date = invoice.invoiceDate;
  const from = invoice.lastCharge;
  let days: number | null = null;
  if (date !== null && from !== null && ISO.test(date) && ISO.test(from)) {
    try {
      days = dayCount(from, date, "day0");
    } catch {
      days = null;
    }
  }
  return {
    invoiceId: invoice.id,
    number: invoice.number,
    carrier: invoice.carrier,
    initials: initials(invoice.carrier),
    container: invoice.container,
    bl: invoice.bl,
    pages: invoice.pages,
    billed: invoice.billed,
    currency: invoice.currency,
    invoiceDate: date,
    days,
    refused: invoice.partyId !== null && refused.has(invoice.partyId),
    day0: sliceOf(day0, run?.needsDay0.has(invoice.number) ?? false),
    day1: sliceOf(day1, run?.needsDay1.has(invoice.number) ?? false),
  };
}

function sliceOf(findings: readonly StoredFindingView[], needsInfo: boolean): ConventionSlice {
  const lead = leadFinding(findings);
  return {
    checks: findings.length === 0 ? [] : checkCells(findings),
    amounts: findings.map((finding) => finding.amount),
    findingId: lead?.id ?? null,
    daysWarn: findings.some((finding) => finding.rule === "R2"),
    manual: findings.some((finding) => finding.rule === "manual"),
    needsInfo,
  };
}

function toFinding(row: {
  id: string;
  invoice_id: string;
  rule: string;
  rule_version: number;
  citations: unknown;
  line_ids: unknown;
  expected: string;
  actual: string;
  amount: string;
  currency: string;
  explain: string;
  convention: string | null;
  evidence: unknown;
}): StoredFindingView {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    rule: row.rule,
    ruleVersion: row.rule_version,
    citations: stringList(row.citations),
    lineIds: stringList(row.line_ids),
    expected: row.expected,
    actual: row.actual,
    amount: row.amount,
    currency: row.currency,
    explain: row.explain,
    convention: row.convention === "day0" ? "day0" : "day1",
    evidence: evidenceList(row.evidence),
  };
}

function parseRun(payload: unknown): Omit<RunFacts, "id" | "ranAt"> {
  const record = isRecord(payload) ? payload : {};
  const totals = isRecord(record.total_disputable) ? record.total_disputable : {};
  const needs = isRecord(record.needs_info) ? record.needs_info : {};
  return {
    failed: record.failed === true,
    settingsVersion: typeof record.settings_version === "number" ? record.settings_version : null,
    day0Total: moneyTotal(totals.day0),
    day1Total: moneyTotal(totals.day1),
    needsDay0: invoiceIds(needs.day0),
    needsDay1: invoiceIds(needs.day1),
  };
}

function moneyTotal(value: unknown): MoneyTotal | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const totals: MoneyTotal[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.amount !== "string" || typeof item.currency !== "string") continue;
    totals.push({ amount: item.amount, currency: item.currency });
  }
  return totals[0] ?? null;
}

function invoiceIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(value)) return ids;
  for (const item of value) {
    if (isRecord(item) && typeof item.invoice_id === "string") ids.add(item.invoice_id);
  }
  return ids;
}

function inputsOf(
  finding: StoredFindingView,
  elements: readonly { element_key: string; state: string; text: string | null; value: string | null; page: number | null }[],
  lines: readonly { line_id: string; container: string; charge: string; charged_from: string; charged_to: string; days: number; rate: string; amount: string }[],
  decisions: readonly { element_key: string; outcome: string }[],
  approved: boolean,
  linesApproved: boolean,
): FindingInput[] {
  const seen = new Set<string>();
  const inputs: FindingInput[] = [];
  for (const item of finding.evidence) {
    const key = `${item.field}:${item.page ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const element = elements.find((row) => row.element_key === item.field);
    if (element !== undefined) {
      const decided = decisions.find((decision) => decision.element_key === item.field);
      const absent = decided?.outcome === "confirmed_absent";
      const value = absent ? "confirmed absent" : (firstText(element.value, element.text) ?? "");
      inputs.push({
        label: elementLabel(item.field),
        value,
        detail: describe(value === "" ? null : value, item.page ?? element.page),
        confirmed: absent || decided?.outcome === "present" || decided?.outcome === "edited" || (approved && element.state === "present"),
      });
      continue;
    }
    const line = lines.find((row) => finding.lineIds.includes(row.line_id));
    const value = lineValue(line, item.field) ?? "";
    inputs.push({
      label: LINE_LABELS[item.field] ?? item.field,
      value,
      detail: describe(value === "" ? null : value, item.page),
      confirmed: linesApproved,
    });
  }
  return inputs;
}

function citedPage(finding: StoredFindingView, pageCount: number): number {
  const page = finding.evidence.find((item) => item.page !== null)?.page ?? 1;
  if (page < 1) return 1;
  if (page > pageCount) return pageCount;
  return page;
}

function siblingAmount(
  finding: StoredFindingView,
  others: readonly { rule: string; lineIds: string[]; expected: string; actual: string; amount: string; convention: "day0" | "day1" }[],
): { convention: "day0" | "day1"; amount: string | null } {
  const wanted = finding.convention === "day0" ? "day1" : "day0";
  const matches = others.filter(
    (other) => other.convention === wanted && other.rule === finding.rule && sameIds(other.lineIds, finding.lineIds),
  );
  const exact = matches.find((other) => other.expected === finding.expected && other.actual === finding.actual) ?? matches[0];
  if (exact === undefined) return { convention: wanted, amount: null };
  if (exact.amount === finding.amount) return { convention: wanted, amount: finding.amount };
  return { convention: wanted, amount: exact.amount };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const ordered = [...left].sort();
  return [...right].sort().every((id, index) => id === ordered[index]);
}

function elementText(rows: readonly { key: string; text: string | null; value: string | null }[], key: string): string | null {
  const row = rows.find((item) => item.key === key);
  return row === undefined ? null : firstText(row.text, row.value);
}

function moneyText(rows: readonly { key: string; text: string | null; value: string | null }[], key: string): string | null {
  const row = rows.find((item) => item.key === key);
  if (row === undefined) return null;
  if (row.value !== null && MONEY.test(row.value)) return row.value;
  const match = row.text?.match(/(\d+\.\d{2})/);
  return match?.[1] ?? null;
}

function elementLabel(field: string): string {
  if (field in ELEMENTS) return ELEMENTS[field as ElementKey].label;
  return LINE_LABELS[field] ?? field;
}

function lineValue(
  line: { line_id: string; container: string; charge: string; charged_from: string; charged_to: string; days: number; rate: string; amount: string } | undefined,
  field: string,
): string | null {
  if (line === undefined) return null;
  if (field === "id") return line.line_id;
  if (field === "container") return line.container;
  if (field === "charge") return line.charge;
  if (field === "charged_from") return line.charged_from;
  if (field === "charged_to") return line.charged_to;
  if (field === "days") return String(line.days);
  if (field === "rate") return line.rate;
  if (field === "amount") return line.amount;
  return null;
}

function describe(value: string | null, page: number | null): string {
  const shown = value === null || value.trim() === "" ? "—" : value;
  if (page === null) return shown;
  return `${shown} · page ${page}`;
}

function firstText(left: string | null, right: string | null): string | null {
  if (left !== null && left.trim() !== "") return left;
  if (right !== null && right.trim() !== "") return right;
  return null;
}

function isoText(value: string | null): string | null {
  if (value === null) return null;
  return ISO.test(value) ? value : null;
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
