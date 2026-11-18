"use client";

import { useState } from "react";
import type { SettingsCards } from "../../../settings-cards";
import { SettingsForm } from "./settings-form";

export function SettingsView({ cards }: { cards: SettingsCards }) {
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  return (
    <>
      <div className="crumb">
        <a href="/customers">Customers</a> / <a href={`/customers/${cards.customerId}`}>{cards.displayName}</a> / Settings
      </div>
      <div className="title">
        <h1>Settings</h1>
        <div className="meta">{cards.headline}</div>
        <div className="actions">
          <button type="button" className="btn" aria-expanded={history} onClick={() => setHistory((open) => !open)}>
            Version history
          </button>
          <button type="button" className="btn primary" aria-expanded={editing} onClick={() => setEditing((open) => !open)}>
            Edit settings
          </button>
        </div>
      </div>
      {history ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="ph">
            <h2>Version history</h2>
          </div>
          {cards.history.length === 0 ? <p className="empty">No versions yet.</p> : null}
          {cards.history.length === 0 ? null : (
            <ul className="history">
              {cards.history.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      <div className="grid2" style={{ paddingBottom: 40 }}>
        <div className="stack">
          <section className="panel">
            <div className="ph">
              <h2>Engagement</h2>
            </div>
            {cards.unreadable !== null ? <p className="empty">{cards.unreadable}</p> : null}
            {cards.engagement === null && cards.unreadable === null ? <p className="empty">No settings yet.</p> : null}
            {cards.engagement === null ? null : (
              <div className="kv">
                {cards.engagement.map((fact) => (
                  <Fact key={fact.label} label={fact.label} value={fact.value} />
                ))}
              </div>
            )}
          </section>
          <section className="panel">
            <div className="ph">
              <h2>Carriers</h2>
              <div className="side">
                {cards.carriers.length} {cards.carriers.length === 1 ? "carrier" : "carriers"}
              </div>
            </div>
            {cards.carriers.length === 0 ? <p className="empty">No carriers yet.</p> : null}
            {cards.carriers.map((carrier) => (
              <div key={`${carrier.pursue ? "pursue" : "skip"}-${carrier.id}`} className="row">
                <div className="l mono2">{carrier.id}</div>
                <span className={carrier.pursue ? "st good" : "st out"}>{carrier.pursue ? "Pursue" : "Do not pursue"}</span>
              </div>
            ))}
          </section>
        </div>
        <div className="stack">
          <section className="panel">
            <div className="ph">
              <h2>Contract terms</h2>
              <div className="side">
                {cards.terms.length} {cards.terms.length === 1 ? "term" : "terms"}
              </div>
            </div>
            {cards.terms.length === 0 ? <p className="empty">No contract terms.</p> : null}
            {cards.terms.map((term) => (
              <div key={term.title} className="kv">
                {term.facts.map((fact) => (
                  <Fact key={`${term.title}-${fact.label}`} label={fact.label} value={fact.value} mono={fact.label === "Contract"} />
                ))}
              </div>
            ))}
          </section>
          {editing ? (
            <section className="panel">
              <div className="ph">
                <h2>Edit settings</h2>
                <div className="side">Saving creates a new version. The current version is kept.</div>
              </div>
              <SettingsForm customerId={cards.customerId} />
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <div className="k">{label}</div>
      <div className={mono ? "mono2" : undefined}>{value}</div>
    </>
  );
}
