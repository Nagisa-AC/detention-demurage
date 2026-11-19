"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { exportReport, type ExportFormState } from "./export-report";

type ExportPhase = "blocked" | "ready" | "generating" | "failed";

const initial: ExportFormState = { message: "", queued: false };

export function ExportButton({
  customerId,
  phase,
  reason,
  latest,
}: {
  customerId: string;
  phase: ExportPhase;
  reason: string | null;
  latest: { id: string; number: string } | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(exportReport, initial);
  const generating = phase === "generating" || pending;
  useEffect(() => {
    if (!state.queued) return;
    router.refresh();
  }, [state.queued, router]);
  useEffect(() => {
    if (phase !== "generating") return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [phase, router]);
  const note = state.message !== "" ? state.message : reason;
  return (
    <div className="export">
      <form
        action={async (formData) => {
          await action(formData);
          router.refresh();
        }}
      >
        <input type="hidden" name="customerId" value={customerId} />
        <button type="submit" className="btn primary" disabled={phase === "blocked" || generating}>
          {generating ? "Generating…" : "Export report"}
        </button>
      </form>
      {generating ? <p className="export-status" role="status">Generating…</p> : null}
      {!generating && note !== null && note !== "" ? <Refusal note={note} /> : null}
      {latest === null ? null : (
        <p className="export-links">
          <span className="mono">{latest.number}</span>
          <a href={`/api/reports/${customerId}/${latest.id}?format=pdf`}>PDF</a>
          <a href={`/api/reports/${customerId}/${latest.id}?format=csv`}>CSV</a>
        </p>
      )}
    </div>
  );
}

const CHECKS_LINK = new Set(["Checks have not run.", "The latest checks run did not succeed."]);

function Refusal({ note }: { note: string }) {
  const phrase = "Run checks again";
  const at = note.indexOf(phrase);
  if (at < 0) {
    return (
      <p className="export-reason" role="status">
        {CHECKS_LINK.has(note) ? <a href="#run-checks">{note}</a> : note}
      </p>
    );
  }
  const withPeriod = note.startsWith(".", at + phrase.length);
  return (
    <p className="export-reason" role="status">
      {note.slice(0, at)}
      <a href="#run-checks">{withPeriod ? `${phrase}.` : phrase}</a>
      {note.slice(at + phrase.length + (withPeriod ? 1 : 0))}
    </p>
  );
}
