import { Client } from "pg";
import { ReviewError, type SavedDecision } from "dd-core";
import {
  approvalDecision,
  buildDecision,
  manualEntries,
  readDecisions,
  reviewQueue,
  type DecisionCommand,
  type FinishedRun,
  type QueueInvoice,
  type QueueSource,
  type StoredElement,
} from "./review-view";

export type ReviewSql = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
};

export type ManualDocument = { id: string; customer: string; receivedAt: string };

export type ChargeLineView = {
  id: string;
  container: string;
  from: string;
  to: string;
  days: number;
  rate: string;
  amount: string;
  currency: string;
  grounded: boolean | null;
};

export type LoadedInvoice = {
  id: string;
  customerId: string;
  customer: string;
  invoiceNumber: string;
  billingParty: string;
  billedParty: string;
  currency: string;
  invoiceDate: string | null;
  pageCount: number;
  documentHash: string;
  rows: StoredElement[];
  lines: ChargeLineView[];
  decisions: SavedDecision[];
  approved: boolean;
};

type HeaderRow = {
  customer_id: string;
  invoice_number: string;
  billing_party: string;
  billed_party: string;
  currency: string;
  invoice_date: string | null;
  page_count: number;
  display_name: string;
  sha256: string;
};

const NOT_FOUND = "That invoice was not found.";

export async function withReviewDb<T>(run: (sql: ReviewSql) => Promise<T>): Promise<T | null> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") return null;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run({
      query: async <T extends Record<string, unknown>>(text: string, values?: readonly unknown[]) => {
        const result = await client.query(text, values === undefined ? undefined : [...values]);
        return { rows: result.rows as T[] };
      },
    });
  } finally {
    await client.end();
  }
}

export async function readQueue(sql: ReviewSql): Promise<{ invoices: QueueInvoice[]; manual: ManualDocument[] }> {
  const invoices = await sql.query<{
    id: string;
    customer_id: string;
    invoice_number: string;
    billing_party: string;
    billed_party: string;
    currency: string;
    page_count: number;
    created_at: string | Date;
    display_name: string;
    sha256: string;
  }>(
    `SELECT i.id, i.customer_id, i.invoice_number, i.billing_party, i.billed_party, i.currency,
            i.page_count, i.created_at, c.display_name, d.sha256
     FROM "Invoice" i
     JOIN "Customer" c ON c.id = i.customer_id
     JOIN "Document" d ON d.id = i.document_id
     ORDER BY i.created_at ASC, i.id ASC`,
  );
  const ids = invoices.rows.map((row) => row.id);
  const elements = ids.length === 0 ? [] : await elementRows(sql, ids);
  const customerIds = [...new Set(invoices.rows.map((row) => row.customer_id))];
  const events = customerIds.length === 0 ? [] : await decisionRows(sql, customerIds);
  const byInvoice = group(elements, (row) => row.invoice_id);
  const sources: QueueSource[] = invoices.rows.map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    customer: row.display_name,
    invoiceNumber: row.invoice_number,
    billingParty: row.billing_party,
    billedParty: row.billed_party,
    currency: row.currency,
    pageCount: row.page_count,
    createdAt: instant(row.created_at),
    documentHash: row.sha256,
    rows: (byInvoice.get(row.id) ?? []).map(storedElement),
    decisions: events.filter((event) => event.customer_id === row.customer_id).map((event) => event.payload),
  }));
  const runs = await sql.query<{
    document_id: string;
    display_name: string;
    received_at: string | Date;
    invoice_id: string | null;
    finished_at: string | Date;
    page_records: unknown;
  }>(
    `SELECT d.id AS document_id, c.display_name, d.received_at, r.invoice_id, r.finished_at, r.page_records
     FROM "ProcessingRun" r
     JOIN "Document" d ON d.id = r.document_id
     JOIN "Customer" c ON c.id = d.customer_id
     WHERE r.finished_at IS NOT NULL`,
  );
  const finished: FinishedRun[] = runs.rows.map((row) => ({
    documentId: row.document_id,
    customer: row.display_name,
    receivedAt: instant(row.received_at),
    invoiceId: row.invoice_id,
    finishedAt: instant(row.finished_at),
    pageRecords: row.page_records,
  }));
  return { invoices: reviewQueue(sources), manual: manualEntries(finished) };
}

export async function readInvoice(sql: ReviewSql, invoiceId: string): Promise<LoadedInvoice | null> {
  const header = await sql.query<HeaderRow>(
    `SELECT i.customer_id, i.invoice_number, i.billing_party, i.billed_party, i.currency,
            i.invoice_date::text AS invoice_date, i.page_count, c.display_name, d.sha256
     FROM "Invoice" i
     JOIN "Customer" c ON c.id = i.customer_id
     JOIN "Document" d ON d.id = i.document_id
     WHERE i.id = $1`,
    [invoiceId],
  );
  const row = header.rows[0];
  if (row === undefined) return null;
  return loadBody(sql, invoiceId, row);
}

export async function recordDecision(
  sql: ReviewSql,
  input: { invoiceId: string; actor: string; at: string; command: DecisionCommand },
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await sql.query("BEGIN");
    const locked = await lockInvoice(sql, input.invoiceId);
    if (locked === null) {
      await sql.query("ROLLBACK");
      return { ok: false, message: NOT_FOUND };
    }
    const body = await loadBody(sql, input.invoiceId, locked);
    const decision = buildDecision({
      documentHash: body.documentHash,
      header: headerOf(body),
      rows: body.rows,
      prior: body.decisions,
      actor: input.actor,
      at: input.at,
      command: input.command,
    });
    await insertDecision(sql, body.customerId, input.actor, input.at, decision);
    await sql.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await rollback(sql);
    if (error instanceof ReviewError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function recordApproval(
  sql: ReviewSql,
  input: { invoiceId: string; actor: string; at: string; acknowledgedPages: readonly number[] },
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await sql.query("BEGIN");
    const locked = await lockInvoice(sql, input.invoiceId);
    if (locked === null) {
      await sql.query("ROLLBACK");
      return { ok: false, message: NOT_FOUND };
    }
    const body = await loadBody(sql, input.invoiceId, locked);
    const decision = approvalDecision({
      documentHash: body.documentHash,
      header: headerOf(body),
      rows: body.rows,
      prior: body.decisions,
      acknowledgedPages: input.acknowledgedPages,
      actor: input.actor,
      at: input.at,
    });
    await insertDecision(sql, body.customerId, input.actor, input.at, decision);
    await sql.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await rollback(sql);
    if (error instanceof ReviewError) return { ok: false, message: error.message };
    throw error;
  }
}

function headerOf(invoice: LoadedInvoice) {
  return {
    invoiceNumber: invoice.invoiceNumber,
    billingParty: invoice.billingParty,
    billedParty: invoice.billedParty,
    currency: invoice.currency,
    pageCount: invoice.pageCount,
  };
}

async function lockInvoice(sql: ReviewSql, invoiceId: string): Promise<HeaderRow | null> {
  const header = await sql.query<HeaderRow>(
    `SELECT i.customer_id, i.invoice_number, i.billing_party, i.billed_party, i.currency,
            i.invoice_date::text AS invoice_date, i.page_count, c.display_name, d.sha256
     FROM "Invoice" i
     JOIN "Customer" c ON c.id = i.customer_id
     JOIN "Document" d ON d.id = i.document_id
     WHERE i.id = $1
     FOR UPDATE OF i`,
    [invoiceId],
  );
  return header.rows[0] ?? null;
}

async function loadBody(sql: ReviewSql, invoiceId: string, row: HeaderRow): Promise<LoadedInvoice> {
  const elements = await sql.query<ElementSql & { invoice_id?: string }>(
    `SELECT element_key, state, text, value, page, grounded
     FROM "ElementValue"
     WHERE customer_id = $1 AND invoice_id = $2
     ORDER BY element_key`,
    [row.customer_id, invoiceId],
  );
  const lines = await sql.query<{
    line_id: string;
    container: string;
    charged_from: string | Date;
    charged_to: string | Date;
    days: number;
    rate: string;
    amount: string;
    currency: string;
    grounded: boolean | null;
  }>(
    `SELECT line_id, container, charged_from::text AS charged_from, charged_to::text AS charged_to,
            days, rate::text AS rate, amount::text AS amount, currency, grounded
     FROM "ChargeLine"
     WHERE customer_id = $1 AND invoice_id = $2
     ORDER BY line_id`,
    [row.customer_id, invoiceId],
  );
  const events = await sql.query<{ payload: unknown }>(
    `SELECT payload FROM "AuditEvent"
     WHERE customer_id = $1 AND action = 'review_decision'
     ORDER BY at, id`,
    [row.customer_id],
  );
  const decisions = readDecisions(
    events.rows.map((event) => event.payload),
    row.sha256,
  );
  return {
    id: invoiceId,
    customerId: row.customer_id,
    customer: row.display_name,
    invoiceNumber: row.invoice_number,
    billingParty: row.billing_party,
    billedParty: row.billed_party,
    currency: row.currency,
    invoiceDate: row.invoice_date === null ? null : row.invoice_date.slice(0, 10),
    pageCount: row.page_count,
    documentHash: row.sha256,
    rows: elements.rows.map(storedElement),
    lines: lines.rows.map((line) => ({
      id: line.line_id,
      container: line.container,
      from: calendarDay(line.charged_from),
      to: calendarDay(line.charged_to),
      days: line.days,
      rate: line.rate,
      amount: line.amount,
      currency: line.currency,
      grounded: line.grounded,
    })),
    decisions,
    approved: decisions.some((decision) => decision.outcome === "approved"),
  };
}

async function insertDecision(
  sql: ReviewSql,
  customerId: string,
  actor: string,
  at: string,
  decision: SavedDecision,
): Promise<void> {
  await sql.query(
    `INSERT INTO "AuditEvent" (customer_id, at, actor, action, payload)
     VALUES ($1, $2::timestamptz, $3, 'review_decision', $4::jsonb)`,
    [customerId, at, actor, JSON.stringify(decision)],
  );
}

async function elementRows(sql: ReviewSql, invoiceIds: readonly string[]): Promise<(ElementSql & { invoice_id: string })[]> {
  const result = await sql.query<ElementSql & { invoice_id: string }>(
    `SELECT invoice_id, element_key, state, text, value, page, grounded
     FROM "ElementValue"
     WHERE invoice_id = ANY($1::uuid[])`,
    [invoiceIds],
  );
  return result.rows;
}

async function decisionRows(
  sql: ReviewSql,
  customerIds: readonly string[],
): Promise<{ customer_id: string; payload: unknown }[]> {
  const result = await sql.query<{ customer_id: string; payload: unknown }>(
    `SELECT customer_id, payload FROM "AuditEvent"
     WHERE customer_id = ANY($1::uuid[]) AND action = 'review_decision'
     ORDER BY at, id`,
    [customerIds],
  );
  return result.rows;
}

type ElementSql = {
  element_key: string;
  state: string;
  text: string | null;
  value: string | null;
  page: number | null;
  grounded: boolean | null;
};

function storedElement(row: ElementSql): StoredElement {
  return {
    elementKey: row.element_key,
    state: row.state,
    text: row.text,
    value: row.value,
    page: row.page,
    grounded: row.grounded,
  };
}

function group<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const list = grouped.get(id);
    if (list === undefined) grouped.set(id, [row]);
    else list.push(row);
  }
  return grouped;
}

function instant(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function calendarDay(value: string | Date): string {
  if (value instanceof Date) {
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${value.getUTCFullYear()}-${month}-${day}`;
  }
  return value.slice(0, 10);
}

async function rollback(sql: ReviewSql): Promise<void> {
  try {
    await sql.query("ROLLBACK");
  } catch {
    // The original error is the one the caller sees.
  }
}
