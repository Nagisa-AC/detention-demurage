import { present, type ReportFinding, type RunReport } from "./rules/runRules.js";

const COLUMNS = [
  "invoice_id",
  "rule",
  "rule_version",
  "ground",
  "line_ids",
  "disputable_amount",
  "currency",
  "do_not_pursue",
  "convention",
  "citations",
  "expected",
  "actual",
  "explain",
  "evidence",
] as const;

/** A cell that starts with one of these is a formula in a spreadsheet. Invoice text is untrusted. */
const FORMULA = /^[=+\-@\t\r]/;

/** One row per finding. LF, a trailing newline, and a fixed header. */
export function findingsCsv(report: RunReport): string {
  const ordered = present(report);
  const lines = [COLUMNS.join(",")];
  for (const finding of ordered.findings) lines.push(COLUMNS.map((column) => cell(columnValue(finding, column))).join(","));
  return `${lines.join("\n")}\n`;
}

/** Two-space JSON, LF, a trailing newline. Key order comes from `present`. */
export function reportJson(report: RunReport): string {
  return `${JSON.stringify(present(report), null, 2)}\n`;
}

function columnValue(finding: ReportFinding, column: (typeof COLUMNS)[number]): string {
  if (column === "invoice_id") return finding.invoice_id;
  if (column === "rule") return finding.rule;
  if (column === "rule_version") return String(finding.rule_version);
  if (column === "ground") return finding.ground;
  if (column === "line_ids") return finding.line_ids.join("|");
  if (column === "disputable_amount") return finding.disputable_amount;
  if (column === "currency") return finding.currency;
  if (column === "do_not_pursue") return finding.do_not_pursue ? "true" : "false";
  if (column === "convention") return finding.convention ?? "";
  if (column === "citations") return finding.citations.join("|");
  if (column === "expected") return finding.expected;
  if (column === "actual") return finding.actual;
  if (column === "explain") return finding.explain;
  return finding.evidence.map((item) => `${item.page ?? ""}:${item.field}`).join("|");
}

function cell(value: string): string {
  const guarded = FORMULA.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}
