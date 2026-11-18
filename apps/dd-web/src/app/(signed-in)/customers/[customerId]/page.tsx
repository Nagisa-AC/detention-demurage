import { notFound } from "next/navigation";
import { formatChecksLine, readLatestChecks, type LatestChecks } from "../../../../rules-run";
import { formatAmount } from "../../../../review-format";
import { listInvoices } from "../../../../screen-data";
import { requireSession } from "../../../../session";
import { feePercent, formatSavedAt, readCustomerSettings } from "../../../../settings";
import { shellFrame } from "../../../../shell-frame";
import { Shell } from "../../../../shell";
import { initials } from "../../../../initials";
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
  const invoices = ((await listInvoices()) ?? []).filter((invoice) => invoice.customerId === customer.id);
  const current = customer.versions[0];
  const config = current?.config ?? null;
  const approved = invoices.filter((invoice) => invoice.approved).length;
  const meta = [
    config === null ? null : `Fee ${feePercent(config.fee_pct)}`,
    config === null ? null : `authorization valid to ${config.authorization.valid_until}`,
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
          <a className="btn" href={`/customers/${customer.id}/settings`}>
            Settings
          </a>
        </div>
      </div>
      <section className="stats">
        <div className="stat">
          <div className="k mono">Disputable</div>
          <Disputable checks={checks} />
          <div className="s">{checks?.status === "ok" ? dayNote(checks) : "No checks yet"}</div>
        </div>
        <div className="stat">
          <div className="k mono">Invoices</div>
          <div className="v">{invoices.length}</div>
          <div className="s">
            {approved} approved · {invoices.length - approved} waiting for review
          </div>
        </div>
        <div className="stat">
          <div className="k mono">Largest finding</div>
          <div className="v word">—</div>
          <div className="s">—</div>
        </div>
        <div className="stat">
          <div className="k mono">Recovered</div>
          <div className="v word">—</div>
          <div className="s">—</div>
        </div>
      </section>
      <ChecksBanner customerId={customer.id} checks={checks} />
      <div className="page">
        <div className="stack">
          <section className="panel" aria-label="Upload invoices">
            <div className="ph">
              <h2>Upload invoices</h2>
            </div>
            <UploadForm customers={[{ id: customer.id, displayName: customer.displayName }]} />
          </section>
          <section className="card" style={{ margin: 0 }}>
            <div className="ph">
              <h2>Invoices</h2>
              <div className="side">{invoices.length}</div>
            </div>
            {invoices.length === 0 ? <p className="empty">No invoices yet.</p> : null}
            {invoices.length === 0 ? null : (
              <table>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Billing party</th>
                    <th className="r">Pages</th>
                    <th className="r">Total</th>
                    <th>Status</th>
                    <th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        <a className="inv" href={`/review/${invoice.id}`}>
                          <span className="badge">{initials(invoice.billingParty)}</span>
                          <span>
                            <span className="n mono2">{invoice.number}</span>
                            <span className="sub">{invoice.pageCount === 1 ? "1 page" : `${invoice.pageCount} pages`}</span>
                          </span>
                        </a>
                      </td>
                      <td>{invoice.billingParty}</td>
                      <td className="r">{invoice.pageCount}</td>
                      <td className="r">
                        {invoice.total === null ? <span className="none">—</span> : `${formatAmount(invoice.total)} ${invoice.currency}`}
                      </td>
                      <td>
                        <span className={invoice.approved ? "st good" : "st warn"}>{invoice.approved ? "Approved" : "Waiting"}</span>
                      </td>
                      <td>{formatSavedAt(invoice.receivedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </Shell>
  );
}

function Disputable({ checks }: { checks: LatestChecks | null }) {
  if (checks === null || checks.status !== "ok" || checks.day1 === "none") return <div className="v word">—</div>;
  const match = /^(-?\d[\d,]*\.\d{2}) ([A-Z]{3})$/.exec(checks.day1);
  if (match === null) return <div className="v word">{checks.day1}</div>;
  return (
    <div className="v">
      {formatAmount(match[1] ?? checks.day1)}
      <small>{match[2]}</small>
    </div>
  );
}

function dayNote(checks: Extract<LatestChecks, { status: "ok" }>): string {
  if (checks.day1Findings === checks.day0Findings && checks.day1 === checks.day0) return "Day 1 count";
  return `Day 1 count · day 0 gives ${checks.day0}`;
}

function ChecksBanner({ customerId, checks }: { customerId: string; checks: LatestChecks | null }) {
  if (checks === null) return null;
  if (checks.status === "failed") {
    return (
      <div className="banner" role="status">
        <span>Checks failed — run again. {checks.message}</span>
        <RerunForm customerId={customerId} />
      </div>
    );
  }
  return (
    <p className="latest-checks">
      Latest checks: {formatSavedAt(checks.ranAt)} · {formatChecksLine(checks)}
    </p>
  );
}
