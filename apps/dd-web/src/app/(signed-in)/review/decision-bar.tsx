"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { decideElement, type ReviewActionState } from "./actions";
import type { ScreenElement } from "./review-screen";

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
            Selected: <strong>{selected.label}</strong> — {selected.pill}
          </>
        )}
      </span>
      {message === "" ? null : <span className="bar-message">{message}</span>}
      <div className="bar-actions">
        {showDecision && selected !== null ? (
          <DecisionForm key={selected.key} invoiceId={invoiceId} selected={selected} onMessage={onMessage} />
        ) : null}
        {approved ? null : (
          <button
            type="button"
            className="btn primary"
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
  const [text, setText] = useState("");
  const [page, setPage] = useState(selected.page === null ? "1" : String(selected.page));
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
      {selected.storedState === "suggested_absent" ? (
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
          <Submit name="command" value="mark_present" className="btn">
            It&apos;s on the page — mark present
          </Submit>
          <Submit name="command" value="confirm_missing" className="btn primary">
            Confirm missing
          </Submit>
        </>
      ) : (
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

function covers(pages: readonly number[], pageCount: number): boolean {
  const seen = new Set(pages);
  for (let page = 1; page <= pageCount; page += 1) {
    if (!seen.has(page)) return false;
  }
  return true;
}
