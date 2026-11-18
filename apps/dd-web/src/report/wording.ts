/**
 * Counsel wording for the client report.
 * Every sentence in the letter, the summary, the findings, the exhibits, and the scope page is in this file.
 * Callers fill numbers, dates, invoice numbers, and names. They do not write sentences.
 */

import { addDays } from "dd-core";
import { formatAmount } from "../review-format";

export const REPORT_SERIES = "TMR";
export const ISSUANCE_LIMIT_DAYS = 30;
export const CARRIER_RESPONSE_DAYS = 30;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
] as const;

const R1_KNOWN_OMISSION =
  "Free time start; Free time end; Rules certification; No-contribution certification";

const ABSENT_SEARCH: Record<string, string> = {
  "Free time start": "Free-time start",
  "Free time end": "Free-time end",
  "Rules certification": "rules compliance",
  "No-contribution certification": "no contribution",
};

export type RateBand = { fromDay: number; toDay?: number; perDay: string };

export type ReportLine = {
  id: string;
  container: string;
  chargedFrom: string;
  chargedTo: string;
  days: number;
  rate: string;
  amount: string;
};

export type ReportFindingInput = {
  rule: string;
  citations: readonly string[];
  lineIds: readonly string[];
  expected: string;
  actual: string;
  amount: string;
  explain: string;
  evidence: readonly { page: number | null; field: string }[];
};

export type CardCopy = {
  title: string;
  tableTitle: string;
  tableDetail: string;
  body: string;
  exhibit: string;
  calc: { label: string; value: string; tag: boolean }[];
  needles: string[];
  pages: number[];
  extraInvoices: string[];
};

export function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

export function capitalize(text: string): string {
  if (text === "") return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function longDate(iso: string): string {
  const parts = dateParts(iso);
  if (parts === null) return iso;
  return `${MONTHS[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

export function monthDay(iso: string): string {
  const parts = dateParts(iso);
  if (parts === null) return iso;
  return `${MONTHS[parts.month - 1]} ${parts.day}`;
}

export function shortMonthDay(iso: string): string {
  const parts = dateParts(iso);
  if (parts === null) return iso;
  return `${SHORT_MONTHS[parts.month - 1]} ${parts.day}`;
}

/** "January 20 to June 20, 2026" when the year is shared. */
export function dateSpan(dates: readonly string[]): string | null {
  const usable = dates.filter((date) => dateParts(date) !== null).sort();
  const first = usable[0];
  const last = usable[usable.length - 1];
  if (first === undefined || last === undefined) return null;
  if (first.slice(0, 4) === last.slice(0, 4)) return `${monthDay(first)} to ${longDate(last)}`;
  return `${longDate(first)} to ${longDate(last)}`;
}

export function carrierPhrase(names: readonly string[]): string {
  const unique = [...new Set(names.map((name) => name.trim()).filter((name) => name !== ""))].sort();
  if (unique.length === 0) return "the carriers named on the invoices";
  if (unique.length === 1) return unique[0] ?? "the carrier";
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

export function reviewedParagraph(invoiceCount: number, carrier: string, span: string | null): string {
  const count = countWord(invoiceCount);
  const dated = span === null ? "" : `, dated ${span}`;
  return `We have reviewed the ${count} demurrage invoices you sent from ${carrier}${dated}.`;
}

export function containSentence(findingInvoices: number): string {
  if (findingInvoices === 0) {
    return "None contain charges that can be disputed under the Federal Maritime Commission's billing rules or the carrier's own schedule.";
  }
  const opening = findingInvoices === 1 ? "One contains" : `${capitalize(countWord(findingInvoices))} contain`;
  return `${opening} charges that can be disputed under the Federal Maritime Commission's billing rules or the carrier's own schedule.`;
}

export function largestParagraph(text: string | null): string {
  const closer = "Each finding is set out in the enclosed report with the calculation and a copy of the relevant part of the invoice.";
  if (text === null) return closer;
  return `${text} ${closer}`;
}

export function largestR2(gap: number): string {
  const word = gap === 1 ? "day" : "days";
  return `The largest item is an invoice issued ${gap} ${word} after the charges ended, beyond the ${ISSUANCE_LIMIT_DAYS} days the rules allow.`;
}

export function largestR3(amount: string): string {
  return `The largest item is ${formatAmount(amount)} charged during free time.`;
}

export function largestR4(amount: string): string {
  return `The largest item is ${formatAmount(amount)} that the invoice's own figures do not support.`;
}

export function largestR5(amount: string, earlier: string): string {
  return `The largest item is ${formatAmount(amount)} for days already billed on ${earlier}.`;
}

export function largestR1(amount: string): string {
  return `The largest item is ${formatAmount(amount)} on an invoice missing required information.`;
}

export function largestManual(amount: string): string {
  return `The largest item is ${formatAmount(amount)} recorded by a reviewer.`;
}

export function approvalParagraph(carrier: string): string {
  return `With your approval, we will submit these disputes to ${carrier} on your behalf and handle the correspondence. If nothing is recovered, there is no fee. To proceed, please reply to this letter confirming your approval.`;
}

export function noFindingsParagraph(): string {
  return "None of these invoices contain a charge that can be disputed under those rules.";
}

export function enclosureLine(reportNumber: string): string {
  return `Enclosure: Demurrage and Detention Audit, report ${reportNumber}`;
}

export function reLine(reportNumber: string): string {
  return `Re: Demurrage and detention audit · report ${reportNumber}`;
}

export function attentionLine(customerName: string): string {
  return `${customerName}\nAttention: Accounts Payable`;
}

export function summarySub(carrier: string, span: string | null, issued: string): string {
  const dated = span === null ? `Invoices from ${carrier}` : `Invoices from ${carrier} dated ${span}`;
  return `${dated} · issued ${issued}`;
}

export function conventionNote(chosen: "day0" | "day1", otherAmount: string): string {
  const chosenLabel = chosen === "day1" ? "Day 1" : "Day 0";
  const otherLabel = chosen === "day1" ? "day 0" : "day 1";
  return `${chosenLabel} count · ${otherLabel} gives ${formatAmount(otherAmount)}`;
}

export function billedNote(amount: string): string {
  return `${formatAmount(amount)} billed`;
}

export function findingsNote(count: number): string {
  return count === 1 ? "1 finding" : `${count} findings`;
}

export function largestNote(ruleLabel: string, amount: string): string {
  return `${ruleLabel} · ${formatAmount(amount)}`;
}

export function amberNote(): string {
  return "Amber: the amount depends on how free-time days are counted (see Scope). Each dollar is counted once.";
}

export function nextSteps(carrier: string, fee: string): string[] {
  return [
    `You confirm by email that we may dispute these charges with ${carrier}.`,
    `We send each dispute to the carrier's dispute contact with the invoice pages attached. The carrier has ${CARRIER_RESPONSE_DAYS} days to respond.`,
    `We report each outcome. Our ${fee} fee applies only to amounts refunded or credited.`,
  ];
}

export function exhibitIntro(): string {
  return "Each exhibit is part of the invoice as received. Outlines mark the items discussed.";
}

export function methodParagraph(): string {
  return "Each invoice was checked for the information the federal billing rules require, invoice timing, charges during free time, arithmetic, and days billed twice. Every value used was read from the invoice and confirmed by a reviewer against the page before any check ran.";
}

export function limitationsParagraph(): string {
  return "These amounts are claims. The carrier may accept, reduce or reject them, and the amount recovered may differ. This report is not legal advice.";
}

export function scopeNote(input: {
  chosen: "day0" | "day1";
  lower: boolean;
  otherwise: string | null;
}): string {
  const counts = input.chosen === "day1" ? "This report counts it" : "This report does not count it";
  const comparison = input.lower ? `${counts}, which gives the lower amount.` : `${counts}. Both counts give the same total.`;
  const tail = input.otherwise === null ? "" : ` Otherwise ${input.otherwise}`;
  return `The rules do not settle whether the day a container becomes available counts as the first free day. ${comparison}${tail}`;
}

export function otherwiseOne(number: string, amount: string, total: string): string {
  return `finding ${number} is ${formatAmount(amount)} and the total ${formatAmount(total)}.`;
}

export function otherwiseMany(parts: readonly string[], total: string): string {
  return `${parts.join(", ")}, and the total ${formatAmount(total)}.`;
}

export function otherwisePart(number: string, amount: string): string {
  return `finding ${number} is ${formatAmount(amount)}`;
}

export function noFindingsTag(): string {
  return "No findings";
}

export function doNotPursueTag(): string {
  return "Do not pursue";
}

export function supersededTag(invoiceNumber: string): string {
  return `Superseded by ${invoiceNumber}`;
}

export function noAmountTag(): string {
  return "No amount in dispute";
}

export function findingResult(number: string): string {
  return `Finding ${number}`;
}

export function missingFileCaption(): string {
  return "The stored invoice file was not available, so this exhibit has no page image.";
}

export function footnoteText(citation: string): string {
  if (citation.startsWith("46 CFR")) return citation;
  return `${citation}, as cited on the invoice`;
}

const PAY_CITATION = "46 CFR 541.5";

export function cardCopy(
  findings: readonly ReportFindingInput[],
  lines: readonly ReportLine[],
  bands: readonly RateBand[],
  mark: (citations: readonly string[]) => string,
): CardCopy {
  const lead = largestFinding(findings);
  const rule = lead?.rule ?? "manual";
  if (rule === "R1") return r1Card(findings, mark);
  if (rule === "R2") return r2Card(findings, mark);
  if (rule === "R3") return r3Card(findings, lines, bands, mark);
  if (rule === "R4") return r4Card(findings, lines, mark);
  if (rule === "R5") return r5Card(findings, lines, mark);
  return manualCard(findings, mark);
}

export function r1SearchNeedles(expected: string): string[] {
  const labels = expected.split(";").map((part) => part.trim()).filter((part) => part !== "");
  const needles = labels.map((label) => ABSENT_SEARCH[label] ?? label);
  needles.push("Allowed free time");
  return needles;
}

function r1Card(findings: readonly ReportFindingInput[], mark: (citations: readonly string[]) => string): CardCopy {
  const finding = findings[0];
  const expected = finding?.expected ?? "";
  const labels = expected.split(";").map((part) => part.trim()).filter((part) => part !== "");
  const omission = expected === R1_KNOWN_OMISSION
    ? "the start and end dates of free time and both required certifications"
    : joinLabels(labels);
  const cites = finding?.citations ?? [];
  const body = `Federal rules list what every demurrage invoice must contain.${mark(cites)} This one omits ${omission}. An invoice missing required information does not obligate the billed party to pay.${mark([PAY_CITATION])}`;
  return {
    title: "Required information missing",
    tableTitle: labels.length > 1 ? `Required information missing · ${labels.length}` : "Required information missing",
    tableDetail: expected === R1_KNOWN_OMISSION ? "No free-time dates, no certifications" : `Missing ${omission}`,
    body,
    exhibit: expected === R1_KNOWN_OMISSION
      ? "Free time is stated, but no start or end date appears; neither certification appears."
      : "The cited items are not on the page.",
    calc: (expected === R1_KNOWN_OMISSION
      ? ["Free time start date", "Free time end date", "Certification of compliance", "Certification of no contribution"]
      : labels
    ).map((label) => ({ label, value: "Not shown", tag: true })),
    needles: r1SearchNeedles(expected),
    pages: pagesOf(findings),
    extraInvoices: [],
  };
}

function r2Card(findings: readonly ReportFindingInput[], mark: (citations: readonly string[]) => string): CardCopy {
  const finding = findings[0];
  const parsed = finding === undefined ? null : parseR2(finding.explain);
  const cites = mark(finding?.citations ?? []);
  const body = parsed === null
    ? `A carrier must issue a demurrage invoice within ${ISSUANCE_LIMIT_DAYS} days of the last day charged.${cites} ${finding?.explain ?? ""}`
    : `A carrier must issue a demurrage invoice within ${ISSUANCE_LIMIT_DAYS} days of the last day charged.${cites} These charges ended ${longDate(parsed.last)}; the invoice is dated ${longDate(parsed.invoice)}, ${parsed.gap} ${parsed.gap === 1 ? "day" : "days"} later. The full amount is disputed.`;
  const detail = parsed === null ? "Issued after the limit" : `Issued ${parsed.gap} ${parsed.gap === 1 ? "day" : "days"} after charges ended`;
  return {
    title: `Invoice issued after the ${ISSUANCE_LIMIT_DAYS}-day limit`,
    tableTitle: `Invoice issued after the ${ISSUANCE_LIMIT_DAYS}-day limit`,
    tableDetail: detail,
    body,
    exhibit: parsed === null
      ? "The invoice date and the last day charged."
      : `Dated ${monthDay(parsed.invoice)} for charges ending ${monthDay(parsed.last)}.`,
    calc: parsed === null
      ? [
          { label: "Expected", value: finding?.expected ?? "", tag: false },
          { label: "Actual", value: finding?.actual ?? "", tag: false },
        ]
      : [
          { label: "Last day charged", value: parsed.last, tag: false },
          { label: "Invoice date", value: parsed.invoice, tag: false },
          { label: "Days between", value: `${parsed.gap} · limit ${ISSUANCE_LIMIT_DAYS}`, tag: false },
        ],
    needles: parsed === null ? [] : [parsed.last, parsed.invoice],
    pages: pagesOf(findings),
    extraInvoices: [],
  };
}

function r3Card(
  findings: readonly ReportFindingInput[],
  lines: readonly ReportLine[],
  bands: readonly RateBand[],
  mark: (citations: readonly string[]) => string,
): CardCopy {
  const finding = findings[0];
  const parsed = finding === undefined ? null : parseR3(finding.explain);
  const chargedFrom = earliest(lines.map((line) => line.chargedFrom));
  const cites = mark(finding?.citations ?? []);
  const formula = parsed === null ? null : rateFormula(bands, parsed.chargeable, parsed.expected);
  const chargeableStart = parsed === null ? null : addDays(parsed.lastFree, 1);
  const body = parsed === null || chargedFrom === null || chargeableStart === null
    ? `The invoice bills days inside free time.${cites} ${finding?.explain ?? ""}`
    : `The invoice states free time ending ${longDate(parsed.lastFree)}, yet charges begin ${longDate(chargedFrom)}. Only ${longDate(chargeableStart)} to ${monthDay(parsed.chargedTo)} are chargeable${formula === null ? `, expected ${formatAmount(parsed.expected)}` : `, at ${formula.phrase}`}.${cites}`;
  const detail = parsed === null || chargedFrom === null
    ? "Charges during free time"
    : `Charged from ${shortMonthDay(chargedFrom)}; free time ends ${shortMonthDay(parsed.lastFree)}`;
  const billedDays = billedDayCount(finding?.actual ?? "");
  const calc = parsed === null || chargedFrom === null || chargeableStart === null
    ? [
        { label: "Expected", value: finding?.expected ?? "", tag: false },
        { label: "Actual", value: finding?.actual ?? "", tag: false },
      ]
    : [
        {
          label: `Billed ${shortRange(chargedFrom, parsed.chargedTo)}${billedDays === null ? "" : ` · ${billedDays} days`}`,
          value: formatAmount(parsed.billed),
          tag: false,
        },
        {
          label: `Correct ${shortRange(chargeableStart, parsed.chargedTo)}${formula === null ? "" : ` · ${formula.compact}`}`,
          value: formatAmount(parsed.expected),
          tag: false,
        },
        { label: "Overcharge", value: formatAmount(finding?.amount ?? "0.00"), tag: false },
      ];
  return {
    title: "Charges during free time",
    tableTitle: "Charges during free time",
    tableDetail: detail,
    body,
    exhibit: parsed === null || chargedFrom === null
      ? "Free time and the charged dates."
      : `Free time ends ${monthDay(parsed.lastFree)}; charges begin ${monthDay(chargedFrom)}.`,
    calc,
    needles: parsed === null ? [] : [parsed.lastFree, parsed.availability, parsed.chargedTo, chargedFrom ?? ""].filter((item) => item !== ""),
    pages: pagesOf(findings),
    extraInvoices: [],
  };
}

function r4Card(
  findings: readonly ReportFindingInput[],
  lines: readonly ReportLine[],
  mark: (citations: readonly string[]) => string,
): CardCopy {
  const lineFindings = findings.filter((finding) => parseR4Line(finding.explain) !== null);
  const totalFinding = findings.find((finding) => parseR4Total(finding.explain) !== null);
  const cites = mark(findings.flatMap((finding) => finding.citations));
  const sentences = lineFindings.map((finding) => lineSentence(finding, lines));
  const total = totalFinding === undefined ? null : parseR4Total(totalFinding.explain);
  const both = lineFindings.length > 0 && total !== null;
  const body = [
    sentences.join(" "),
    total === null ? "" : `${both ? "Separately, the" : "The"} total of ${formatAmount(total.printed)} exceeds the sum of the invoice's own lines.`,
    cites,
  ].filter((part) => part !== "").join(" ");
  const title = both
    ? "Arithmetic errors on a line and the total"
    : total !== null
      ? "An arithmetic error on the total"
      : lineFindings.length > 1
        ? "Arithmetic errors on the lines"
        : "An arithmetic error on a line";
  const tableTitle = findings.length > 1 ? `Arithmetic errors · ${findings.length}` : "Arithmetic error";
  const tableDetail = both
    ? "A line and the total do not add up"
    : total !== null
      ? "The total does not add up"
      : "A line does not add up";
  const calc: CardCopy["calc"] = [];
  const ordered = [...lines];
  ordered.forEach((line, index) => {
    const finding = lineFindings.find((item) => item.lineIds.length === 1 && item.lineIds[0] === line.id);
    const parsed = finding === undefined ? null : parseR4Line(finding.explain);
    if (parsed === null) {
      calc.push({ label: `Line ${index + 1} · ${line.days} × ${formatAmount(line.rate)}`, value: formatAmount(line.amount), tag: false });
      return;
    }
    calc.push({
      label: `Line ${index + 1} corrected · ${parsed.span} × ${formatAmount(parsed.rate)}`,
      value: formatAmount(parsed.product),
      tag: false,
    });
  });
  if (lineFindings.length === 0 && total !== null) {
    calc.push({ label: "Sum of the lines", value: formatAmount(total.sum), tag: false });
    calc.push({ label: "Invoice total", value: formatAmount(total.printed), tag: false });
  }
  const exhibit = both && lineFindings[0] !== undefined
    ? exhibitR4(lineFindings[0], total !== null)
    : total !== null
      ? "The total exceeds the lines."
      : "A line amount does not match its rate.";
  const needles = [
    ...lineFindings.flatMap((finding) => {
      const parsed = parseR4Line(finding.explain);
      return parsed === null ? [] : [parsed.rate, parsed.printed, parsed.product];
    }),
    ...(total === null ? [] : [total.printed, total.sum]),
  ];
  return {
    title,
    tableTitle,
    tableDetail,
    body: body === "" ? `The invoice figures do not agree.${cites}` : body,
    exhibit,
    calc,
    needles,
    pages: pagesOf(findings),
    extraInvoices: [],
  };
}

function r5Card(
  findings: readonly ReportFindingInput[],
  lines: readonly ReportLine[],
  mark: (citations: readonly string[]) => string,
): CardCopy {
  const finding = findings[0];
  const parsed = finding === undefined ? null : parseR5(finding.explain);
  const laterLine = parsed === null
    ? undefined
    : lines.find((line) => line.container === parsed.container && line.chargedFrom <= parsed.overlapEnd && line.chargedTo >= parsed.overlapStart);
  const cites = mark(finding?.citations ?? []);
  const body = parsed === null
    ? `Days on this invoice were already billed.${cites} ${finding?.explain ?? ""}`
    : `${parsed.earlier} charged container ${parsed.container} for ${monthSpan(parsed.earlierFrom, parsed.earlierTo, true)}. ${parsed.later} charges it again for ${monthSpan(laterLine?.chargedFrom ?? parsed.overlapStart, laterLine?.chargedTo ?? parsed.overlapEnd, false)}. The ${countWord(parsed.days)} ${parsed.days === 1 ? "day" : "days"} from ${monthSpan(parsed.overlapStart, parsed.overlapEnd, false)} ${parsed.days === 1 ? "is" : "are"} billed twice.${cites}`;
  const detail = parsed === null
    ? "Days already billed"
    : `${monthSpan(parsed.overlapStart, parsed.overlapEnd, false)}, container ${parsed.container}`;
  const calc = parsed === null
    ? [
        { label: "Expected", value: finding?.expected ?? "", tag: false },
        { label: "Actual", value: finding?.actual ?? "", tag: false },
      ]
    : [
        { label: "Days billed twice", value: `${shortRange(parsed.overlapStart, parsed.overlapEnd)} · ${parsed.days}`, tag: false },
        { label: "Daily rate", value: formatAmount(parsed.rate), tag: false },
        { label: "Overcharge", value: formatAmount(finding?.amount ?? parsed.amount), tag: false },
      ];
  return {
    title: "Days already billed on an earlier invoice",
    tableTitle: parsed === null ? "Days already billed on an earlier invoice" : `Days already billed on ${parsed.earlier}`,
    tableDetail: detail,
    body,
    exhibit: parsed === null
      ? "The same container on both invoices."
      : `The same container billed ${shortRange(parsed.earlierFrom, parsed.earlierTo)} (top) and ${shortRange(laterLine?.chargedFrom ?? parsed.overlapStart, laterLine?.chargedTo ?? parsed.overlapEnd)} (bottom).`,
    calc,
    needles: parsed === null ? [] : [parsed.container, parsed.overlapStart, parsed.overlapEnd, parsed.earlierFrom, parsed.earlierTo],
    pages: pagesOf(findings),
    extraInvoices: parsed === null ? [] : [parsed.earlier],
  };
}

function manualCard(findings: readonly ReportFindingInput[], mark: (citations: readonly string[]) => string): CardCopy {
  const finding = findings[0];
  return {
    title: "Recorded by a reviewer",
    tableTitle: findings.length > 1 ? `Manual · ${findings.length}` : "Manual",
    tableDetail: "Recorded by a reviewer",
    body: `A reviewer recorded this finding.${mark(finding?.citations ?? [])}`,
    exhibit: "The cited lines.",
    calc: [
      { label: "Expected", value: finding?.expected ?? "", tag: false },
      { label: "Actual", value: finding?.actual ?? "", tag: false },
    ],
    needles: [],
    pages: pagesOf(findings),
    extraInvoices: [],
  };
}

function lineSentence(finding: ReportFindingInput, lines: readonly ReportLine[]): string {
  const parsed = parseR4Line(finding.explain);
  if (parsed === null) return finding.explain;
  const index = lines.findIndex((line) => line.id === finding.lineIds[0]);
  const number = index >= 0 ? index + 1 : 1;
  const printed = printedDays(finding.actual) ?? parsed.span;
  return `Line ${number} bills ${printed} ${printed === 1 ? "day" : "days"} at ${formatAmount(parsed.rate)} as ${formatAmount(parsed.printed)}; ${countWord(parsed.span)} ${parsed.span === 1 ? "day" : "days"} at that rate is ${formatAmount(parsed.product)}.`;
}

function exhibitR4(finding: ReportFindingInput, withTotal: boolean): string {
  const parsed = parseR4Line(finding.explain);
  if (parsed === null) return "The figures that do not add up.";
  const days = `${parsed.span} ${parsed.span === 1 ? "day" : "days"} at ${formatAmount(parsed.rate)} billed as ${formatAmount(parsed.printed)}`;
  return withTotal ? `${days}; total exceeds the lines.` : `${days}.`;
}

function pagesOf(findings: readonly ReportFindingInput[]): number[] {
  const pages = new Set<number>();
  for (const finding of findings) {
    for (const item of finding.evidence) {
      if (item.page !== null) pages.add(item.page);
    }
  }
  return [...pages].sort((left, right) => left - right);
}

function largestFinding(findings: readonly ReportFindingInput[]): ReportFindingInput | null {
  let lead: ReportFindingInput | null = null;
  for (const finding of findings) {
    if (lead === null || cents(finding.amount) > cents(lead.amount)) lead = finding;
  }
  return lead;
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length === 0) return "required information";
  if (labels.length === 1) return labels[0] ?? "required information";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function parseR2(explain: string): { last: string; invoice: string; gap: number } | null {
  const match = /^Charges were last incurred on (\d{4}-\d{2}-\d{2})\. The invoice is dated (\d{4}-\d{2}-\d{2}), (\d+) days? later\.$/.exec(explain);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
  return { last: match[1], invoice: match[2], gap: Number(match[3]) };
}

function parseR3(explain: string): { availability: string; lastFree: string; chargedTo: string; chargeable: number; expected: string; billed: string } | null {
  const match = /^Availability (\d{4}-\d{2}-\d{2}), (\d+) free days?(?:, last free day (\d{4}-\d{2}-\d{2}))?\. Charged through (\d{4}-\d{2}-\d{2}) is (\d+) chargeable days?, expected ([\d.]+) [A-Z]{3}\. Billed ([\d.]+) [A-Z]{3}\.$/.exec(explain);
  if (match?.[1] === undefined || match[4] === undefined || match[5] === undefined || match[6] === undefined || match[7] === undefined) return null;
  return {
    availability: match[1],
    lastFree: match[3] ?? match[1],
    chargedTo: match[4],
    chargeable: Number(match[5]),
    expected: match[6],
    billed: match[7],
  };
}

function parseR4Line(explain: string): { span: number; rate: string; product: string; printed: string } | null {
  const match = /^\d{4}-\d{2}-\d{2} through \d{4}-\d{2}-\d{2} is (\d+) days?\. (?:The line says \d+ days?\. )?(\d+) × ([\d.]+) [A-Z]{3} is ([\d.]+) [A-Z]{3}\. The line amount is ([\d.]+) [A-Z]{3}\.$/.exec(explain);
  if (match?.[1] === undefined || match[3] === undefined || match[4] === undefined || match[5] === undefined) return null;
  return { span: Number(match[1]), rate: match[3], product: match[4], printed: match[5] };
}

function parseR4Total(explain: string): { sum: string; printed: string } | null {
  const match = /^The charge lines sum to ([\d.]+) [A-Z]{3}\. The invoice total is ([\d.]+) [A-Z]{3}\.$/.exec(explain);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return { sum: match[1], printed: match[2] };
}

function parseR5(explain: string): {
  earlier: string;
  container: string;
  earlierFrom: string;
  earlierTo: string;
  later: string;
  days: number;
  overlapStart: string;
  overlapEnd: string;
  rate: string;
  amount: string;
} | null {
  const match = /^(\S+) charged (\S+) \S+ from (\d{4}-\d{2}-\d{2}) through (\d{4}-\d{2}-\d{2})\. Overlap on (\S+) is (\d+) days?, (\d{4}-\d{2}-\d{2}) through (\d{4}-\d{2}-\d{2}), at ([\d.]+) [A-Z]{3} per day\.$/.exec(explain);
  if (
    match?.[1] === undefined
    || match[2] === undefined
    || match[3] === undefined
    || match[4] === undefined
    || match[5] === undefined
    || match[6] === undefined
    || match[7] === undefined
    || match[8] === undefined
    || match[9] === undefined
  ) {
    return null;
  }
  const days = Number(match[6]);
  const rate = match[9];
  return {
    earlier: match[1],
    container: match[2],
    earlierFrom: match[3],
    earlierTo: match[4],
    later: match[5],
    days,
    overlapStart: match[7],
    overlapEnd: match[8],
    rate,
    amount: ((cents(rate) * days) / 100).toFixed(2),
  };
}

function rateFormula(bands: readonly RateBand[], days: number, expected: string): { phrase: string; compact: string } | null {
  if (bands.length === 0 || days <= 0) return null;
  const used: { count: number; perDay: string; open: boolean }[] = [];
  let total = 0;
  for (const band of bands) {
    const lastDay = band.toDay ?? days;
    const first = Math.max(1, band.fromDay);
    const last = Math.min(days, lastDay);
    const count = last >= first ? last - first + 1 : 0;
    if (count === 0) continue;
    const per = cents(band.perDay);
    if (per === 0 && band.perDay !== "0.00") return null;
    total += count * per;
    used.push({ count, perDay: band.perDay, open: band.toDay === undefined });
  }
  if ((total / 100).toFixed(2) !== expected) return null;
  const compact = used.map((band) => `${band.count} × ${formatAmount(band.perDay)}`).join(" + ");
  if (used.length === 1) {
    const only = used[0];
    if (only === undefined) return null;
    return { phrase: `${formatAmount(only.perDay)} per day`, compact };
  }
  if (used.length === 2 && used[1]?.open === true) {
    const first = used[0];
    const second = used[1];
    if (first === undefined) return null;
    const word = first.count === 1 ? "day" : "days";
    return {
      phrase: `${formatAmount(first.perDay)} for the first ${countWord(first.count)} ${word} and ${formatAmount(second.perDay)} after`,
      compact,
    };
  }
  return null;
}

function billedDayCount(actual: string): number | null {
  const match = /^billed (\d+) days?/.exec(actual);
  if (match?.[1] === undefined) return null;
  return Number(match[1]);
}

function printedDays(actual: string): number | null {
  const match = /^printed (\d+) days?/.exec(actual);
  if (match?.[1] === undefined) return null;
  return Number(match[1]);
}

function earliest(dates: readonly string[]): string | null {
  const usable = dates.filter((date) => dateParts(date) !== null).sort();
  return usable[0] ?? null;
}

function monthSpan(from: string, to: string, withYear: boolean): string {
  const start = dateParts(from);
  const end = dateParts(to);
  if (start === null || end === null) return `${from} to ${to}`;
  if (start.year === end.year && start.month === end.month) {
    const tail = withYear ? `, ${start.year}` : "";
    return `${MONTHS[start.month - 1]} ${start.day} to ${end.day}${tail}`;
  }
  if (start.year === end.year) {
    const tail = withYear ? `, ${end.year}` : "";
    return `${monthDay(from)} to ${monthDay(to)}${tail}`;
  }
  return `${longDate(from)} to ${longDate(to)}`;
}

function shortRange(from: string, to: string): string {
  const start = dateParts(from);
  const end = dateParts(to);
  if (start === null || end === null) return `${from}–${to}`;
  if (start.year === end.year && start.month === end.month) return `${SHORT_MONTHS[start.month - 1]} ${start.day}–${end.day}`;
  return `${shortMonthDay(from)}–${shortMonthDay(to)}`;
}

function dateParts(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function cents(amount: string): number {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(amount);
  if (match?.[2] === undefined || match[3] === undefined) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 100 + Number(match[3]));
}
