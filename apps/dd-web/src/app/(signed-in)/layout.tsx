import type { ReactNode } from "react";
import { requireSession } from "../../session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Extra gate on a full document load. Each page checks again, because this layout does not re-run on client navigation. */
export default async function SignedInLayout({ children }: { children: ReactNode }) {
  await requireSession({ path: "layout" });
  return children;
}
