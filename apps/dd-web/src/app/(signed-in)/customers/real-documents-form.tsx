"use client";

import { useActionState } from "react";
import { saveRealDocuments, type RealDocumentsState } from "./save-real-documents";

const initial: RealDocumentsState = { message: "", problems: [] };

export function RealDocumentsForm({ customerId, accepts }: { customerId: string; accepts: boolean }) {
  const [state, action, pending] = useActionState(saveRealDocuments, initial);
  const next = accepts ? "false" : "true";
  const saved = state.message.startsWith("Real documents are");
  return (
    <form className="settings-form" action={action}>
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="accepts" value={next} />
      <p className="help">
        {accepts
          ? "Real customer PDFs are stored and read. Synthetic samples stay accepted either way."
          : "Only synthetic samples are accepted. Real customer PDFs are refused."}
      </p>
      <label className="help" htmlFor="confirm-real-documents">
        <input id="confirm-real-documents" type="checkbox" name="confirm" value="yes" required />{" "}
        {accepts
          ? "Stop accepting real PDFs. New files that are not synthetic samples will be refused."
          : "Accept real customer PDFs. They will be stored and read."}
      </label>
      {saved ? <p className="ok">{state.message}</p> : null}
      {!saved && state.message !== "" ? <p className="err">{state.message}</p> : null}
      {state.problems.length === 0 ? null : (
        <ul className="problems">
          {state.problems.map((problem, index) => (
            <li key={`${problem.path}:${index}`}>
              <span>{problem.path}</span>: {problem.message}
            </li>
          ))}
        </ul>
      )}
      <button type="submit" className="btn primary" disabled={pending}>
        {accepts ? "Turn off real documents" : "Turn on real documents"}
      </button>
    </form>
  );
}
