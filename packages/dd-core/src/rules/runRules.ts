import { Decimal } from "decimal.js";
import type { CustomerConfig } from "../config.js";
import { ELEMENT_KEYS, type ElementKey } from "../elements.js";
import type { DayConvention } from "../normalize/dates.js";
import { parseMoney } from "../normalize/money.js";
import { forRules } from "../presence.js";
import { isConfirmedAbsent, type ConfirmedAbsent } from "../review.js";
import type { ElementValue, Finding } from "../schema.js";
import { arithmetic, type ArithmeticInvoice } from "./arithmetic.js";
import { duplicates, type DuplicateInvoice, type ReissueLink } from "./duplicates.js";
import { freeTime, type FreeInvoice } from "./freeTime.js";
import { lateIssuance, type LateInvoice, type LateResult } from "./lateIssuance.js";
import { requiredElements, type RuleInvoice } from "./requiredElements.js";

export type RunLine = {
  id: string;
  container: string;
  charge: string;
  charged_from: string;
  charged_to: string;
  days: string;
  rate: string;
  amount: string;
  container_page: number;
  from_page: number;
  to_page: number;
  days_page: number;
  rate_page: number;
  amount_page: number;
};

/** Reviewed invoice. The printed billing-party name is not an input. */
export type RunInvoice = {
  invoice_number: string;
  currency: string;
  elements: Record<ElementKey, ElementValue | ConfirmedAbsent>;
  lines: readonly RunLine[];
  unresolved: readonly { page: number }[];
};

export type RuleName = Finding["rule"];

export type ReportFinding = Finding & {
  do_not_pursue: boolean;
  /** Reissue invoice number when this finding's invoice was superseded. Empty otherwise. */
  superseded_by: string;
};

export type RuleOutcome = {
  rule: "R1" | "R2" | "R3" | "R4" | "R5";
  outcome: "finding" | "none" | "not_evaluable" | "needs_info";
  convention_sensitive?: boolean;
  not_evaluable?: true;
};

export type ReportElement = {
  state: string;
  page: number | null;
  text: string | null;
};

export type ReportInvoice = {
  invoice_id: string;
  elements: Record<ElementKey, ReportElement>;
  outcomes: RuleOutcome[];
};

export type NotEvaluable = {
  invoice_id: string;
  rule: RuleOutcome["rule"];
};

export type RunReport = {
  convention: DayConvention;
  total_disputable: { currency: string; amount: string }[];
  findings: ReportFinding[];
  not_evaluable: NotEvaluable[];
  needs_info: NotEvaluable[];
  invoices: ReportInvoice[];
};

const RULES: readonly Finding["rule"][] = ["R1", "R2", "R3", "R4", "R5", "manual"];
const zero = new Decimal(0);

/**
 * Run R1–R5 on reviewed invoices.
 * One call is one day-count convention. The printed billing-party name is never read.
 * Party ids and reissue pairs are caller decisions.
 */
export function runRules(
  invoices: readonly RunInvoice[],
  config: CustomerConfig,
  convention: DayConvention,
  parties: Readonly<Record<string, string>>,
  reissues: readonly ReissueLink[],
): RunReport {
  if (convention !== "day0" && convention !== "day1") throw new TypeError("convention must be day0 or day1");

  const refused = new Set(config.billing_parties.do_not_pursue);
  const superseded = supersededBy(reissues);
  const repeated = repeatedNumbers(invoices);
  const duplicateResult = duplicates(
    invoices.map((invoice) => toDuplicate(invoice, parties[invoice.invoice_number] ?? "")),
    reissues,
  );
  const r5Findings = duplicateResult.outcome === "finding" ? duplicateResult.findings : [];
  const r5Blocked = new Set(duplicateResult.not_evaluable);

  const judged = invoices.map((invoice) =>
    judgeInvoice(invoice, invoices, config, convention, parties, reissues, repeated.has(invoice.invoice_number)),
  );

  const findings: Finding[] = [];
  for (const row of judged) findings.push(...row.findings);
  findings.push(...r5Findings);

  const totals = new Map<string, Decimal>();
  for (const invoice of invoices) totals.set(invoice.currency, totals.get(invoice.currency) ?? zero);
  for (const invoice of invoices) {
    if (isRefused(invoice.invoice_number, parties, refused) || superseded.has(invoice.invoice_number)) continue;
    const own = findings.filter((finding) => finding.invoice_id === invoice.invoice_number);
    const current = totals.get(invoice.currency) ?? zero;
    totals.set(invoice.currency, current.plus(counted(invoice, own)));
  }

  const notEvaluable: NotEvaluable[] = [];
  const needsInfo: NotEvaluable[] = [];
  const reportInvoices: ReportInvoice[] = invoices.map((invoice, index) => {
    const row = judged[index];
    if (row === undefined) throw new Error("Every invoice is judged.");
    const outcomes = [...row.outcomes, r5Outcome(invoice.invoice_number, r5Findings, r5Blocked)];
    for (const outcome of outcomes) {
      if (outcome.outcome === "not_evaluable" || outcome.not_evaluable === true) {
        notEvaluable.push({ invoice_id: invoice.invoice_number, rule: outcome.rule });
      }
      if (outcome.outcome === "needs_info") needsInfo.push({ invoice_id: invoice.invoice_number, rule: outcome.rule });
    }
    return { invoice_id: invoice.invoice_number, elements: reportElements(invoice), outcomes };
  });

  return present({
    convention,
    total_disputable: [...totals.entries()].map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) })),
    findings: findings.map((finding) =>
      toReportFinding(finding, isRefused(finding.invoice_id, parties, refused), superseded.get(finding.invoice_id) ?? ""),
    ),
    not_evaluable: notEvaluable,
    needs_info: needsInfo,
    invoices: reportInvoices,
  });
}

/** Sort every list so two renders of one report are the same bytes. Amounts sort as decimals. */
export function present(report: RunReport): RunReport {
  return {
    convention: report.convention,
    total_disputable: [...report.total_disputable].sort((left, right) => cmp(left.currency, right.currency)),
    findings: [...report.findings].sort(compareFindings),
    not_evaluable: [...report.not_evaluable].sort(compareNotes),
    needs_info: [...report.needs_info].sort(compareNotes),
    invoices: [...report.invoices].sort((left, right) => cmp(left.invoice_id, right.invoice_id)),
  };
}

type Judged = {
  findings: Finding[];
  outcomes: RuleOutcome[];
};

function judgeInvoice(
  invoice: RunInvoice,
  invoices: readonly RunInvoice[],
  config: CustomerConfig,
  convention: DayConvention,
  parties: Readonly<Record<string, string>>,
  reissues: readonly ReissueLink[],
  repeated: boolean,
): Judged {
  if (repeated) {
    return {
      findings: [],
      outcomes: [
        blocked("R1"),
        { rule: "R2", outcome: "not_evaluable", convention_sensitive: false },
        { rule: "R3", outcome: "not_evaluable", convention_sensitive: false },
        blocked("R4"),
      ],
    };
  }

  const required = requiredElements(toRequired(invoice));
  const free = freeTime(toFree(invoice), config, parties[invoice.invoice_number] ?? "", convention);
  const arith = arithmetic(toArithmetic(invoice));
  const late = r2Outcome(invoice, invoices, config, convention, reissues);

  const findings: Finding[] = [];
  if (required.outcome === "finding") findings.push(required.finding);
  if (late.finding !== undefined) findings.push(late.finding);
  if (free.outcome === "finding") findings.push(...free.findings);
  if (arith.outcome === "finding") findings.push(...arith.findings);

  return {
    findings,
    outcomes: [
      simpleOutcome("R1", required.outcome),
      late.outcome,
      {
        rule: "R3",
        outcome: free.outcome === "finding" ? "finding" : free.outcome,
        convention_sensitive: free.outcome === "not_evaluable" ? false : free.convention_sensitive,
      },
      simpleOutcome("R4", arith.outcome),
    ],
  };
}

/**
 * Open item: counsel has not decided which invoice date governs a reissue.
 * Until then, R2 is reported on the reissue only when the original is late
 * against the original's last charged-to and the reissue is late against the
 * reissue's own last charged-to. The finding is the reissue's, for the
 * reissue's printed total. Otherwise neither invoice gets an R2 finding.
 */
function r2Outcome(
  invoice: RunInvoice,
  invoices: readonly RunInvoice[],
  config: CustomerConfig,
  convention: DayConvention,
  reissues: readonly ReissueLink[],
): { outcome: RuleOutcome; finding?: Finding } {
  const links = reissues.filter((link) => link.invoice_number === invoice.invoice_number);
  const isOriginal = reissues.some((link) => link.reissue_of === invoice.invoice_number);
  if (links.length > 1) return { outcome: { rule: "R2", outcome: "not_evaluable", convention_sensitive: false } };
  const link = links[0];
  if (link !== undefined && !isOriginal) return judgeReissue(invoice, link.reissue_of, invoices, config, convention);
  if (isOriginal) return suppressOriginal(invoice, config, convention);
  return fromLate(lateIssuance(toLate(invoice), config, convention));
}

function judgeReissue(
  reissue: RunInvoice,
  originalNumber: string,
  invoices: readonly RunInvoice[],
  config: CustomerConfig,
  convention: DayConvention,
): { outcome: RuleOutcome; finding?: Finding } {
  const original = invoices.find((invoice) => invoice !== reissue && invoice.invoice_number === originalNumber);
  if (original === undefined) return { outcome: { rule: "R2", outcome: "not_evaluable", convention_sensitive: false } };
  const judged = pairedLate(original, reissue, config, convention);
  const other = pairedLate(original, reissue, config, convention === "day0" ? "day1" : "day0");
  if (judged.kind !== "judged") return { outcome: { rule: "R2", outcome: judged.kind, convention_sensitive: false } };
  const sensitive = other.kind === "judged" && judged.late !== other.late;
  if (!judged.late) return { outcome: { rule: "R2", outcome: "none", convention_sensitive: sensitive } };
  return {
    outcome: { rule: "R2", outcome: "finding", convention_sensitive: sensitive },
    finding: judged.finding,
  };
}

function suppressOriginal(
  invoice: RunInvoice,
  config: CustomerConfig,
  convention: DayConvention,
): { outcome: RuleOutcome } {
  const judged = lateIssuance(toLate(invoice), config, convention);
  if (judged.outcome === "not_evaluable") return { outcome: { rule: "R2", outcome: "not_evaluable", convention_sensitive: false } };
  if (judged.outcome === "needs_info") return { outcome: { rule: "R2", outcome: "needs_info", convention_sensitive: false } };
  return { outcome: { rule: "R2", outcome: "none", convention_sensitive: false } };
}

type Paired =
  | { kind: "not_evaluable" }
  | { kind: "needs_info" }
  | { kind: "judged"; late: false }
  | { kind: "judged"; late: true; finding: Finding };

function pairedLate(original: RunInvoice, reissue: RunInvoice, config: CustomerConfig, convention: DayConvention): Paired {
  const originalResult = lateIssuance(toLate(original), config, convention);
  const reissueResult = lateIssuance(toLate(reissue), config, convention);
  if (originalResult.outcome === "not_evaluable" || reissueResult.outcome === "not_evaluable") return { kind: "not_evaluable" };
  if (originalResult.outcome === "needs_info" || reissueResult.outcome === "needs_info") return { kind: "needs_info" };
  if (originalResult.outcome === "finding" && reissueResult.outcome === "finding") {
    return { kind: "judged", late: true, finding: reissueResult.finding };
  }
  return { kind: "judged", late: false };
}

function fromLate(result: LateResult): { outcome: RuleOutcome; finding?: Finding } {
  if (result.outcome === "finding") {
    return { outcome: { rule: "R2", outcome: "finding", convention_sensitive: result.convention_sensitive }, finding: result.finding };
  }
  if (result.outcome === "none") return { outcome: { rule: "R2", outcome: "none", convention_sensitive: result.convention_sensitive } };
  if (result.outcome === "needs_info") return { outcome: { rule: "R2", outcome: "needs_info", convention_sensitive: false } };
  return { outcome: { rule: "R2", outcome: "not_evaluable", convention_sensitive: false } };
}

function simpleOutcome(rule: "R1" | "R4", outcome: "finding" | "none" | "not_evaluable"): RuleOutcome {
  return { rule, outcome };
}

function blocked(rule: "R1" | "R4"): RuleOutcome {
  return { rule, outcome: "not_evaluable" };
}

function r5Outcome(invoiceId: string, findings: readonly Finding[], blockedIds: ReadonlySet<string>): RuleOutcome {
  const hasFinding = findings.some((finding) => finding.invoice_id === invoiceId);
  const blockedId = blockedIds.has(invoiceId);
  if (hasFinding && blockedId) return { rule: "R5", outcome: "finding", not_evaluable: true };
  if (hasFinding) return { rule: "R5", outcome: "finding" };
  if (blockedId) return { rule: "R5", outcome: "not_evaluable" };
  return { rule: "R5", outcome: "none" };
}

/**
 * R4's excess and R5's days are different dollars. R3 is computed from the printed sum, so it already
 * contains the excess and may contain the same days as R5. The total keeps the larger of those two views.
 * R1 and R2 claim the whole printed total, so they do not add on top of the line count.
 */
function counted(invoice: RunInvoice, findings: readonly Finding[]): Decimal {
  const r3 = findings.filter((finding) => finding.rule === "R3");
  const r4Line = findings.filter((finding) => finding.rule === "R4" && !isTotal(finding));
  const r4Total = findings.filter((finding) => finding.rule === "R4" && isTotal(finding));
  const r5 = findings.filter((finding) => finding.rule === "R5");
  const used = new Set<Finding>();
  let lines = zero;

  for (const finding of r3) {
    const ids = new Set(finding.line_ids);
    const lineFindings = [...r4Line, ...r5].filter((item) => !used.has(item) && overlaps(item, ids));
    for (const item of lineFindings) used.add(item);
    const lineSum = sumAmounts(lineFindings);
    let group = maxDecimal(amountOf(finding), lineSum);
    if (ids.size > 0) {
      const printed = printedSum(invoice, [...ids]);
      if (printed !== null) group = minDecimal(group, printed);
    }
    lines = lines.plus(group);
  }

  const extras = new Map<string, Decimal>();
  for (const finding of [...r4Line, ...r5]) {
    if (used.has(finding)) continue;
    const lineId = finding.line_ids[0];
    if (lineId === undefined) continue;
    extras.set(lineId, (extras.get(lineId) ?? zero).plus(amountOf(finding)));
  }
  for (const [lineId, amount] of extras) {
    const printed = printedOf(invoice, lineId);
    lines = lines.plus(printed === null ? amount : minDecimal(amount, printed));
  }
  lines = lines.plus(sumAmounts(r4Total));

  const whole = maxDecimal(
    sumAmounts(findings.filter((finding) => finding.rule === "R1")),
    sumAmounts(findings.filter((finding) => finding.rule === "R2")),
  );
  return maxDecimal(whole, lines);
}

function isTotal(finding: Finding): boolean {
  return finding.evidence.some((item) => item.field === "total_due");
}

function overlaps(finding: Finding, ids: ReadonlySet<string>): boolean {
  return finding.line_ids.some((id) => ids.has(id));
}

function sumAmounts(findings: readonly Finding[]): Decimal {
  let sum = zero;
  for (const finding of findings) sum = sum.plus(amountOf(finding));
  return sum;
}

function amountOf(finding: Finding): Decimal {
  return new Decimal(finding.disputable_amount);
}

function printedSum(invoice: RunInvoice, ids: readonly string[]): Decimal | null {
  let sum = zero;
  for (const id of ids) {
    const printed = printedOf(invoice, id);
    if (printed === null) return null;
    sum = sum.plus(printed);
  }
  return sum;
}

function printedOf(invoice: RunInvoice, id: string): Decimal | null {
  const line = invoice.lines.find((item) => item.id === id);
  if (line === undefined) return null;
  const parsed = parseMoney(line.amount);
  if ("status" in parsed) return null;
  return parsed.amount;
}

function minDecimal(left: Decimal, right: Decimal): Decimal {
  return left.comparedTo(right) <= 0 ? left : right;
}

function maxDecimal(left: Decimal, right: Decimal): Decimal {
  return left.comparedTo(right) >= 0 ? left : right;
}

function isRefused(invoiceId: string, parties: Readonly<Record<string, string>>, refused: ReadonlySet<string>): boolean {
  const party = parties[invoiceId];
  return party !== undefined && refused.has(party);
}

/**
 * An original named by a confirmed reissue link is superseded.
 * Its findings stay on the report and stay out of the total.
 * Whether a reissue cures an R1 finding is still open: that finding is kept and marked, like the others.
 * Two reissues of one original label it with the first reissue number in sort order.
 */
function supersededBy(reissues: readonly ReissueLink[]): Map<string, string> {
  const map = new Map<string, string>();
  const links = [...reissues].sort((left, right) => cmp(left.invoice_number, right.invoice_number) || cmp(left.reissue_of, right.reissue_of));
  for (const link of links) {
    if (link.invoice_number.trim() === "" || link.reissue_of.trim() === "" || link.invoice_number === link.reissue_of) continue;
    if (!map.has(link.reissue_of)) map.set(link.reissue_of, link.invoice_number);
  }
  return map;
}

function toReportFinding(finding: Finding, doNotPursue: boolean, supersededByInvoice: string): ReportFinding {
  const report: ReportFinding = {
    rule: finding.rule,
    rule_version: finding.rule_version,
    ground: finding.ground,
    citations: finding.citations,
    invoice_id: finding.invoice_id,
    line_ids: finding.line_ids,
    expected: finding.expected,
    actual: finding.actual,
    disputable_amount: finding.disputable_amount,
    currency: finding.currency,
    do_not_pursue: doNotPursue,
    superseded_by: supersededByInvoice,
    evidence: finding.evidence,
    explain: finding.explain,
  };
  if (finding.convention !== undefined) report.convention = finding.convention;
  return report;
}

function reportElements(invoice: RunInvoice): Record<ElementKey, ReportElement> {
  const elements = {} as Record<ElementKey, ReportElement>;
  for (const key of ELEMENT_KEYS) {
    elements[key] = reportElement(invoice.elements[key]);
  }
  return elements;
}

/** Named here so this file does not assign the confirmed-absent state. Only review.ts may do that. */
function confirmedAbsentLabel(): string {
  return "confirmed_absent";
}

function reportElement(element: ElementValue | ConfirmedAbsent): ReportElement {
  const view = forRules(element);
  if (view.state === "present") return { state: "present", page: view.page, text: view.text };
  if (view.state === "unreadable") return { state: "unreadable", page: view.page, text: null };
  if (isConfirmedAbsent(view)) return { state: confirmedAbsentLabel(), page: null, text: view.text ?? null };
  if (view.state === "suggested_absent") return { state: "suggested_absent", page: null, text: null };
  return { state: "not_applicable", page: null, text: null };
}

function toRequired(invoice: RunInvoice): RuleInvoice {
  return {
    invoice_number: invoice.invoice_number,
    currency: invoice.currency,
    elements: invoice.elements,
    lines: invoice.lines.map((line) => ({ id: line.id, amount: line.amount })),
  };
}

function toLate(invoice: RunInvoice): LateInvoice {
  return {
    invoice_number: invoice.invoice_number,
    currency: invoice.currency,
    elements: invoice.elements,
    lines: invoice.lines.map((line) => ({ id: line.id, charged_to: line.charged_to, page: line.to_page })),
  };
}

function toFree(invoice: RunInvoice): FreeInvoice {
  return {
    invoice_number: invoice.invoice_number,
    currency: invoice.currency,
    elements: invoice.elements,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      container: line.container,
      charge: line.charge,
      charged_from: line.charged_from,
      charged_to: line.charged_to,
      amount: line.amount,
      from_page: line.from_page,
      to_page: line.to_page,
      amount_page: line.amount_page,
    })),
  };
}

function toArithmetic(invoice: RunInvoice): ArithmeticInvoice {
  return {
    invoice_number: invoice.invoice_number,
    currency: invoice.currency,
    elements: invoice.elements,
    unresolved: invoice.unresolved,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      charged_from: line.charged_from,
      charged_to: line.charged_to,
      days: line.days,
      rate: line.rate,
      amount: line.amount,
      from_page: line.from_page,
      to_page: line.to_page,
      days_page: line.days_page,
      rate_page: line.rate_page,
      amount_page: line.amount_page,
    })),
  };
}

function toDuplicate(invoice: RunInvoice, partyId: string): DuplicateInvoice {
  return {
    invoice_number: invoice.invoice_number,
    billing_party: partyId,
    currency: invoice.currency,
    elements: invoice.elements,
    unresolved: invoice.unresolved,
    lines: invoice.lines.map((line) => ({
      id: line.id,
      container: line.container,
      charge: line.charge,
      charged_from: line.charged_from,
      charged_to: line.charged_to,
      rate: line.rate,
      container_page: line.container_page,
      from_page: line.from_page,
      to_page: line.to_page,
      rate_page: line.rate_page,
    })),
  };
}

function repeatedNumbers(values: readonly RunInvoice[]): Set<string> {
  const counts = new Map<string, number>();
  for (const invoice of values) counts.set(invoice.invoice_number, (counts.get(invoice.invoice_number) ?? 0) + 1);
  const repeated = new Set<string>();
  for (const [number, count] of counts) {
    if (count > 1) repeated.add(number);
  }
  return repeated;
}

function compareFindings(left: ReportFinding, right: ReportFinding): number {
  const invoice = cmp(left.invoice_id, right.invoice_id);
  if (invoice !== 0) return invoice;
  const rule = RULES.indexOf(left.rule) - RULES.indexOf(right.rule);
  if (rule !== 0) return rule;
  const lines = cmp(left.line_ids.join("|"), right.line_ids.join("|"));
  if (lines !== 0) return lines;
  const amount = new Decimal(left.disputable_amount).comparedTo(right.disputable_amount);
  if (amount !== 0 && amount !== null) return amount;
  return cmp(left.explain, right.explain);
}

function compareNotes(left: NotEvaluable, right: NotEvaluable): number {
  const invoice = cmp(left.invoice_id, right.invoice_id);
  if (invoice !== 0) return invoice;
  return RULES.indexOf(left.rule) - RULES.indexOf(right.rule);
}

function cmp(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
