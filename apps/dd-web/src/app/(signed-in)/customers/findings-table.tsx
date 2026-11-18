"use client";

import { useState } from "react";
import { amountsDiffer } from "../../../findings-view";
import { formatAmount, minusAmount } from "../../../review-format";
import type { FindingsBoard, FindingsTableRow } from "../../../findings-data";

type Tab = "all" | "findings" | "clear" | "review" | "manual" | "refused";
type Sort = "dispute" | "number" | "date" | "days";

export function FindingsTable({ customerId, board }: { customerId: string; board: FindingsBoard }) {
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("all");
  const [check, setCheck] = useState("any");
  const [sort, setSort] = useState<Sort>("dispute");
  const [findingsOnly, setFindingsOnly] = useState(false);
  const [day0, setDay0] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const convention = day0 ? "day0" : "day1";
  const carriers = unique(board.rows.map((row) => row.carrier));
  const checks = unique(board.rows.flatMap((row) => [...row.day0.checks, ...row.day1.checks].map((item) => item.label.split(" · ")[0] ?? item.label)));
  const searched = board.rows.filter((row) => matches(row, query, carrier, check, convention));
  const narrowed = findingsOnly ? searched.filter((row) => slice(row, convention).checks.length > 0) : searched;
  const counts = {
    all: narrowed.length,
    findings: narrowed.filter((row) => slice(row, convention).checks.length > 0).length,
    clear: narrowed.filter((row) => slice(row, convention).checks.length === 0).length,
    review: narrowed.filter((row) => slice(row, convention).needsInfo).length,
    manual: narrowed.filter((row) => slice(row, convention).manual).length,
    refused: narrowed.filter((row) => isRefused(row, convention)).length,
  };
  const visible = narrowed.filter((row) => inTab(row, tab, convention)).slice().sort((left, right) => compareRows(left, right, sort, convention));
  const total = convention === "day0" ? board.day0Total : board.day1Total;
  const other = convention === "day0" ? board.day1Total : board.day0Total;
  const largest = largestFinding(board.rows, convention);

  return (
    <>
      <section className="stats">
        <div className="stat">
          <div className="k mono">Disputable</div>
          <StatMoney total={total} />
          <div className="s">{dayNote(convention, total, other)}</div>
        </div>
        <div className="stat">
          <div className="k mono">Invoices</div>
          <div className="v">{board.approved + board.waiting}</div>
          <div className="s">
            {board.approved} approved · {board.waiting} waiting for review
          </div>
        </div>
        <div className="stat">
          <div className="k mono">Largest finding</div>
          {largest === null ? (
            <div className="v word">—</div>
          ) : (
            <div className="v word mono">{largest.number}</div>
          )}
          <div className="s">{largest === null ? "—" : `${largest.label} · ${formatAmount(largest.amount)}`}</div>
        </div>
        <div className="stat">
          <div className="k mono">Recovered</div>
          <div className="v word">—</div>
          <div className="s">—</div>
        </div>
      </section>
      <div className="filters">
        <div className="f" style={{ width: 340 }}>
          <label className="mono" htmlFor="finding-search">
            Search
          </label>
          <div className="input">
            <SearchIcon />
            <input
              id="finding-search"
              value={query}
              placeholder="Invoice, container or B/L"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="f" style={{ width: 220 }}>
          <label className="mono" htmlFor="finding-carrier">
            Carrier
          </label>
          <div className="input">
            <select id="finding-carrier" value={carrier} onChange={(event) => setCarrier(event.target.value)}>
              <option value="all">All carriers</option>
              {carriers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="f" style={{ width: 200 }}>
          <label className="mono" htmlFor="finding-check">
            Check
          </label>
          <div className="input">
            <select id="finding-check" value={check} onChange={(event) => setCheck(event.target.value)}>
              <option value="any">Any</option>
              {checks.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="f" style={{ width: 240 }}>
          <label className="mono" htmlFor="finding-sort">
            Sort by
          </label>
          <div className="input">
            <select id="finding-sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              <option value="dispute">Largest dispute</option>
              <option value="number">Invoice number</option>
              <option value="date">Invoice date</option>
              <option value="days">Days to invoice</option>
            </select>
          </div>
        </div>
        <div className="f">
          <label className="mono">Show</label>
          <div className="show">
            <label>
              <input type="checkbox" checked={findingsOnly} onChange={(event) => setFindingsOnly(event.target.checked)} />
              Findings only
            </label>
            <label>
              <input type="checkbox" checked={day0} onChange={(event) => setDay0(event.target.checked)} />
              Day 0 count
            </label>
          </div>
        </div>
        <div className="right">
          {visible.length} {visible.length === 1 ? "invoice" : "invoices"}
        </div>
      </div>
      <div className="card">
        <div className="tabs" role="tablist">
          <TabButton id="all" current={tab} count={counts.all} onSelect={setTab}>
            All
          </TabButton>
          <TabButton id="findings" current={tab} count={counts.findings} onSelect={setTab}>
            Findings
          </TabButton>
          <TabButton id="clear" current={tab} count={counts.clear} onSelect={setTab}>
            No findings
          </TabButton>
          <TabButton id="review" current={tab} count={counts.review} onSelect={setTab}>
            Needs review
          </TabButton>
          <TabButton id="manual" current={tab} count={counts.manual} onSelect={setTab}>
            Manual entry
          </TabButton>
          <TabButton id="refused" current={tab} count={counts.refused} onSelect={setTab}>
            Do not pursue
          </TabButton>
        </div>
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Check</th>
              <th className="r">Billed</th>
              <th className="r">In dispute</th>
              <th className="r">Invoice date</th>
              <th className="r">Days to invoice</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="none">
                  No invoices in this view.
                </td>
              </tr>
            ) : null}
            {visible.map((row) => (
              <FindingRow key={row.invoiceId} customerId={customerId} row={row} convention={convention} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FindingRow({ customerId, row, convention }: { customerId: string; row: FindingsTableRow; convention: "day0" | "day1" }) {
  const view = slice(row, convention);
  const other = slice(row, convention === "day0" ? "day1" : "day0");
  const warn = disputeDiffers(view, other);
  const shown = disputeOf(view);
  const correct = shown !== null && row.billed !== null ? minusAmount(row.billed, shown) : null;
  const href = view.findingId === null ? `/review/${row.invoiceId}` : `/customers/${customerId}/findings/${view.findingId}`;
  const sub = [row.carrier, row.container, row.pages > 1 ? `${row.pages} pages` : null].filter((part) => part !== null && part !== "").join(" · ");
  return (
    <tr>
      <td>
        <a className="inv" href={href}>
          <span className="badge">{row.initials}</span>
          <span>
            <span className="n">
              <span className="mono2">{row.number}</span>
              <span className="tag">Approved</span>
            </span>
            <span className="sub">{sub}</span>
          </span>
        </a>
      </td>
      <td>
        {view.checks.length === 0 ? <span className="check none">No findings</span> : null}
        {view.checks.map((item) => (
          <div key={item.label} className="check">
            {item.label}
            <div className="why">{item.reason}</div>
          </div>
        ))}
      </td>
      <td className="r">
        {correct !== null && row.billed !== null ? (
          <>
            <div className="strike">{formatAmount(row.billed)}</div>
            <div className="amt">{correct}</div>
          </>
        ) : (
          <div className="amt">{row.billed === null ? "—" : formatAmount(row.billed)}</div>
        )}
      </td>
      <td className="r">
        {view.recorded ? (
          shown !== null ? (
            <span className={warn ? "pill warn" : "pill"}>{formatAmount(shown)}</span>
          ) : (
            <span className="none">—</span>
          )
        ) : view.amounts.length === 0 ? (
          <span className="none">—</span>
        ) : (
          view.amounts.map((amount, index) => (
            <span key={`${amount}-${index}`} className={warn ? "pill warn" : "pill"}>
              {formatAmount(amount)}
            </span>
          ))
        )}
      </td>
      <td className="r">{row.invoiceDate ?? "—"}</td>
      <td className={view.daysWarn ? "r days-warn" : "r"}>{row.days ?? "—"}</td>
      <td className={statusOf(row, view, warn) === "Passed every check" ? "none" : undefined}>{statusOf(row, view, warn)}</td>
    </tr>
  );
}

function TabButton({
  id,
  current,
  count,
  onSelect,
  children,
}: {
  id: Tab;
  current: Tab;
  count: number;
  onSelect: (tab: Tab) => void;
  children: string;
}) {
  const on = current === id;
  return (
    <button type="button" className={on ? "tab on" : "tab"} role="tab" aria-selected={on} onClick={() => onSelect(id)}>
      {children} <span className="count">{count}</span>
    </button>
  );
}

function StatMoney({ total }: { total: { amount: string; currency: string } | null }) {
  if (total === null) return <div className="v word">—</div>;
  return (
    <div className="v">
      {formatAmount(total.amount)}
      <small>{total.currency}</small>
    </div>
  );
}

function dayNote(
  convention: "day0" | "day1",
  current: { amount: string; currency: string } | null,
  other: { amount: string; currency: string } | null,
): string {
  const name = convention === "day0" ? "Day 0 count" : "Day 1 count";
  const otherName = convention === "day0" ? "day 1" : "day 0";
  if (current === null || other === null || (current.amount === other.amount && current.currency === other.currency)) return name;
  return `${name} · ${otherName} gives ${formatAmount(other.amount)}`;
}

function largestFinding(rows: readonly FindingsTableRow[], convention: "day0" | "day1"): { number: string; label: string; amount: string } | null {
  const ranked = rows.flatMap((row) => {
    const view = slice(row, convention);
    if (view.recorded && (view.doNotPursue || view.supersededBy !== "")) return [];
    const stored = view.recorded ? view.disputable : null;
    if (stored !== null) {
      const cents = centsOf(stored);
      if (cents === null || cents <= 0) return [];
      return [{ number: row.number, label: view.checks[0]?.label.split(" · ")[0] ?? "Finding", amount: stored, cents }];
    }
    return view.amounts.flatMap((amount, index) => {
      const cents = centsOf(amount);
      if (cents === null) return [];
      const label = view.checks[index]?.label.split(" · ")[0] ?? view.checks[0]?.label ?? "Finding";
      return [{ number: row.number, label, amount, cents }];
    });
  });
  const best = ranked.reduce<(typeof ranked)[number] | null>((current, item) => (current === null || item.cents > current.cents ? item : current), null);
  return best === null ? null : { number: best.number, label: best.label, amount: best.amount };
}

function statusOf(row: FindingsTableRow, view: ReturnType<typeof slice>, warn: boolean): string {
  if (view.recorded ? view.doNotPursue : row.refused) return "Do not pursue";
  if (view.supersededBy !== "") return `Superseded by ${view.supersededBy}`;
  if (view.manual) return "Needs manual entry";
  if (view.needsInfo && view.checks.length === 0) return "Needs review";
  if (warn && view.checks.length > 0) return "Changes with day count";
  if (view.checks.length > 0) return "Ready for a case";
  return "Passed every check";
}

function inTab(row: FindingsTableRow, tab: Tab, convention: "day0" | "day1"): boolean {
  const view = slice(row, convention);
  if (tab === "findings") return view.checks.length > 0;
  if (tab === "clear") return view.checks.length === 0;
  if (tab === "review") return view.needsInfo;
  if (tab === "manual") return view.manual;
  if (tab === "refused") return isRefused(row, convention);
  return true;
}

function matches(row: FindingsTableRow, query: string, carrier: string, check: string, convention: "day0" | "day1"): boolean {
  if (carrier !== "all" && row.carrier !== carrier) return false;
  const view = slice(row, convention);
  if (check !== "any" && !view.checks.some((item) => (item.label.split(" · ")[0] ?? item.label) === check)) return false;
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [row.number, row.container ?? "", row.bl ?? ""].some((value) => value.toLowerCase().includes(needle));
}

function compareRows(left: FindingsTableRow, right: FindingsTableRow, sort: Sort, convention: "day0" | "day1"): number {
  if (sort === "number") return left.number.localeCompare(right.number);
  if (sort === "date") return (left.invoiceDate ?? "").localeCompare(right.invoiceDate ?? "");
  if (sort === "days") return (right.days ?? -1) - (left.days ?? -1);
  return disputeCents(slice(right, convention)) - disputeCents(slice(left, convention)) || left.number.localeCompare(right.number);
}

function disputeOf(view: ReturnType<typeof slice>): string | null {
  if (view.recorded && view.disputable !== null && view.disputable !== "0.00") return view.disputable;
  if (view.recorded) return null;
  return view.amounts.length === 1 ? (view.amounts[0] ?? null) : null;
}

function disputeDiffers(view: ReturnType<typeof slice>, other: ReturnType<typeof slice>): boolean {
  if (view.recorded && other.recorded && view.disputable !== null && other.disputable !== null) return view.disputable !== other.disputable;
  return amountsDiffer(view.amounts, other.amounts);
}

function disputeCents(view: ReturnType<typeof slice>): number {
  if (view.recorded && view.disputable !== null) return centsOf(view.disputable) ?? -1;
  return maxCents(view.amounts);
}

function isRefused(row: FindingsTableRow, convention: "day0" | "day1"): boolean {
  const view = slice(row, convention);
  return view.recorded ? view.doNotPursue : row.refused;
}

function slice(row: FindingsTableRow, convention: "day0" | "day1") {
  return convention === "day0" ? row.day0 : row.day1;
}

function maxCents(amounts: readonly string[]): number {
  let best = -1;
  for (const amount of amounts) {
    const cents = centsOf(amount);
    if (cents !== null && cents > best) best = cents;
  }
  return best;
}

function centsOf(amount: string): number | null {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(amount.trim());
  if (match === null) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 100 + Number(match[3]));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.5 10.5 13.5 13.5" />
    </svg>
  );
}
