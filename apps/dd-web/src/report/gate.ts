export type ExportGate = {
  firmReady: boolean;
  hasSettings: boolean;
  checks: "missing" | "running" | "failed" | "ok";
  recorded: boolean;
  checksCurrent: boolean;
  invoiceCount: number;
  unapproved: number;
  pendingDocuments: number;
};

/** The first reason the export is refused, or null when it may run. */
export function exportRefusal(gate: ExportGate): string | null {
  if (!gate.firmReady) return "The firm profile is not set.";
  if (!gate.hasSettings) return "This customer has no settings.";
  if (gate.checks === "missing") return "Checks have not run.";
  if (gate.checks === "running") return "Checks are still running.";
  if (gate.checks === "failed") return "The latest checks run did not succeed.";
  if (!gate.recorded) return "The latest checks run has no per-invoice amounts. Run checks again.";
  if (!gate.checksCurrent) return "Checks have not run on every approved invoice. Run checks again.";
  if (gate.invoiceCount === 0) return "There are no invoices to report.";
  if (gate.unapproved > 0) return "An invoice is not approved.";
  if (gate.pendingDocuments > 0) return "An upload is waiting for review.";
  return null;
}
