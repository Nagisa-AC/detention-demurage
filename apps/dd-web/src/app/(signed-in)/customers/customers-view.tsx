"use client";

import { useMemo, useState } from "react";
import { initials } from "../../../initials";
import { formatAmount } from "../../../review-format";
import type { LatestChecks } from "../../../rules-run";
import { AddCustomerForm } from "./add-customer-form";

export type CustomerListRow = {
  id: string;
  displayName: string;
  configId: string;
  version: number | null;
  fee: string | null;
  validUntil: string | null;
  unreadable: boolean;
  invoiceCount: number;
  approvedCount: number;
  checks: LatestChecks | null;
};

export function CustomersView({ rows }: { rows: CustomerListRow[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("disputable");
  const [adding, setAdding] = useState(false);
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (needle === "") return true;
      return row.displayName.toLowerCase().includes(needle) || row.configId.toLowerCase().includes(needle);
    });
    return filtered.sort((left, right) => compareRows(left, right, sort));
  }, [rows, needle, sort]);
  const stats = portfolio(rows);

  return (
    <>
      <div className="title" style={{ paddingTop: 26 }}>
        <h1>Customers</h1>
        <div className="meta">
          {rows.length} {rows.length === 1 ? "customer" : "customers"}
        </div>
        <div className="actions">
          <button type="button" className="btn primary" aria-expanded={adding} onClick={() => setAdding((open) => !open)}>
            Add customer
          </button>
        </div>
      </div>
      {adding ? (
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="ph">
            <h2>Add customer</h2>
          </div>
          <AddCustomerForm />
        </div>
      ) : null}
      <section className="stats">
        <div className="stat">
          <div className="k mono">Disputable</div>
          <StatValue amount={stats.disputable} currency={stats.currency} />
          <div className="s">Day 1 · latest checks</div>
        </div>
        <div className="stat">
          <div className="k mono">Invoices</div>
          <div className="v">{stats.invoices}</div>
          <div className="s">
            {stats.approved} approved · {stats.waiting} waiting for review
          </div>
        </div>
        <div className="stat">
          <div className="k mono">Open cases</div>
          <div className="v word">—</div>
          <div className="s">—</div>
        </div>
        <div className="stat">
          <div className="k mono">Recovered</div>
          <div className="v word">—</div>
          <div className="s">—</div>
        </div>
      </section>
      <div className="filters">
        <div className="f" style={{ width: 340 }}>
          <label className="mono" htmlFor="customer-search">
            Search
          </label>
          <div className="input">
            <SearchIcon />
            <input
              id="customer-search"
              value={query}
              placeholder="Customer or config id"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="f" style={{ width: 240 }}>
          <label className="mono" htmlFor="customer-sort">
            Sort by
          </label>
          <div className="input">
            <select id="customer-sort" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="disputable">Most disputable</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>
        <div className="right">
          {shown.length} {shown.length === 1 ? "customer" : "customers"}
        </div>
      </div>
      <div className="card">
        {shown.length === 0 ? <p className="empty">{rows.length === 0 ? "No customers yet." : "No customers match."}</p> : null}
        {shown.length === 0 ? null : (
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Settings</th>
                <th className="r">Invoices</th>
                <th className="r">Disputable</th>
                <th className="r">Recovered</th>
                <th>Authorization</th>
                <th>Next deadline</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id}>
                  <td>
                    <a className="inv" href={`/customers/${row.id}`}>
                      <span className="badge">{initials(row.displayName)}</span>
                      <span>
                        <span className="n">{row.displayName}</span>
                        <span className="sub mono2">{row.configId}</span>
                      </span>
                    </a>
                  </td>
                  <td>{settingsCell(row)}</td>
                  <td className="r">{row.invoiceCount}</td>
                  <td className="r">{disputableCell(row.checks)}</td>
                  <td className="r none">—</td>
                  <td>{row.validUntil === null ? <span className="none">—</span> : `Valid to ${row.validUntil}`}</td>
                  <td className="none">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="foot">Disputable uses the latest day 1 checks for each customer</div>
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

function StatValue({ amount, currency }: { amount: string; currency: string | null }) {
  if (amount === "—") return <div className="v word">—</div>;
  return (
    <div className="v">
      {amount}
      {currency === null || currency === "" ? null : <small>{currency}</small>}
    </div>
  );
}

function settingsCell(row: CustomerListRow) {
  if (row.unreadable) return <span className="st warn">Cannot be shown</span>;
  if (row.version === null || row.fee === null) return <span className="st warn">No settings yet</span>;
  return `v${row.version} · fee ${row.fee}`;
}

function disputableCell(checks: LatestChecks | null) {
  if (checks === null || checks.status !== "ok") return <span className="none">—</span>;
  if (checks.day1 === "none") return <span className="none">—</span>;
  const differs = checks.day1Findings !== checks.day0Findings || checks.day1 !== checks.day0;
  return (
    <span>
      <span className="pill">{checks.day1}</span>
      {differs ? <span className="sub">day 0 {checks.day0}</span> : null}
    </span>
  );
}

function portfolio(rows: readonly CustomerListRow[]): { disputable: string; currency: string | null; invoices: number; approved: number; waiting: number } {
  let invoices = 0;
  let approved = 0;
  let cents = 0;
  let currency: string | null = null;
  let sawCheck = false;
  let blocked = false;
  for (const row of rows) {
    invoices += row.invoiceCount;
    approved += row.approvedCount;
    if (row.checks?.status !== "ok") continue;
    const parsed = parseMoney(row.checks.day1);
    if (parsed === "none") {
      sawCheck = true;
      continue;
    }
    if (parsed === null) {
      blocked = true;
      continue;
    }
    sawCheck = true;
    if (currency === null) currency = parsed.currency;
    else if (currency !== parsed.currency) blocked = true;
    cents += parsed.cents;
  }
  const waiting = invoices - approved;
  if (!sawCheck || blocked) return { disputable: "—", currency: null, invoices, approved, waiting };
  return { disputable: formatCents(cents), currency, invoices, approved, waiting };
}

function parseMoney(value: string): { cents: number; currency: string } | "none" | null {
  if (value === "none") return "none";
  const match = /^(-?)(\d+)\.(\d{2}) ([A-Z]{3})$/.exec(value);
  if (match === null) return null;
  const whole = Number(match[2]);
  const frac = Number(match[3]);
  const cents = whole * 100 + frac;
  return { cents: match[1] === "-" ? -cents : cents, currency: match[4] ?? "" };
}

function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return formatAmount(`${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`);
}

function compareRows(left: CustomerListRow, right: CustomerListRow, sort: string): number {
  if (sort === "name") return left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id);
  const delta = rank(right) - rank(left);
  if (delta !== 0) return delta;
  return left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id);
}

function rank(row: CustomerListRow): number {
  if (row.checks?.status !== "ok") return Number.NEGATIVE_INFINITY;
  const parsed = parseMoney(row.checks.day1);
  if (parsed === "none") return 0;
  if (parsed === null) return Number.NEGATIVE_INFINITY;
  return parsed.cents;
}
