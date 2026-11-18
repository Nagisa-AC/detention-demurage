"use client";

import { useMemo, useState } from "react";
import { initials } from "../../../initials";

export type QueueRow = {
  id: string;
  customer: string;
  invoiceNumber: string;
  billingParty: string;
  pageCount: number;
  total: string | null;
  openCount: number;
  received: string;
};

export type ManualRow = {
  id: string;
  customer: string;
  received: string;
};

export type ApprovedRow = {
  id: string;
  customer: string;
  invoiceNumber: string;
  billingParty: string;
  pageCount: number;
  total: string | null;
  received: string;
};

type Tab = "waiting" | "manual" | "approved";

export function QueueView({
  waiting,
  manual,
  approved,
}: {
  waiting: QueueRow[];
  manual: ManualRow[];
  approved: ApprovedRow[];
}) {
  const [tab, setTab] = useState<Tab>("waiting");
  const [query, setQuery] = useState("");
  const [customer, setCustomer] = useState("all");
  const customers = useMemo(() => {
    const names = new Set<string>();
    for (const row of waiting) names.add(row.customer);
    for (const row of manual) names.add(row.customer);
    for (const row of approved) names.add(row.customer);
    return [...names].sort((left, right) => left.localeCompare(right));
  }, [waiting, manual, approved]);
  const needle = query.trim().toLowerCase();
  const waitingShown = waiting.filter((row) => matches(needle, customer, row.customer, row.invoiceNumber, row.billingParty));
  const manualShown = manual.filter((row) => matches(needle, customer, row.customer, "no text layer", ""));
  const approvedShown = approved.filter((row) => matches(needle, customer, row.customer, row.invoiceNumber, row.billingParty));
  const visible = tab === "waiting" ? waitingShown.length : tab === "manual" ? manualShown.length : approvedShown.length;

  return (
    <>
      <div className="title" style={{ paddingTop: 26 }}>
        <h1>Review queue</h1>
        <div className="meta">Oldest first</div>
      </div>
      <div className="filters" style={{ paddingTop: 0 }}>
        <div className="f" style={{ width: 340 }}>
          <label className="mono" htmlFor="queue-search">
            Search
          </label>
          <div className="input">
            <SearchIcon />
            <input
              id="queue-search"
              value={query}
              placeholder="Invoice or customer"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="f" style={{ width: 240 }}>
          <label className="mono" htmlFor="queue-customer">
            Customer
          </label>
          <div className="input">
            <select id="queue-customer" value={customer} onChange={(event) => setCustomer(event.target.value)}>
              <option value="all">All customers</option>
              {customers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="right">
          {visible} {visible === 1 ? "item" : "items"}
        </div>
      </div>
      <div className="card">
        <div className="tabs" role="tablist">
          <button type="button" className={tab === "waiting" ? "tab on" : "tab"} onClick={() => setTab("waiting")}>
            Waiting <span className="count">{waiting.length}</span>
          </button>
          <button type="button" className={tab === "manual" ? "tab on" : "tab"} onClick={() => setTab("manual")}>
            Needs manual entry <span className="count">{manual.length}</span>
          </button>
          <button type="button" className={tab === "approved" ? "tab on" : "tab"} onClick={() => setTab("approved")}>
            Approved today <span className="count">{approved.length}</span>
          </button>
        </div>
        {tab === "waiting" ? <WaitingTable rows={waitingShown} /> : null}
        {tab === "manual" ? <ManualTable rows={manualShown} /> : null}
        {tab === "approved" ? <ApprovedTable rows={approvedShown} /> : null}
        <div className="foot">An invoice counts only after a person approves it</div>
      </div>
    </>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.5 10.5 13.5 13.5" />
    </svg>
  );
}

function WaitingTable({ rows }: { rows: QueueRow[] }) {
  if (rows.length === 0) return <p className="empty">No invoices are waiting for review.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Invoice</th>
          <th>Customer</th>
          <th className="r">Pages</th>
          <th className="r">Total</th>
          <th>Needs a decision</th>
          <th>Received</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <a className="inv" href={`/review/${row.id}`}>
                <span className="badge">{initials(row.billingParty)}</span>
                <span>
                  <span className="n">
                    <span className="mono2">{row.invoiceNumber}</span>
                    <span className="tag">Waiting</span>
                  </span>
                  <span className="sub">{row.billingParty}</span>
                </span>
              </a>
            </td>
            <td>{row.customer}</td>
            <td className="r">{row.pageCount}</td>
            <td className="r">{row.total === null ? <span className="none">—</span> : row.total}</td>
            <td>
              {row.openCount === 0 ? (
                <span className="st good">Ready</span>
              ) : (
                <span className="st warn">
                  {row.openCount} {row.openCount === 1 ? "needs" : "need"} a decision
                </span>
              )}
            </td>
            <td>{row.received}</td>
            <td className="r">
              <a className="btn" href={`/review/${row.id}`}>
                Review
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ManualTable({ rows }: { rows: ManualRow[] }) {
  if (rows.length === 0) return <p className="empty">Nothing needs manual entry.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Document</th>
          <th>Customer</th>
          <th className="r">Pages</th>
          <th className="r">Total</th>
          <th>Needs a decision</th>
          <th>Received</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <div className="inv">
                <span className="badge">{initials(row.customer)}</span>
                <span>
                  <span className="n">
                    <span className="mono2">No text layer</span>
                    <span className="tag">No text</span>
                  </span>
                  <span className="sub">No invoice was read</span>
                </span>
              </div>
            </td>
            <td>{row.customer}</td>
            <td className="r none">—</td>
            <td className="r none">—</td>
            <td>
              <span className="st">Needs manual entry</span>
            </td>
            <td>{row.received}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ApprovedTable({ rows }: { rows: ApprovedRow[] }) {
  if (rows.length === 0) return <p className="empty">Nothing was approved today.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Invoice</th>
          <th>Customer</th>
          <th className="r">Pages</th>
          <th className="r">Total</th>
          <th>Status</th>
          <th>Received</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <a className="inv" href={`/review/${row.id}`}>
                <span className="badge">{initials(row.billingParty)}</span>
                <span>
                  <span className="n">
                    <span className="mono2">{row.invoiceNumber}</span>
                    <span className="tag">Approved</span>
                  </span>
                  <span className="sub">{row.billingParty}</span>
                </span>
              </a>
            </td>
            <td>{row.customer}</td>
            <td className="r">{row.pageCount}</td>
            <td className="r">{row.total === null ? <span className="none">—</span> : row.total}</td>
            <td>
              <span className="st good">Approved today</span>
            </td>
            <td>{row.received}</td>
            <td className="r">
              <a className="btn" href={`/review/${row.id}`}>
                Review
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function matches(needle: string, customer: string, rowCustomer: string, primary: string, secondary: string): boolean {
  if (customer !== "all" && rowCustomer !== customer) return false;
  if (needle === "") return true;
  return (
    rowCustomer.toLowerCase().includes(needle) ||
    primary.toLowerCase().includes(needle) ||
    secondary.toLowerCase().includes(needle)
  );
}
