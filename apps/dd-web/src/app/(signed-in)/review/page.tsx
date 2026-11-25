import { readQueue, withReviewDb } from "../../../review-data";
import { formatAmount } from "../../../review-format";
import { isSameEtDay, listInvoices } from "../../../screen-data";
import { requireSession } from "../../../session";
import { formatSavedAt } from "../../../settings";
import { shellFrame } from "../../../shell-frame";
import { Shell } from "../../../shell";
import { QueueView, type ApprovedRow, type ManualRow, type QueueRow } from "./queue-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ReviewPage() {
  const session = await requireSession({ path: "/review" });
  const frame = await shellFrame();
  const queue = (await withReviewDb(readQueue)) ?? { invoices: [], manual: [] };
  const invoices = (await listInvoices()) ?? [];
  const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const waiting: QueueRow[] = queue.invoices.map((invoice) => {
    const stored = byId.get(invoice.id);
    return {
      id: invoice.id,
      customer: invoice.customer,
      invoiceNumber: invoice.invoiceNumber,
      billingParty: invoice.billingParty,
      pageCount: invoice.pageCount,
      total: stored?.total == null ? null : `${formatAmount(stored.total)} ${stored.currency}`,
      openCount: invoice.openCount,
      received: formatSavedAt(invoice.createdAt),
    };
  });
  const manual: ManualRow[] = queue.manual.map((document) => ({
    id: document.id,
    customer: document.customer,
    received: formatSavedAt(document.receivedAt),
    ...(document.label === undefined ? {} : { label: document.label }),
  }));
  const approved: ApprovedRow[] = invoices
    .filter((invoice) => invoice.approved && invoice.approvedAt !== null && isSameEtDay(invoice.approvedAt))
    .map((invoice) => ({
      id: invoice.id,
      customer: invoice.customer,
      invoiceNumber: invoice.number,
      billingParty: invoice.billingParty,
      pageCount: invoice.pageCount,
      total: invoice.total === null ? null : `${formatAmount(invoice.total)} ${invoice.currency}`,
      received: formatSavedAt(invoice.receivedAt),
    }));
  return (
    <Shell session={session} active="review" theme={frame.theme} waiting={frame.waiting}>
      <QueueView waiting={waiting} manual={manual} approved={approved} />
    </Shell>
  );
}
