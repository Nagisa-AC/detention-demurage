import { withPortalQuery, type PortalCustomer, type PortalFinding, type PortalInvoice } from "portal";

export type Status = "Received" | "Being checked" | "Checked";

export type InvoiceRow = {
  invoiceNumber: string;
  invoiceDate: string | null;
  currency: string;
  status: Status;
  disputable: string | null;
};

export type InvoiceDetail = {
  invoice: InvoiceRow;
  findings: { title: string; plainText: string }[];
  reviewing: boolean;
};

export type HomeModel = {
  displayName: string | null;
  received: number;
  checking: number;
  disputableLabel: string;
  disputableNote: string;
  recent: InvoiceRow[];
};

const STATUSES: readonly Status[] = ["Received", "Being checked", "Checked"];

export function knownStatus(value: string): Status {
  return STATUSES.find((status) => status === value) ?? "Being checked";
}

export function isStatus(value: string | undefined): value is Status {
  return STATUSES.some((status) => status === value);
}

export async function loadHome(customer: PortalCustomer): Promise<HomeModel> {
  const { invoices, profile } = await withPortalQuery(customer, async (views) => ({
    invoices: await views.invoices(),
    profile: await views.profile(),
  }));
  const rows = invoices.map(toRow);
  const checking = rows.filter((row) => row.status === "Being checked").length;
  const counted = rows.filter((row) => row.status === "Checked" && row.disputable !== null);
  return {
    displayName: profile?.display_name ?? null,
    received: rows.length,
    checking,
    disputableLabel: sumLabel(counted),
    disputableNote: counted.length === 1 ? "across 1 invoice" : `across ${counted.length} invoices`,
    recent: [...rows].sort(byDate).slice(0, 6),
  };
}

export async function loadInvoiceList(
  customer: PortalCustomer,
  search: string,
  status: Status | null,
): Promise<{ rows: InvoiceRow[]; total: number }> {
  const invoices = await withPortalQuery(customer, (views) => views.invoices());
  const rows = invoices.map(toRow);
  const needle = search.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (status !== null && row.status !== status) return false;
    if (needle !== "" && !row.invoiceNumber.toLowerCase().includes(needle)) return false;
    return true;
  });
  return { rows: filtered, total: rows.length };
}

export async function loadInvoice(customer: PortalCustomer, invoiceNumber: string): Promise<InvoiceDetail | null> {
  const { invoices, findings } = await withPortalQuery(customer, async (views) => ({
    invoices: await views.invoices(),
    findings: await views.findings(),
  }));
  const invoice = invoices.map(toRow).find((row) => row.invoiceNumber === invoiceNumber);
  if (invoice === undefined) return null;
  const checked = invoice.status === "Checked";
  return {
    invoice,
    findings: checked ? findings.filter((finding) => finding.invoice_number === invoice.invoiceNumber).map(toFinding) : [],
    reviewing: invoice.status === "Being checked",
  };
}

function toRow(invoice: PortalInvoice): InvoiceRow {
  return {
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.invoice_date,
    currency: invoice.currency,
    status: knownStatus(invoice.status),
    disputable: invoice.status === "Checked" ? invoice.disputable : null,
  };
}

function toFinding(finding: PortalFinding): { title: string; plainText: string } {
  return { title: finding.title, plainText: finding.plain_text };
}

function byDate(left: InvoiceRow, right: InvoiceRow): number {
  const a = left.invoiceDate ?? "";
  const b = right.invoiceDate ?? "";
  if (a !== b) return a < b ? 1 : -1;
  return left.invoiceNumber < right.invoiceNumber ? -1 : 1;
}

function sumLabel(rows: InvoiceRow[]): string {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.disputable === null) continue;
    const cents = toCents(row.disputable);
    if (cents === null) continue;
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + cents);
  }
  if (totals.size === 0) return formatMoney("0.00", "USD");
  return [...totals.entries()].map(([currency, cents]) => formatMoney(fromCents(cents), currency)).join(" · ");
}

export function formatMoney(amount: string, currency: string): string {
  const negative = amount.startsWith("-");
  const body = negative ? amount.slice(1) : amount;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(body);
  if (match === null) return amount;
  const whole = (match[1] ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (match[2] ?? "00").padEnd(2, "0");
  const prefix = currency === "USD" ? "$" : `${currency} `;
  return `${negative ? "-" : ""}${prefix}${whole}.${cents}`;
}

export function statusLabel(row: InvoiceRow): string {
  if (row.status === "Checked" && row.disputable !== null) {
    return `Checked — ${formatMoney(row.disputable, row.currency)} disputable`;
  }
  return row.status;
}

function toCents(amount: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (match === null) return null;
  const whole = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(cents)) return null;
  return whole * 100 + cents;
}

function fromCents(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}
