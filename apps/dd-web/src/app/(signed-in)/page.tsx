import { redirect } from "next/navigation";
import { requireSession } from "../../session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
  await requireSession({ path: "/" });
  redirect("/customers");
}
