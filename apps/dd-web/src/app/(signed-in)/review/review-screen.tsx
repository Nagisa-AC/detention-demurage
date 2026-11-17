"use client";

import { useState } from "react";
import { formatAmount } from "../../../review-format";
import { approveInvoice } from "./actions";
import { PdfPane } from "./pdf-pane";
import { DecisionBar } from "./decision-bar";

export type ScreenElement = {
  key: string;
  label: string;
  pill: string;
  tone: "settled" | "flag" | "export";
  needsDecision: boolean;
  text: string | null;
  page: number | null;
  storedState: string;
  grounded: boolean | null;
};

export type ScreenLine = {
  id: string;
  container: string;
  from: string;
  to: string;
  days: number;
  rate: string;
  amount: string;
  currency: string;
  grounded: boolean | null;
};

export function ReviewScreen({
  invoiceId,
  customerId,
  customer,
  invoiceNumber,
  billingParty,
  pageCount,
  invoiceDate,
  total,
  currency,
  position,
  openCount,
  elements,
  lines,
  approved,
}: {
  invoiceId: string;
  customerId: string;
  customer: string;
  invoiceNumber: string;
  billingParty: string;
  pageCount: number;
  invoiceDate: string | null;
  total: string | null;
  currency: string;
  position: string;
  openCount: number;
  elements: ScreenElement[];
  lines: ScreenLine[];
  approved: boolean;
}) {
  const [page, setPage] = useState(1);
  const [viewed, setViewed] = useState<ReadonlySet<number>>(() => new Set());
  const [selectedKey, setSelectedKey] = useState(elements.find((element) => element.needsDecision)?.key ?? elements[0]?.key ?? "");
  const [message, setMessage] = useState("");
  const selected = elements.find((element) => element.key === selectedKey) ?? null;
  const query = selected?.text ?? "";
  const settled = elements.length - openCount;

  function choose(element: ScreenElement): void {
    setSelectedKey(element.key);
    if (element.page !== null) setPage(element.page);
  }

  return (
    <div className="review">
      <div className="crumbs">
        {customer} › Review queue › {position}
      </div>
      <div className="review-head">
        <h1>Invoice {invoiceNumber}</h1>
        <p>
          {billingParty} · {pageCount} {pageCount === 1 ? "page" : "pages"}
          {invoiceDate === null ? "" : ` · invoice date ${invoiceDate}`}
          {total === null ? "" : ` · ${total} ${currency}`}
        </p>
        <span className={openCount === 0 ? "count-pill settled" : "count-pill"}>
          {openCount === 0
            ? "No elements need a decision"
            : `${openCount} ${openCount === 1 ? "element needs" : "elements need"} a decision`}
        </span>
      </div>
      <div className="review-main">
        <PdfPane
          url={`/api/review/${customerId}/invoices/${invoiceId}/pdf`}
          pageCount={pageCount}
          page={page}
          query={query}
          onPage={(next) => {
            if (next >= 1 && next <= pageCount) setPage(next);
          }}
          onViewed={(seen) => {
            setViewed((current) => {
              if (current.has(seen)) return current;
              const next = new Set(current);
              next.add(seen);
              return next;
            });
          }}
          viewedCount={viewed.size}
        />
        <div className="elements-column">
          <section className="elements" aria-label="Required elements">
            <div className="elements-head">
              <h2>20 required elements</h2>
              <span>
                {settled} present · {openCount} need a decision
              </span>
            </div>
            {elements.map((element) => (
              <button
                key={element.key}
                type="button"
                className={element.key === selectedKey ? "element-row selected" : "element-row"}
                onClick={() => choose(element)}
                aria-pressed={element.key === selectedKey}
              >
                <span className="element-copy">
                  <span>{element.label}</span>
                  {element.text === null ? null : <span className="element-text">{element.text}</span>}
                </span>
                <span className={`pill ${element.tone}`}>{element.pill}</span>
              </button>
            ))}
          </section>
          <section className="lines" aria-label="Charge lines">
            <div className="elements-head">
              <h2>Charge lines</h2>
            </div>
            {lines.length === 0 ? <p className="line-empty">No charge lines were read.</p> : null}
            {lines.map((line) => (
              <div key={line.id} className="line">
                <span>{line.container}</span>
                <span>
                  {line.from} to {line.to}
                </span>
                <span>
                  {line.days} × {formatAmount(line.rate)}
                </span>
                <span>
                  {formatAmount(line.amount)} {line.currency}
                </span>
                <span className={line.grounded === true ? "pill settled" : "pill flag"}>
                  {line.grounded === true ? "Grounded" : line.grounded === false ? "Not found on page" : "Not checked"}
                </span>
              </div>
            ))}
          </section>
        </div>
      </div>
      <DecisionBar
        invoiceId={invoiceId}
        selected={selected}
        pageCount={pageCount}
        approved={approved}
        openCount={openCount}
        viewed={[...viewed]}
        message={message}
        onMessage={setMessage}
        onApprove={async () => {
          const result = await approveInvoice(invoiceId, [...viewed]);
          setMessage(result.message);
        }}
      />
    </div>
  );
}
