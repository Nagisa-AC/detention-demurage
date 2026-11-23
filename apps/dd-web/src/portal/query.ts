import { Client } from "pg";
import { isPortalCustomer, type PortalCustomer } from "./customer";

export type PortalInvoice = {
  invoice_number: string;
  invoice_date: string | null;
  currency: string;
  status: string;
  disputable: string | null;
};

export type PortalFinding = {
  invoice_number: string;
  title: string;
  plain_text: string;
  currency: string;
};

export type PortalReport = {
  report_number: string;
  issued_on: string;
  total_amount: string;
  currency: string;
  storage_key: string;
  csv_key: string;
};

export type PortalViews = {
  invoices(): Promise<PortalInvoice[]>;
  findings(): Promise<PortalFinding[]>;
  reports(): Promise<PortalReport[]>;
};

/**
 * The only application path that connects as dd_portal.
 * The customer id is the one resolved from the Cognito sub. It is set for this transaction only.
 */
export async function withPortalQuery<T>(customer: PortalCustomer, run: (views: PortalViews) => Promise<T>): Promise<T> {
  if (!isPortalCustomer(customer)) throw new Error("The customer comes from the verified portal session.");
  const url = process.env.PORTAL_DATABASE_URL;
  if (url === undefined || url === "") throw new Error("PORTAL_DATABASE_URL is not set.");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.customer_id', $1, true)", [customer.customerId]);
    const views: PortalViews = {
      invoices: async () =>
        (
          await client.query<PortalInvoice>(
            `SELECT invoice_number, invoice_date::text AS invoice_date, currency, status,
                    disputable::text AS disputable
             FROM portal_invoice ORDER BY invoice_number`,
          )
        ).rows,
      findings: async () =>
        (
          await client.query<PortalFinding>(
            `SELECT invoice_number, title, plain_text, currency
             FROM portal_finding ORDER BY invoice_number, plain_text`,
          )
        ).rows,
      reports: async () =>
        (
          await client.query<PortalReport>(
            `SELECT report_number, issued_on::text AS issued_on, total_amount::text AS total_amount,
                    currency, storage_key, csv_key
             FROM portal_report ORDER BY report_number`,
          )
        ).rows,
    };
    const result = await run(views);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
