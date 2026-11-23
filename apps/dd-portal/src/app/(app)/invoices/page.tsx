import { requireAccount } from "../../../auth/session";
import { isStatus, loadInvoiceList } from "../../../model";
import { InvoiceListView } from "../../../views";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const account = await requireAccount();
  const params = await searchParams;
  const status = isStatus(params.status) ? params.status : null;
  const search = params.q ?? "";
  try {
    const list = await loadInvoiceList(account.customer, search, status);
    return <InvoiceListView rows={list.rows} total={list.total} search={search} status={status} />;
  } catch {
    return <p>Something went wrong. Please try again.</p>;
  }
}
