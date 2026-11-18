import { readFirmProfile } from "../../../firm";
import { requireSession } from "../../../session";
import { formatSavedAt } from "../../../settings";
import { shellFrame } from "../../../shell-frame";
import { Shell } from "../../../shell";
import { FirmForm } from "./firm-form";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function FirmPage() {
  const session = await requireSession({ path: "/firm" });
  const frame = await shellFrame();
  const firm = await readFirmProfile();
  return (
    <Shell session={session} active="customers" theme={frame.theme} waiting={frame.waiting}>
      <div className="crumb">Firm</div>
      <div className="title">
        <h1>Firm</h1>
        <div className="meta">{firm === null ? "No profile yet" : `Version ${firm.version} · ${formatSavedAt(firm.createdAt)}`}</div>
      </div>
      <div className="page">
        <section className="panel">
          <FirmForm
            firmName={firm?.firmName ?? ""}
            cityState={firm?.cityState ?? ""}
            replyTo={firm?.replyTo ?? ""}
            signerName={firm?.signerName ?? ""}
            signerTitle={firm?.signerTitle ?? ""}
          />
        </section>
      </div>
    </Shell>
  );
}
