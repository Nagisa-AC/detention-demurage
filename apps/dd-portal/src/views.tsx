import type { HomeModel, InvoiceDetail, InvoiceRow, Status } from "./model";
import { formatMoney, statusLabel } from "./model";

export function HomeView({ model }: { model: HomeModel }) {
  return (
    <>
      <h1>Welcome back</h1>
      <div className="sub">Here&apos;s where your container fee invoices stand.</div>
      <div className="stats">
        <div className="stat">
          <div className="k">Invoices received</div>
          <div className="v">{model.received}</div>
          <div className="s">in your account</div>
        </div>
        <div className="stat">
          <div className="k">Being checked</div>
          <div className="v">{model.checking}</div>
          <div className="s">usually 2–3 business days</div>
        </div>
        <div className="stat">
          <div className="k">Disputable</div>
          <div className="v">{model.disputableLabel}</div>
          <div className="s">{model.disputableNote}</div>
        </div>
      </div>
      <div className="card">
        <div className="ch">Recent invoices</div>
        {model.recent.length === 0 ? <div className="empty">No invoices yet.</div> : <InvoiceTable rows={model.recent} />}
      </div>
    </>
  );
}

export function InvoiceListView({
  rows,
  total,
  search,
  status,
}: {
  rows: InvoiceRow[];
  total: number;
  search: string;
  status: Status | null;
}) {
  return (
    <>
      <h1>Invoices</h1>
      <div className="sub">
        {total} {total === 1 ? "invoice" : "invoices"} · every one is reviewed by a person before it&apos;s checked.
      </div>
      <form className="filters" action="/invoices" method="get">
        <input className="field" name="q" defaultValue={search} placeholder="Search invoice number" aria-label="Search invoice number" />
        <select className="input" name="status" defaultValue={status ?? ""} aria-label="Status">
          <option value="">All statuses</option>
          <option value="Received">Received</option>
          <option value="Being checked">Being checked</option>
          <option value="Checked">Checked</option>
        </select>
        <button className="btn" type="submit">
          Apply
        </button>
      </form>
      <div className="card">
        {rows.length === 0 ? <div className="empty">No invoices match.</div> : <InvoiceTable rows={rows} />}
      </div>
    </>
  );
}

export function InvoiceDetailView({ detail }: { detail: InvoiceDetail }) {
  const { invoice } = detail;
  const date = invoice.invoiceDate === null ? "Date not shown" : formatDate(invoice.invoiceDate);
  return (
    <>
      <div className="crumb">
        <a href="/invoices">Invoices</a> / {invoice.invoiceNumber}
      </div>
      <h1 className="mono">{invoice.invoiceNumber}</h1>
      <div className="sub">
        {date} · {invoice.currency}
      </div>
      <div className="card">
        <Timeline status={invoice.status} />
      </div>
      {detail.reviewing ? (
        <div className="card">
          <div className="find">
            <h4>We&apos;re reviewing this invoice.</h4>
            <p>A person checks every invoice before anything is marked checked.</p>
          </div>
        </div>
      ) : null}
      {invoice.status === "Checked" ? (
        <div className="card">
          <div className="ch">
            What we found
            {invoice.disputable === null ? null : (
              <span className="sp amt">{formatMoney(invoice.disputable, invoice.currency)} disputable</span>
            )}
          </div>
          {detail.findings.length === 0 ? (
            <div className="find">
              <h4>We checked this invoice</h4>
              <p>Nothing here needs a dispute.</p>
            </div>
          ) : (
            detail.findings.map((finding) => (
              <div className="find" key={`${finding.title}-${finding.plainText}`}>
                <h4>{finding.title}</h4>
                <p>{finding.plainText}</p>
              </div>
            ))
          )}
        </div>
      ) : null}
    </>
  );
}

export function MissingInvoice() {
  return (
    <>
      <div className="crumb">
        <a href="/invoices">Invoices</a>
      </div>
      <h1>That invoice isn&apos;t in your account.</h1>
    </>
  );
}

function InvoiceTable({ rows }: { rows: InvoiceRow[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Invoice</th>
          <th>Date</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.invoiceNumber}>
            <td className="mono">
              <a href={`/invoices/${encodeURIComponent(row.invoiceNumber)}`}>{row.invoiceNumber}</a>
            </td>
            <td>{row.invoiceDate === null ? "—" : formatDate(row.invoiceDate)}</td>
            <td>
              <span className={`pill ${pillClass(row)}`}>{statusLabel(row)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Timeline({ status }: { status: InvoiceRow["status"] }) {
  const steps: InvoiceRow["status"][] = ["Received", "Being checked", "Checked"];
  const current = steps.indexOf(status);
  return (
    <div className="tl">
      {steps.map((step, index) => {
        const done = index <= current;
        const cur = index === current;
        const className = `st${done ? " done" : ""}${cur ? " cur" : ""}`;
        return (
          <div className={className} key={step}>
            <div className="c" />
            {step}
          </div>
        );
      })}
    </div>
  );
}

function pillClass(row: InvoiceRow): string {
  if (row.status === "Received") return "p-recv";
  if (row.status === "Being checked") return "p-rev";
  if (row.disputable !== null) return "p-find";
  return "p-ok";
}

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match === null) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(match[2]) - 1] ?? match[2];
  return `${month} ${Number(match[3])}, ${match[1]}`;
}
