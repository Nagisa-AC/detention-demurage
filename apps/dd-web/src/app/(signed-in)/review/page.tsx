import { requireSession } from "../../../session";
import { Shell } from "../../../shell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ReviewPage() {
  const session = await requireSession({ path: "/review" });
  return <Shell session={session} active="review" />;
}
