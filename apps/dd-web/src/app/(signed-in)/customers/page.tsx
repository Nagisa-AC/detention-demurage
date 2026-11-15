import { requireSession } from "../../../session";
import { Shell } from "../../../shell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CustomersPage() {
  const session = await requireSession({ path: "/customers" });
  return <Shell session={session} active="customers" />;
}
