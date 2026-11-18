import { requireSession } from "../../../session";
import { shellFrame } from "../../../shell-frame";
import { Shell } from "../../../shell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CasesPage() {
  const session = await requireSession({ path: "/cases" });
  const frame = await shellFrame();
  return (
    <Shell session={session} active="cases" theme={frame.theme} waiting={frame.waiting}>
      <div className="title" style={{ paddingTop: 26 }}>
        <h1>Cases</h1>
        <div className="meta">No cases yet.</div>
      </div>
    </Shell>
  );
}
