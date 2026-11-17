import { readCustomerSettings } from "../../../settings";
import { requireSession } from "../../../session";
import { Shell } from "../../../shell";
import { AddCustomerForm } from "./add-customer-form";
import { SettingsPanel } from "./settings-panel";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CustomersPage() {
  const session = await requireSession({ path: "/customers" });
  const settings = await readCustomerSettings();
  const customers = settings.map((customer) => ({ id: customer.id, displayName: customer.displayName }));
  return (
    <Shell session={session} active="customers">
      <div className="customers">
        <AddCustomerForm />
        {customers.length === 0 ? <p>No customers yet.</p> : <UploadForm customers={customers} />}
        {settings.map((customer) => (
          <SettingsPanel key={customer.id} customer={customer} />
        ))}
      </div>
    </Shell>
  );
}
