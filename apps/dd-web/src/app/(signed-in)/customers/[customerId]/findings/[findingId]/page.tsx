import { notFound } from "next/navigation";
import { formatAmount } from "../../../../../../review-format";
import { readFindingDetail } from "../../../../../../findings-data";
import { requireSession } from "../../../../../../session";
import { formatSavedAt } from "../../../../../../settings";
import { shellFrame } from "../../../../../../shell-frame";
import { Shell } from "../../../../../../shell";
import { FindingPdf } from "../../../finding-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function FindingDetailPage({ params }: { params: Promise<{ customerId: string; findingId: string }> }) {
  const session = await requireSession({ path: "/customers/finding" });
  const { customerId, findingId } = await params;
  const frame = await shellFrame();
  const finding = await readFindingDetail(customerId, findingId);
  if (finding === null) notFound();
  const confirmed = finding.inputs.filter((input) => input.confirmed).length;
  const differs = finding.otherAmount !== null && finding.otherAmount !== finding.amount;
  const missing = finding.otherAmount === null;
  const convention = finding.convention === "day0" ? "Day 0" : "Day 1";
  const otherName = finding.otherConvention === "day0" ? "Day 0" : "Day 1";

  return (
    <Shell session={session} active="customers" theme={frame.theme} waiting={frame.waiting}>
      <div className="crumb">
        <a href="/customers">Customers</a> / <a href={`/customers/${customerId}`}>{finding.customerName}</a> / Findings /{" "}
        <span className="mono2">{finding.invoiceNumber}</span>
      </div>
      <div className="title">
        <h1>{finding.title}</h1>
        <div className="meta mono">
          {finding.rule} · {finding.invoiceNumber}
        </div>
        <div className="actions">
          <span className={differs ? "pill warn" : "pill"}>
            {formatAmount(finding.amount)} {finding.currency} in dispute
          </span>
        </div>
      </div>
      {differs || missing ? (
        <p className="latest-checks">
          {convention} is {formatAmount(finding.amount)} {finding.currency}.{" "}
          {missing
            ? `${otherName} has no matching finding.`
            : `${otherName} is ${formatAmount(finding.otherAmount ?? finding.amount)} ${finding.currency}.`}
        </p>
      ) : null}
      <div className="grid2 finding-grid">
        <FindingPdf
          url={`/api/review/${customerId}/invoices/${finding.invoiceId}/pdf`}
          pageCount={finding.pageCount}
          page={finding.page}
          queries={finding.highlights}
          caption={`Invoice ${finding.invoiceNumber}, page ${finding.page}, as received.`}
        />
        <div>
          <section className="panel">
            <div className="ph">
              <h2>Why</h2>
            </div>
            <p className="why-body">{finding.explain}</p>
          </section>
          <section className="panel">
            <div className="ph">
              <h2>Math</h2>
            </div>
            <table className="calc">
              <tbody>
                <tr>
                  <td>Expected</td>
                  <td className="r">{finding.expected}</td>
                </tr>
                <tr>
                  <td>Actual</td>
                  <td className="r">{finding.actual}</td>
                </tr>
                <tr>
                  <td>In dispute</td>
                  <td className="r">
                    {formatAmount(finding.amount)} {finding.currency}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
          <section className="panel">
            <div className="ph">
              <h2>Rule</h2>
            </div>
            <div className="kv">
              <div className="k">Citation</div>
              <div className="mono2">{finding.citations.join(", ")}</div>
              <div className="k">Rule version</div>
              <div>
                {finding.rule} v{finding.ruleVersion}
              </div>
              <div className="k">Checks run</div>
              <div>
                {formatSavedAt(finding.ranAt)}
                {finding.settingsVersion === null ? "" : ` · settings v${finding.settingsVersion}`}
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="ph">
              <h2>Inputs a person confirmed</h2>
              <div className="side">
                {confirmed} of {finding.inputs.length}
              </div>
            </div>
            {finding.inputs.map((input) => (
              <div key={`${input.label}-${input.detail}`} className="row">
                <span className="l">
                  {input.label}
                  <span className="s">{input.detail}</span>
                </span>
                <span className={input.confirmed ? "st good" : "st"}>{input.confirmed ? "Confirmed" : "Not confirmed"}</span>
              </div>
            ))}
          </section>
        </div>
      </div>
    </Shell>
  );
}
