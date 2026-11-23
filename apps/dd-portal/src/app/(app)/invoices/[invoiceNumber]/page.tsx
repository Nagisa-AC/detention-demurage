import { requireAccount } from "../../../../auth/session";
import { loadInvoice } from "../../../../model";
import { InvoiceDetailView, MissingInvoice } from "../../../../views";

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ invoiceNumber: string }>;
}) {
  const account = await requireAccount();
  const invoiceNumber = decodeURIComponent((await params).invoiceNumber);
  try {
    const detail = await loadInvoice(account.customer, invoiceNumber);
    if (detail === null) return <MissingInvoice />;
    return <InvoiceDetailView detail={detail} />;
  } catch {
    return <p>Something went wrong. Please try again.</p>;
  }
}
