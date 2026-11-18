import { readLatestChecks } from "../../../rules-run";
import { feePercent, readCustomerSettings } from "../../../settings";
import { listInvoices } from "../../../screen-data";
import { requireSession } from "../../../session";
import { shellFrame } from "../../../shell-frame";
import { Shell } from "../../../shell";
import { CustomersView, type CustomerListRow } from "./customers-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CustomersPage() {
  const session = await requireSession({ path: "/customers" });
  const frame = await shellFrame();
  const settings = await readCustomerSettings();
  const checks = await readLatestChecks();
  const invoices = (await listInvoices()) ?? [];
  const rows: CustomerListRow[] = settings.map((customer) => {
    const current = customer.versions[0];
    const owned = invoices.filter((invoice) => invoice.customerId === customer.id);
    return {
      id: customer.id,
      displayName: customer.displayName,
      configId: customer.configId,
      version: current?.version ?? null,
      fee: current?.config === null || current?.config === undefined ? null : feePercent(current.config.fee_pct),
      validUntil: current?.config?.authorization.valid_until ?? null,
      unreadable: current !== undefined && current.config === null,
      invoiceCount: owned.length,
      approvedCount: owned.filter((invoice) => invoice.approved).length,
      checks: checks.get(customer.id) ?? null,
    };
  });
  return (
    <Shell session={session} active="customers" theme={frame.theme} waiting={frame.waiting}>
      <CustomersView rows={rows} />
    </Shell>
  );
}
