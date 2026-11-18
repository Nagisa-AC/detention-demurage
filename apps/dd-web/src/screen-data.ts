import { Client } from "pg";
import { readDecisions } from "./review-view";

export type ListedInvoice = {
  id: string;
  customerId: string;
  customer: string;
  number: string;
  billingParty: string;
  pageCount: number;
  currency: string;
  receivedAt: string;
  total: string | null;
  approved: boolean;
  approvedAt: string | null;
};

/** Every saved invoice, with approval taken from the same review decisions the queue uses. Null when the database is not configured. */
export async function listInvoices(): Promise<ListedInvoice[] | null> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") return null;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const invoices = await client.query<{
      id: string;
      customer_id: string;
      display_name: string;
      invoice_number: string;
      billing_party: string;
      page_count: number;
      currency: string;
      created_at: Date;
      sha256: string;
      total: string | null;
    }>(
      `SELECT i.id, i.customer_id, c.display_name, i.invoice_number, i.billing_party, i.page_count, i.currency,
              i.created_at, d.sha256, ev.value AS total
       FROM "Invoice" i
       JOIN "Customer" c ON c.id = i.customer_id
       JOIN "Document" d ON d.id = i.document_id
       LEFT JOIN "ElementValue" ev ON ev.invoice_id = i.id AND ev.element_key = 'total_due'
       ORDER BY i.created_at ASC, i.id ASC`,
    );
    const events = await client.query<{ customer_id: string; payload: unknown }>(
      `SELECT customer_id, payload FROM "AuditEvent"
       WHERE action = 'review_decision'
       ORDER BY at ASC, id ASC`,
    );
    const byCustomer = new Map<string, unknown[]>();
    for (const event of events.rows) {
      const list = byCustomer.get(event.customer_id) ?? [];
      list.push(event.payload);
      byCustomer.set(event.customer_id, list);
    }
    return invoices.rows.map((row) => {
      const saved = readDecisions(byCustomer.get(row.customer_id) ?? [], row.sha256);
      let approvedAt: string | null = null;
      for (const decision of saved) {
        if (decision.outcome === "approved") approvedAt = decision.decided_at;
      }
      return {
        id: row.id,
        customerId: row.customer_id,
        customer: row.display_name,
        number: row.invoice_number,
        billingParty: row.billing_party,
        pageCount: row.page_count,
        currency: row.currency,
        receivedAt: row.created_at.toISOString(),
        total: row.total,
        approved: approvedAt !== null,
        approvedAt,
      };
    });
  } finally {
    await client.end();
  }
}

/** True when both instants fall on the same calendar day in Eastern Time. */
export function isSameEtDay(iso: string, now: Date = new Date()): boolean {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return false;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return day.format(parsed) === day.format(now);
}
