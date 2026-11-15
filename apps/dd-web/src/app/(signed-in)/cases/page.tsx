import { requireSession } from "../../../session";
import { Shell } from "../../../shell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CasesPage() {
  const session = await requireSession({ path: "/cases" });
  return <Shell session={session} active="cases" />;
}
