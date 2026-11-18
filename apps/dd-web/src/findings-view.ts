/** Display of stored finding fields. No rule is run again here. */

export type StoredFindingView = {
  id: string;
  invoiceId: string;
  rule: string;
  ruleVersion: number;
  citations: string[];
  lineIds: string[];
  expected: string;
  actual: string;
  amount: string;
  currency: string;
  explain: string;
  convention: string;
  evidence: { page: number | null; field: string }[];
};

const RULE_LABELS: Record<string, string> = {
  R1: "Missing info",
  R2: "Late invoice",
  R3: "Free time",
  R4: "Arithmetic",
  R5: "Duplicate",
  manual: "Manual",
};

export function ruleLabel(rule: string): string {
  return RULE_LABELS[rule] ?? rule;
}

/** A one-line reason from expected and actual. The rule name is the fallback. */
export function findingReason(finding: Pick<StoredFindingView, "rule" | "expected" | "actual">): string {
  const actual = finding.actual.trim();
  const expected = finding.expected.trim();
  if (actual !== "" && actual !== "confirmed absent") return actual;
  if (expected !== "") return expected;
  return finding.rule;
}

export type CheckCell = { label: string; reason: string };

export function checkCells(findings: readonly StoredFindingView[]): CheckCell[] {
  const groups: { rule: string; rows: StoredFindingView[] }[] = [];
  for (const finding of findings) {
    const existing = groups.find((group) => group.rule === finding.rule);
    if (existing === undefined) groups.push({ rule: finding.rule, rows: [finding] });
    else existing.rows.push(finding);
  }
  return groups.map((group) => ({
    label: checkLabel(group.rule, group.rows),
    reason: joinReasons(group.rows),
  }));
}

export function amountsDiffer(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return true;
  const orderedLeft = [...left].sort();
  const orderedRight = [...right].sort();
  return orderedLeft.some((amount, index) => amount !== orderedRight[index]);
}

/** The finding detail to open: the largest stored amount, then the first id. */
export function leadFinding(findings: readonly StoredFindingView[]): StoredFindingView | null {
  let lead: StoredFindingView | null = null;
  for (const finding of findings) {
    if (lead === null || compareAmount(finding.amount, lead.amount) > 0) lead = finding;
  }
  return lead;
}

function checkLabel(rule: string, findings: readonly StoredFindingView[]): string {
  const name = ruleLabel(rule);
  if (findings.length > 1) return `${name} · ${findings.length}`;
  const citations = findings[0]?.citations.length ?? 0;
  if (citations > 1) return `${name} · ${citations}`;
  return name;
}

function joinReasons(findings: readonly StoredFindingView[]): string {
  const reasons: string[] = [];
  for (const finding of findings) {
    const reason = findingReason(finding);
    if (!reasons.includes(reason)) reasons.push(reason);
  }
  return reasons.join(" · ");
}

function compareAmount(left: string, right: string): number {
  const leftCents = cents(left);
  const rightCents = cents(right);
  if (leftCents === null || rightCents === null) return left.localeCompare(right);
  return leftCents - rightCents;
}

function cents(amount: string): number | null {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(amount.trim());
  if (match === null) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 100 + Number(match[3]));
}
