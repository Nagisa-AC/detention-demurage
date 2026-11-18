"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { decideElement, setBillingParty, type ReviewActionState } from "./actions";
import type { ScreenElement } from "./review-screen";

export type PartyChoice = { id: string; label: string };

export function DecisionBar({
  invoiceId,
  selected,
  pageCount,
  approved,
  openCount,
  viewed,
  message,
  onMessage,
  onApprove,
  printedName,
  partyOptions,
  chosenPartyId,
  canBackfill,
}: {
  invoiceId: string;
  selected: ScreenElement | null;
  pageCount: number;
  approved: boolean;
  openCount: number;
  viewed: readonly number[];
  message: string;
  onMessage: (message: string) => void;
  onApprove: () => Promise<void>;
  printedName: string;
  partyOptions: readonly PartyChoice[];
  chosenPartyId: string | null;
  canBackfill: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const ready = !approved && openCount === 0 && covers(viewed, pageCount);
  const showDecision = !approved && selected !== null && selected.needsDecision;

  return (
    <div className="bar">
      <span className="bar-note">
        {approved ? (
          "This invoice is approved."
        ) : selected === null ? (
          "Select an element."
        ) : (
          <>
            Selected: <strong>{selected.label}</strong> · {selected.pill}
          </>
        )}
      </span>
      {message === "" ? null : <span className="bar-message">{message}</span>}
      {showDecision && selected !== null ? (
        <DecisionForm key={selected.key} invoiceId={invoiceId} selected={selected} onMessage={onMessage} />
      ) : null}
      <div className="bar-approve grow">
          <BillingParty
            invoiceId={invoiceId}
            printedName={printedName}
            partyOptions={partyOptions}
            chosenPartyId={chosenPartyId}
            approved={approved}
            canBackfill={canBackfill}
            onMessage={onMessage}
          />
          {approved ? null : (
            <button
              type="button"
              className={ready && !busy ? "btn primary" : "btn primary dis"}
              disabled={!ready || busy}
              onClick={() => {
                if (!ready || busy) return;
                setBusy(true);
                onApprove().finally(() => setBusy(false));
              }}
            >
              Approve invoice
            </button>
          )}
      </div>
    </div>
  );
}

function DecisionForm({
  invoiceId,
  selected,
  onMessage,
}: {
  invoiceId: string;
  selected: ScreenElement;
  onMessage: (message: string) => void;
}) {
  const [marking, setMarking] = useState(false);
  const [text, setText] = useState("");
  const [page, setPage] = useState(selected.page === null ? "1" : String(selected.page));
  const absent = selected.storedState === "suggested_absent";
  return (
    <form
      className="bar-form"
      action={async (formData) => {
        const result = await decideElement({ message: "" } satisfies ReviewActionState, formData);
        onMessage(result.message);
      }}
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="elementKey" value={selected.key} />
      {absent && !marking ? (
        <>
          <button type="button" className="btn" onClick={() => setMarking(true)}>
            It&apos;s on the page
          </button>
          <Submit name="command" value="confirm_missing" className="btn primary">
            Confirm missing
          </Submit>
        </>
      ) : null}
      {absent && marking ? (
        <>
          <label>
            Text
            <input name="text" value={text} autoComplete="off" onChange={(event) => setText(event.target.value)} />
          </label>
          <label>
            Page
            <input
              name="page"
              inputMode="numeric"
              value={page}
              autoComplete="off"
              onChange={(event) => setPage(event.target.value)}
            />
          </label>
          <Submit name="command" value="mark_present" className="btn primary">
            Save
          </Submit>
          <button type="button" className="btn" onClick={() => setMarking(false)}>
            Cancel
          </button>
        </>
      ) : null}
      {absent ? null : (
        <>
          <label>
            Text
            <input name="text" value={text} autoComplete="off" onChange={(event) => setText(event.target.value)} />
          </label>
          <Submit name="command" value="correct" className="btn">
            Correct
          </Submit>
          <Submit name="command" value="keep" className="btn primary">
            Text is right
          </Submit>
        </>
      )}
    </form>
  );
}

function Submit({
  name,
  value,
  className,
  children,
}: {
  name: string;
  value: string;
  className: string;
  children: string;
}) {
  const status = useFormStatus();
  return (
    <button type="submit" name={name} value={value} className={className} disabled={status.pending}>
      {children}
    </button>
  );
}

function BillingParty({
  invoiceId,
  printedName,
  partyOptions,
  chosenPartyId,
  approved,
  canBackfill,
  onMessage,
}: {
  invoiceId: string;
  printedName: string;
  partyOptions: readonly PartyChoice[];
  chosenPartyId: string | null;
  approved: boolean;
  canBackfill: boolean;
  onMessage: (message: string) => void;
}) {
  const printed = <span>Printed on the invoice: {printedName}</span>;
  const known = partyOptions.find((option) => option.id === chosenPartyId);
  if (approved && !canBackfill) {
    return (
      <div className="billing-party">
        <span>Carrier: {known?.label ?? chosenPartyId ?? "not set"}</span>
        {printed}
      </div>
    );
  }
  if (approved && canBackfill) {
    return (
      <div className="billing-party">
        <span>Carrier: not set</span>
        {printed}
        {partyOptions.length === 0 ? (
          <span>No settings yet.</span>
        ) : (
          <Backfill invoiceId={invoiceId} partyOptions={partyOptions} onMessage={onMessage} />
        )}
      </div>
    );
  }
  return (
    <div className="billing-party">
      <label>
        Carrier
        {partyOptions.length === 0 ? (
          <span>No settings yet.</span>
        ) : (
          <PartySelect
            invoiceId={invoiceId}
            partyOptions={partyOptions}
            chosenPartyId={known === undefined ? "" : (chosenPartyId ?? "")}
            onMessage={onMessage}
          />
        )}
      </label>
      {printed}
    </div>
  );
}

function PartySelect({
  invoiceId,
  partyOptions,
  chosenPartyId,
  onMessage,
}: {
  invoiceId: string;
  partyOptions: readonly PartyChoice[];
  chosenPartyId: string;
  onMessage: (message: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const value = pending ?? chosenPartyId;
  return (
    <>
      <select
        aria-label="Carrier"
        value={value}
        disabled={busy}
        onChange={(event) => {
          const next = event.target.value;
          if (next === "" || next === chosenPartyId || busy) return;
          setPending(next);
          setStatus("");
          setBusy(true);
          setBillingParty(invoiceId, next, false)
            .then((result) => {
              const saved = result.message === "";
              setStatus(saved ? "✓ Saved" : result.message);
              onMessage(saved ? "" : result.message);
            })
            .finally(() => {
              setPending(null);
              setBusy(false);
            });
        }}
      >
        <option value="">Choose a billing party</option>
        {partyOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      {status === "" ? null : <span role="status">{status}</span>}
    </>
  );
}

function Backfill({
  invoiceId,
  partyOptions,
  onMessage,
}: {
  invoiceId: string;
  partyOptions: readonly PartyChoice[];
  onMessage: (message: string) => void;
}) {
  const [partyId, setPartyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  return (
    <>
      <select
        aria-label="Carrier"
        value={partyId}
        disabled={busy}
        onChange={(event) => {
          setPartyId(event.target.value);
          setStatus("");
        }}
      >
        <option value="">Choose a billing party</option>
        {partyOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn"
        disabled={partyId === "" || busy}
        onClick={() => {
          if (partyId === "" || busy) return;
          setBusy(true);
          setBillingParty(invoiceId, partyId, true)
            .then((result) => {
              const saved = result.message === "";
              setStatus(saved ? "✓ Saved" : result.message);
              onMessage(saved ? "" : result.message);
            })
            .finally(() => setBusy(false));
        }}
      >
        Set billing party
      </button>
      {status === "" ? null : <span role="status">{status}</span>}
    </>
  );
}

function covers(pages: readonly number[], pageCount: number): boolean {
  const seen = new Set(pages);
  for (let page = 1; page <= pageCount; page += 1) {
    if (!seen.has(page)) return false;
  }
  return true;
}
