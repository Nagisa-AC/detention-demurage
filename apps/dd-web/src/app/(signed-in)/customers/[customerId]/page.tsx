import { realPdfLimits } from "dd-core";
import { notFound } from "next/navigation";
import { MAX_PDF_BYTES } from "../../../../intake/limits";
import { readUploadRefusals } from "../../../../intake/refusals";
import { readLatestChecks } from "../../../../rules-run";
import { readFindingsBoard } from "../../../../findings-data";
import { requireSession } from "../../../../session";
import { feePercent, formatSavedAt, readCustomerSettings } from "../../../../settings";
import { shellFrame } from "../../../../shell-frame";
import { Shell } from "../../../../shell";
import { exportStatus } from "../../../../report/export";
import { readPublishState } from "../../../../publish";
import { ExportButton } from "../export-button";
import { FindingsTable } from "../findings-table";
import { PublishButton } from "../publish-button";
import { RerunForm } from "../rerun-form";
import { UploadForm } from "../upload-form";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CustomerPage({ params }: { params: Promise<{ customerId: string }> }) {
  const session = await requireSession({ path: "/customers/customer" });
  const { customerId } = await params;
  const frame = await shellFrame();
  const settings = await readCustomerSettings();
  const customer = settings.find((item) => item.id === customerId);
  if (customer === undefined) notFound();
  const checks = (await readLatestChecks()).get(customer.id) ?? null;
  const board = await readFindingsBoard(customer.id);
  const exported = await exportStatus(customer.id);
  const publication = await readPublishState(customer.id);
  const current = customer.versions[0];
  const config = current?.config ?? null;
  const acceptsReal = config?.accepts_real_documents === true;
  const refusals = await readUploadRefusals(customer.id);
  const meta = [
    config === null ? null : `Fee ${feePercent(config.fee_pct)}`,
    config === null ? null : `authorization valid to ${config.authorization.valid_until}`,
    acceptsReal ? "Real documents on" : "Real documents off",
    current === undefined ? null : `settings v${current.version}`,
    checks?.status === "ok" ? `checks ran ${formatSavedAt(checks.ranAt)}` : null,
  ].filter((part): part is string => part !== null);

  return (
    <Shell session={session} active="customers" theme={frame.theme} waiting={frame.waiting}>
      <div className="crumb">
        <a href="/customers">Customers</a> / {customer.displayName}
      </div>
      <div className="title">
        <h1>{customer.displayName}</h1>
        <div className="meta">{meta.length === 0 ? customer.configId : meta.join(" · ")}</div>
        <div className="actions">
          <RerunForm customerId={customer.id} />
          <a className="btn" href={`/customers/${customer.id}/settings`}>
            Settings
          </a>
          <ExportButton customerId={customer.id} phase={exported.phase} reason={exported.reason} latest={exported.latest} />
          <PublishButton customerId={customer.id} state={publication} />
        </div>
      </div>
      {checks?.status === "failed" ? (
        <div className="banner" role="status">
          <span>Checks failed — run again. {checks.message}</span>
        </div>
      ) : null}
      {board === null ? <p className="empty">No invoices yet.</p> : <FindingsTable customerId={customer.id} board={board} />}
      <div className="page">
        <section className="panel upload-panel" aria-label="Upload invoices">
          <div className="ph">
            <h2>Upload invoices</h2>
          </div>
          <UploadForm
            customers={[{ id: customer.id, displayName: customer.displayName }]}
            maxBytes={acceptsReal ? realPdfLimits().maxBytes : MAX_PDF_BYTES}
          />
        </section>
        <section className="panel" aria-label="Refused uploads">
          <div className="ph">
            <h2>Refused uploads</h2>
          </div>
          {refusals.length === 0 ? (
            <p className="empty">No refused uploads.</p>
          ) : (
            <ul className="history">
              {refusals.map((refusal) => (
                <li key={refusal.id}>
                  {formatSavedAt(refusal.at)} — {refusal.label}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  );
}
