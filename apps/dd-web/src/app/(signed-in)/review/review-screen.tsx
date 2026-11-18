"use client";

import { useState } from "react";
import { elementStateSummary, formatAmount } from "../../../review-format";
import { approveInvoice } from "./actions";
import { PdfPane } from "./pdf-pane";
import { DecisionBar, type PartyChoice } from "./decision-bar";

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

function pillClass(tone: ScreenElement["tone"]): string {
  if (tone === "flag") return "st warn";
  if (tone === "export") return "st out";
  return "st";
}

function shownState(element: ScreenElement): string {
  if (element.pill === "Confirmed missing") return "confirmed_absent";
  if (element.pill === "Export only" || element.storedState === "not_applicable") return "not_applicable";
  return element.storedState;
}

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
  partyOptions,
  chosenPartyId,
  canBackfill,
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
  partyOptions: readonly PartyChoice[];
  chosenPartyId: string | null;
  canBackfill: boolean;
}) {
  const [page, setPage] = useState(1);
  const [viewed, setViewed] = useState<ReadonlySet<number>>(() => new Set());
  const [selectedKey, setSelectedKey] = useState(elements.find((element) => element.needsDecision)?.key ?? elements[0]?.key ?? "");
  const [message, setMessage] = useState("");
  const selected = elements.find((element) => element.key === selectedKey) ?? null;
  const query = selected?.text ?? "";
  const summary = elementStateSummary(elements.map(shownState));

  function choose(element: ScreenElement): void {
    setSelectedKey(element.key);
    if (element.page !== null) setPage(element.page);
  }

  return (
    <div className="review">
      <div className="crumb">
        <a href="/review">Review queue</a> / {customer} / {position}
      </div>
      <div className="title">
        <h1 className="mono">{invoiceNumber}</h1>
        <div className="meta">
          {billingParty} · {pageCount} {pageCount === 1 ? "page" : "pages"}
          {invoiceDate === null ? "" : ` · invoice date ${invoiceDate}`}
          {total === null ? "" : ` · ${total} ${currency}`}
        </div>
        <div className="actions">
          <span className={openCount === 0 ? "st" : "st warn"}>
            {openCount === 0
              ? "No elements need a decision"
              : `${openCount} ${openCount === 1 ? "element needs" : "elements need"} a decision`}
          </span>
        </div>
      </div>
      <div className="grid2">
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
        <div>
          <section className="panel" aria-label="Required elements">
            <div className="ph">
              <h2>20 required elements</h2>
              <div className="side">{summary}</div>
            </div>
            {elements.map((element) => (
              <button
                key={element.key}
                type="button"
                className={element.key === selectedKey ? "row sel" : "row"}
                onClick={() => choose(element)}
                aria-pressed={element.key === selectedKey}
              >
                <span className="l">
                  {element.label}
                  {element.text === null ? (
                    element.pill === "Suggested missing" || element.pill === "Confirmed missing" ? (
                      <span className="s">Not on the page</span>
                    ) : null
                  ) : (
                    <span className="s">{element.text}</span>
                  )}
                </span>
                <span className={pillClass(element.tone)}>{element.pill}</span>
              </button>
            ))}
          </section>
          <section className="panel" style={{ marginTop: 20 }} aria-label="Charge lines">
            <div className="ph">
              <h2>Charge lines</h2>
              <div className="side">
                {lines.length} {lines.length === 1 ? "line" : "lines"}
              </div>
            </div>
            {lines.length === 0 ? <p className="empty">No charge lines were read.</p> : null}
            {lines.map((line) => (
              <div key={line.id} className="row">
                <span className="l mono2">
                  {line.container}
                  <span className="s">
                    {line.from} to {line.to} · {line.days} × {formatAmount(line.rate)}
                  </span>
                </span>
                <span className="line-amount">{formatAmount(line.amount)}</span>
                <span className={line.grounded === true ? "st good" : line.grounded === false ? "st warn" : "st"}>
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
        printedName={billingParty}
        partyOptions={partyOptions}
        chosenPartyId={chosenPartyId}
        canBackfill={canBackfill}
      />
    </div>
  );
}
