import { listCustomers } from "../../../customers";
import { requireSession } from "../../../session";
import { Shell } from "../../../shell";
import { AddCustomerForm } from "./add-customer-form";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CustomersPage() {
  const session = await requireSession({ path: "/customers" });
  const customers = await listCustomers();
  return (
    <Shell session={session} active="customers">
      <div className="customers">
        <AddCustomerForm />
        {customers.length === 0 ? <p>No customers yet.</p> : <UploadForm customers={customers} />}
      </div>
    </Shell>
  );
}
