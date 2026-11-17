import { readQueue, withReviewDb } from "../../../review-data";
import { requireSession } from "../../../session";
import { Shell } from "../../../shell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ReviewPage() {
  const session = await requireSession({ path: "/review" });
  const queue = (await withReviewDb(readQueue)) ?? { invoices: [], manual: [] };
  return (
    <Shell session={session} active="review">
      <div className="queue">
        <h1>Review queue</h1>
        {queue.invoices.length === 0 ? <p>No invoices are waiting for review.</p> : null}
        <div className="queue-list">
          {queue.invoices.map((invoice) => (
            <a key={invoice.id} className="queue-row" href={`/review/${invoice.id}`}>
              <span>{invoice.customer}</span>
              <span>{invoice.invoiceNumber}</span>
              <span>{invoice.billingParty}</span>
              <span>
                {invoice.pageCount} {invoice.pageCount === 1 ? "page" : "pages"}
              </span>
              <span>
                {invoice.openCount} {invoice.openCount === 1 ? "element needs" : "elements need"} a decision
              </span>
            </a>
          ))}
        </div>
        {queue.manual.length === 0 ? null : (
          <section className="manual" aria-label="Needs manual entry">
            <h2>Needs manual entry</h2>
            <div className="queue-list">
              {queue.manual.map((document) => (
                <div key={document.id} className="queue-row manual-row">
                  <span>{document.customer}</span>
                  <span className="pill flag">Needs manual entry</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Shell>
  );
}
