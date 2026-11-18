import { notFound } from "next/navigation";
import { ReviewError } from "dd-core";
import { readBillingChoice, readInvoice, readQueue, withReviewDb } from "../../../../review-data";
import { formatAmount, sumAmounts } from "../../../../review-format";
import { presentReview } from "../../../../review-view";
import { requireSession } from "../../../../session";
import { Shell } from "../../../../shell";
import { ReviewScreen } from "../review-screen";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function InvoiceReviewPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const session = await requireSession({ path: "/review/invoice" });
  const { invoiceId } = await params;
  const loaded = await withReviewDb(async (sql) => {
    const invoice = await readInvoice(sql, invoiceId);
    if (invoice === null) return null;
    const queue = await readQueue(sql);
    const billing = await readBillingChoice(sql, invoice);
    return { invoice, queue, billing };
  });
  if (loaded === null) notFound();
  const { invoice, queue, billing } = loaded;
  let replay: ReturnType<typeof presentReview>;
  try {
    replay = presentReview({
      documentHash: invoice.documentHash,
      header: {
        invoiceNumber: invoice.invoiceNumber,
        billingParty: invoice.billingParty,
        billedParty: invoice.billedParty,
        currency: invoice.currency,
        pageCount: invoice.pageCount,
      },
      rows: invoice.rows,
      decisions: invoice.decisions,
    });
  } catch (error) {
    if (error instanceof ReviewError) {
      return (
        <Shell session={session} active="review">
          <p>This invoice cannot be reviewed.</p>
        </Shell>
      );
    }
    throw error;
  }
  const index = queue.invoices.findIndex((item) => item.id === invoice.id);
  const position = invoice.approved
    ? "Approved"
    : index === -1
      ? "Review queue"
      : `${index + 1} of ${queue.invoices.length}`;
  const totalDue = invoice.rows.find((row) => row.elementKey === "total_due");
  const total =
    totalDue?.value !== null && totalDue?.value !== undefined && totalDue.value !== ""
      ? formatAmount(totalDue.value)
      : sumAmounts(invoice.lines.map((line) => line.amount));
  return (
    <Shell session={session} active="review">
      <ReviewScreen
        invoiceId={invoice.id}
        customerId={invoice.customerId}
        customer={invoice.customer}
        invoiceNumber={invoice.invoiceNumber}
        billingParty={invoice.billingParty}
        pageCount={invoice.pageCount}
        invoiceDate={invoice.invoiceDate}
        total={total}
        currency={invoice.currency}
        position={position}
        openCount={replay.openCount}
        elements={replay.elements}
        lines={invoice.lines}
        approved={invoice.approved}
        partyOptions={billing.options}
        chosenPartyId={billing.chosenPartyId}
        canBackfill={billing.canBackfill}
      />
    </Shell>
  );
}
