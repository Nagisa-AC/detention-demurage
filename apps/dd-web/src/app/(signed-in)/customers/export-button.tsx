"use client";

import { useActionState } from "react";
import { exportReport, type ExportFormState } from "./export-report";

const initial: ExportFormState = { message: "", id: "", number: "" };

export function ExportButton({
  customerId,
  reason,
  latest,
}: {
  customerId: string;
  reason: string | null;
  latest: { id: string; number: string } | null;
}) {
  const [state, action, pending] = useActionState(exportReport, initial);
  const blocked = reason !== null;
  const exported = state.id === "" ? latest : { id: state.id, number: state.number };
  return (
    <div className="export">
      <form action={action}>
        <input type="hidden" name="customerId" value={customerId} />
        <button type="submit" className="btn primary" disabled={blocked || pending}>
          Export report
        </button>
      </form>
      {blocked ? <p className="export-reason" role="status">{reason}</p> : null}
      {!blocked && state.message !== "" ? <p className="export-reason" role="status">{state.message}</p> : null}
      {exported === null ? null : (
        <p className="export-links">
          <span className="mono">{exported.number}</span>
          <a href={`/api/reports/${customerId}/${exported.id}?format=pdf`}>PDF</a>
          <a href={`/api/reports/${customerId}/${exported.id}?format=csv`}>CSV</a>
        </p>
      )}
    </div>
  );
}
