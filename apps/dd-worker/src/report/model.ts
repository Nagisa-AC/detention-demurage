import { formatAmount, minusAmount, ruleLabel, sumAmounts } from "./format.js";
import {
  REPORT_SERIES,
  amberNote,
  approvalParagraph,
  attentionLine,
  billedNote,
  cardCopy,
  carrierPhrase,
  containSentence,
  citationFootnote,
  conventionNote,
  dateSpan,
  doNotPursueTag,
  enclosureLine,
  exhibitIntro,
  findingResult,
  findingsNote,
  findingsTotalLabel,
  largestManual,
  largestNote,
  largestParagraph,
  largestR1,
  largestR2,
  largestR3,
  largestR4,
  largestR5,
  limitationsParagraph,
  methodParagraph,
  missingFileCaption,
  nextSteps,
  noAmountTag,
  noFindingsParagraph,
  noFindingsTag,
  otherwiseMany,
  otherwiseOne,
  otherwisePart,
  reLine,
  reviewedParagraph,
  scopeNote,
  summarySub,
  supersededTag,
  type CardCopy,
  type RateBand,
  type ReportFindingInput,
  type ReportLine,
} from "./wording.js";

export type Money = { currency: string; amount: string };

export type ReportInvoiceAmount = {
  number: string;
  disputable: string;
  currency: string;
  doNotPursue: boolean;
  supersededBy: string;
};

export type ReportFindingSource = ReportFindingInput & { invoiceNumber: string };

export type ConventionSource = {
  total: readonly Money[];
  invoices: readonly ReportInvoiceAmount[];
  findings: readonly ReportFindingSource[];
};

export type SourceInvoice = {
  number: string;
  carrier: string;
  container: string;
  billed: string;
  currency: string;
  invoiceDate: string | null;
  partyId: string | null;
  lines: readonly ReportLine[];
  pdf: Uint8Array | null;
};

export type ReportBuild = {
  firmName: string;
  cityState: string;
  replyTo: string;
  signerName: string;
  signerTitle: string;
  customerName: string;
  reportNumber: string;
  runId: string;
  finishedAt: Date;
  issuedLong: string;
  convention: "day0" | "day1";
  feeLabel: string;
  headline: Money[];
  other: Money[];
  letter: string[];
  callout: { label: string; value: string; unit: string }[];
  re: string;
  attention: string;
  enclosure: string;
  summarySub: string;
  stats: { label: string; value: string; unit: string; note: string; mono: boolean }[];
  rows: {
    invoice: string;
    title: string;
    detail: string;
    billed: string;
    correct: string;
    dispute: string;
    amber: boolean;
  }[];
  total: { label: string; billed: string; correct: string; dispute: string } | null;
  amberNote: string | null;
  steps: string[];
  cards: {
    number: string;
    invoice: string;
    title: string;
    amount: string;
    amber: boolean;
    body: string;
    exhibitRef: string;
    billed: string;
    correct: string;
    dispute: string;
    calc: CardCopy["calc"];
  }[];
  footnotes: { n: number; text: string }[];
  exhibits: {
    letter: string;
    who: string;
    caption: string;
    clips: { invoiceNumber: string; pdf: Uint8Array; page: number; needles: string[] }[];
  }[];
  exhibitIntro: string;
  scope: { invoice: string; date: string; billed: string; result: string; tag: boolean }[];
  scopeTitle: string;
  scopeNoteTitle: string;
  scopeNote: string;
  methodTitle: string;
  method: string;
  limitsTitle: string;
  limits: string;
  csv: string;
};

export function buildReport(input: {
  firmName: string;
  cityState: string;
  replyTo: string;
  signerName: string;
  signerTitle: string;
  customerName: string;
  reportNumber: string;
  runId: string;
  finishedAt: string;
  feeLabel: string;
  rates: readonly { partyId: string; bands: readonly RateBand[] }[];
  day0: ConventionSource;
  day1: ConventionSource;
  invoices: readonly SourceInvoice[];
}): ReportBuild {
  const finishedAt = new Date(input.finishedAt);
  const issuedLong = issuedDate(finishedAt);
  const convention = lowerConvention(input.day0.total, input.day1.total);
  const chosen = convention === "day0" ? input.day0 : input.day1;
  const other = convention === "day0" ? input.day1 : input.day0;
  const invoices = new Map(input.invoices.map((invoice) => [invoice.number, invoice]));
  const chosenAmount = new Map(chosen.invoices.map((invoice) => [invoice.number, invoice]));
  const otherAmount = new Map(other.invoices.map((invoice) => [invoice.number, invoice]));
  const findingsByInvoice = new Map<string, ReportFindingSource[]>();
  for (const finding of chosen.findings) {
    const list = findingsByInvoice.get(finding.invoiceNumber) ?? [];
    list.push(finding);
    findingsByInvoice.set(finding.invoiceNumber, list);
  }

  const catalog = new Map<string, number>();
  const mark = (citations: readonly string[]): string => markCitations(citations, catalog);

  const cards: ReportBuild["cards"] = [];
  const included = chosen.invoices
    .filter((invoice) => !invoice.doNotPursue && invoice.supersededBy === "" && cents(invoice.disputable) > 0)
    .sort((left, right) => cents(right.disputable) - cents(left.disputable) || left.number.localeCompare(right.number));
  const letterByInvoice = new Map<string, string>();
  [...included]
    .sort((left, right) => left.number.localeCompare(right.number))
    .forEach((amount, index) => letterByInvoice.set(amount.number, exhibitLetter(index)));

  for (const amount of included) {
    const source = invoices.get(amount.number);
    const findings = findingsByInvoice.get(amount.number) ?? [];
    if (source === undefined || findings.length === 0) continue;
    const bands = input.rates.find((rate) => rate.partyId === source.partyId)?.bands ?? [];
    const copy = cardCopy(findings, source.lines, bands, mark);
    const correct = minusAmount(source.billed, amount.disputable) ?? source.billed;
    const amber = (otherAmount.get(amount.number)?.disputable ?? amount.disputable) !== amount.disputable;
    const letter = letterByInvoice.get(amount.number) ?? exhibitLetter(cards.length);
    const calc = copy.title.includes("rithmetic")
      ? [...copy.calc, { label: "Correct total", value: correct, tag: false }]
      : copy.calc;
    cards.push({
      number: String(cards.length + 1).padStart(2, "0"),
      invoice: amount.number,
      title: copy.title,
      amount: formatAmount(amount.disputable),
      amber,
      body: copy.body,
      exhibitRef: amber ? `Exhibit ${letter} · day count on the scope page` : `Exhibit ${letter}`,
      billed: formatAmount(source.billed),
      correct,
      dispute: formatAmount(amount.disputable),
      calc,
    });
  }

  const rows = cards.map((card) => {
    const amount = chosenAmount.get(card.invoice);
    const source = invoices.get(card.invoice);
    const findings = findingsByInvoice.get(card.invoice) ?? [];
    const bands = input.rates.find((rate) => rate.partyId === source?.partyId)?.bands ?? [];
    const copy = source === undefined ? null : cardCopy(findings, source.lines, bands, () => "");
    return {
      invoice: card.invoice,
      title: copy?.tableTitle ?? card.title,
      detail: copy?.tableDetail ?? "",
      billed: card.billed,
      correct: card.correct,
      dispute: card.dispute,
      amber: (otherAmount.get(card.invoice)?.disputable ?? amount?.disputable) !== amount?.disputable,
    };
  });

  const carrier = carrierPhrase(input.invoices.map((invoice) => invoice.carrier));
  const span = dateSpan(input.invoices.map((invoice) => invoice.invoiceDate ?? "").filter((date) => date !== ""));
  const findingCount = cards.reduce((sum, card) => sum + (findingsByInvoice.get(card.invoice)?.length ?? 0), 0);
  const billedAll = sumAmounts(input.invoices.map((invoice) => invoice.billed).filter((amount) => amount !== ""));
  const lead = cards[0];
  const leadFindings = lead === undefined ? [] : findingsByInvoice.get(lead.invoice) ?? [];
  const leadRule = leadRuleOf(leadFindings);
  const largestText = lead === undefined || chosenAmount.get(lead.invoice) === undefined
    ? null
    : largestTextFor(leadRule, chosenAmount.get(lead.invoice)?.disputable ?? "0.00", leadFindings);

  const letter = [
    `${reviewedParagraph(input.invoices.length, carrier, span)} ${containSentence(cards.length)}`,
    cards.length === 0 ? noFindingsParagraph() : largestParagraph(largestText),
    approvalParagraph(carrier),
  ];

  const headline = [...chosen.total];
  const otherTotal = [...other.total];
  const primary = headline[0];
  const otherPrimary = otherTotal[0];
  const scopeRows = scopeOf(input.invoices, chosenAmount, cards);
  const differing = cards.filter((card) => card.amber);
  const otherwise = differing.length === 0 || otherPrimary === undefined
    ? null
    : differing.length === 1
      ? otherwiseOne(differing[0]?.number ?? "", otherAmount.get(differing[0]?.invoice ?? "")?.disputable ?? "0.00", otherPrimary.amount)
      : otherwiseMany(
          differing.map((card) => otherwisePart(card.number, otherAmount.get(card.invoice)?.disputable ?? "0.00")),
          otherPrimary.amount,
        );

  const exhibits = [...included]
    .sort((left, right) => left.number.localeCompare(right.number))
    .map((amount) => {
    const source = invoices.get(amount.number);
    const findings = findingsByInvoice.get(amount.number) ?? [];
    const bands = input.rates.find((rate) => rate.partyId === source?.partyId)?.bands ?? [];
    const copy = source === undefined ? null : cardCopy(findings, source.lines, bands, () => "");
    const letter = letterByInvoice.get(amount.number) ?? "";
    const extras = copy?.extraInvoices ?? [];
    const pages = copy?.pages.length ? copy.pages : [1];
    const needles = copy?.needles ?? [];
    const clips: ReportBuild["exhibits"][number]["clips"] = [];
    for (const invoiceNumber of [...extras, amount.number]) {
      const file = invoices.get(invoiceNumber);
      if (file?.pdf === undefined || file.pdf === null) continue;
      const clipPages = invoiceNumber === amount.number ? pages : [1];
      for (const page of clipPages) {
        clips.push({ invoiceNumber, pdf: file.pdf, page, needles });
      }
    }
    const who = extras.length === 0
      ? `${amount.number} · p.${pages[0] ?? 1}`
      : `${extras.join(" / ")} / ${amount.number}`;
    return {
      letter,
      who,
      caption: clips.length === 0 ? missingFileCaption() : (copy?.exhibit ?? ""),
      clips,
    };
  });

  const footnotes = [...catalog.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([text, n]) => ({ n, text }));

  return {
    firmName: input.firmName,
    cityState: input.cityState,
    replyTo: input.replyTo,
    signerName: input.signerName,
    signerTitle: input.signerTitle,
    customerName: input.customerName,
    reportNumber: input.reportNumber,
    runId: input.runId,
    finishedAt,
    issuedLong,
    convention,
    feeLabel: input.feeLabel,
    headline,
    other: otherTotal,
    letter,
    callout: [
      { label: "In dispute", value: primary === undefined ? "0.00" : formatAmount(primary.amount), unit: primary?.currency ?? "" },
      { label: "Invoices with findings", value: String(cards.length), unit: `of ${input.invoices.length}` },
      { label: "Our fee", value: input.feeLabel, unit: "of recovered" },
    ],
    re: reLine(input.reportNumber),
    attention: attentionLine(input.customerName),
    enclosure: enclosureLine(input.reportNumber),
    summarySub: summarySub(carrier, span, issuedLong),
    stats: [
      {
        label: "In dispute",
        value: primary === undefined ? "0.00" : formatAmount(primary.amount),
        unit: primary?.currency ?? "",
        note: otherPrimary === undefined
          ? ""
          : conventionNote(
              convention,
              otherPrimary.amount,
              primary !== undefined && cents(primary.amount) === cents(otherPrimary.amount),
            ),
        mono: false,
      },
      {
        label: "Invoices",
        value: String(input.invoices.length),
        unit: "",
        note: billedAll === null ? "" : billedNote(billedAll.replaceAll(",", "")),
        mono: false,
      },
      {
        label: "With findings",
        value: String(cards.length),
        unit: "",
        note: findingsNote(findingCount),
        mono: false,
      },
      {
        label: "Largest",
        value: lead?.invoice ?? "—",
        unit: "",
        note: lead === undefined || leadRule === null ? "None" : largestNote(ruleLabel(leadRule), rawAmount(lead.dispute)),
        mono: lead !== undefined,
      },
    ],
    rows,
    total: totalRow(rows),
    amberNote: rows.some((row) => row.amber) ? amberNote() : null,
    steps: nextSteps(carrier, input.feeLabel),
    cards,
    footnotes,
    exhibits,
    exhibitIntro: exhibitIntro(),
    scope: scopeRows,
    scopeTitle: "Scope, method and limitations",
    scopeNoteTitle: "How free-time days are counted.",
    scopeNote: scopeNote({
      chosen: convention,
      lower: primary !== undefined && otherPrimary !== undefined && cents(primary.amount) < cents(otherPrimary.amount),
      otherwise,
    }),
    methodTitle: "Method",
    method: methodParagraph(),
    limitsTitle: "Limitations",
    limits: limitationsParagraph(),
    csv: csvFrom({
      day0: input.day0,
      day1: input.day1,
      invoices: input.invoices,
      findings: chosen.findings.filter((finding) => {
        const amount = chosenAmount.get(finding.invoiceNumber);
        return amount !== undefined && !amount.doNotPursue && amount.supersededBy === "" && cents(amount.disputable) > 0;
      }),
    }),
  };
}

export function reportNumber(year: number, sequence: number): string {
  return `${REPORT_SERIES}-${year}-${String(sequence).padStart(3, "0")}`;
}

export function issuedYear(finishedAt: Date): number {
  return zoned(finishedAt).year;
}

export function csvFrom(input: {
  day0: ConventionSource;
  day1: ConventionSource;
  invoices: readonly SourceInvoice[];
  findings: readonly ReportFindingSource[];
}): string {
  const invoices = new Map(input.invoices.map((invoice) => [invoice.number, invoice]));
  const day0 = new Map(input.day0.invoices.map((invoice) => [invoice.number, invoice]));
  const day1 = new Map(input.day1.invoices.map((invoice) => [invoice.number, invoice]));
  const header = [
    "invoice",
    "carrier",
    "container",
    "check",
    "citation",
    "billed",
    "in dispute (day 1)",
    "in dispute (day 0)",
    "invoice date",
  ];
  const lines = [header.join(",")];
  const ordered = [...input.findings].sort((left, right) => left.invoiceNumber.localeCompare(right.invoiceNumber) || left.rule.localeCompare(right.rule));
  for (const finding of ordered) {
    const invoice = invoices.get(finding.invoiceNumber);
    const stored0 = day0.get(finding.invoiceNumber);
    const stored1 = day1.get(finding.invoiceNumber);
    if (stored1?.doNotPursue || stored1?.supersededBy) continue;
    lines.push(
      [
        finding.invoiceNumber,
        invoice?.carrier ?? "",
        invoice?.container ?? "",
        ruleLabel(finding.rule),
        finding.citations.join("; "),
        invoice?.billed ?? "",
        stored1?.disputable ?? "",
        stored0?.disputable ?? "",
        invoice?.invoiceDate ?? "",
      ].map(csvCell).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function totalRow(rows: ReportBuild["rows"]): ReportBuild["total"] {
  if (rows.length === 0) return null;
  const billed = sumAmounts(rows.map((row) => rawAmount(row.billed)));
  const correct = sumAmounts(rows.map((row) => rawAmount(row.correct)));
  const dispute = sumAmounts(rows.map((row) => rawAmount(row.dispute)));
  if (billed === null || correct === null || dispute === null) return null;
  return { label: findingsTotalLabel(billed, correct), billed, correct, dispute };
}

function scopeOf(
  invoices: readonly SourceInvoice[],
  chosen: ReadonlyMap<string, ReportInvoiceAmount>,
  cards: readonly { number: string; invoice: string }[],
): ReportBuild["scope"] {
  const cardOf = new Map(cards.map((card) => [card.invoice, card.number]));
  return [...invoices]
    .sort((left, right) => left.number.localeCompare(right.number))
    .map((invoice) => {
      const amount = chosen.get(invoice.number);
      const card = cardOf.get(invoice.number);
      if (amount?.doNotPursue) return { invoice: invoice.number, date: invoice.invoiceDate ?? "", billed: formatAmount(invoice.billed), result: doNotPursueTag(), tag: true };
      if (amount?.supersededBy) return { invoice: invoice.number, date: invoice.invoiceDate ?? "", billed: formatAmount(invoice.billed), result: supersededTag(amount.supersededBy), tag: true };
      if (card !== undefined) return { invoice: invoice.number, date: invoice.invoiceDate ?? "", billed: formatAmount(invoice.billed), result: findingResult(card), tag: false };
      if (amount !== undefined && cents(amount.disputable) === 0) {
        return { invoice: invoice.number, date: invoice.invoiceDate ?? "", billed: formatAmount(invoice.billed), result: noFindingsTag(), tag: true };
      }
      return { invoice: invoice.number, date: invoice.invoiceDate ?? "", billed: formatAmount(invoice.billed), result: noAmountTag(), tag: true };
    });
}

function largestTextFor(rule: string | null, amount: string, findings: readonly ReportFindingSource[]): string | null {
  if (rule === null) return null;
  if (rule === "R2") {
    const gap = gapOf(findings.find((finding) => finding.rule === "R2")?.explain ?? "");
    return gap === null ? largestR2(0).replace("0 days", "the days recorded on the invoice") : largestR2(gap);
  }
  if (rule === "R3") return largestR3(amount);
  if (rule === "R4") return largestR4(amount);
  if (rule === "R5") {
    const earlier = earlierOf(findings.find((finding) => finding.rule === "R5")?.explain ?? "");
    return largestR5(amount, earlier ?? "an earlier invoice");
  }
  if (rule === "R1") return largestR1(amount);
  return largestManual(amount);
}

function leadRuleOf(findings: readonly ReportFindingSource[]): string | null {
  let lead: ReportFindingSource | null = null;
  for (const finding of findings) {
    if (lead === null || cents(finding.amount) > cents(lead.amount)) lead = finding;
  }
  return lead?.rule ?? null;
}

function gapOf(explain: string): number | null {
  const match = /, (\d+) days? later\.$/.exec(explain);
  if (match?.[1] === undefined) return null;
  return Number(match[1]);
}

function earlierOf(explain: string): string | null {
  const match = /^(\S+) charged /.exec(explain);
  return match?.[1] ?? null;
}

function lowerConvention(day0: readonly Money[], day1: readonly Money[]): "day0" | "day1" {
  const left = new Map(day0.map((total) => [total.currency, cents(total.amount)]));
  const right = new Map(day1.map((total) => [total.currency, cents(total.amount)]));
  const currencies = [...new Set([...left.keys(), ...right.keys()])].sort();
  let sign = 0;
  for (const currency of currencies) {
    const delta = (left.get(currency) ?? 0) - (right.get(currency) ?? 0);
    if (delta === 0) continue;
    const next = delta < 0 ? -1 : 1;
    if (sign !== 0 && sign !== next) return "day1";
    sign = next;
  }
  // A tie uses day 1, which counts the availability day as a free day.
  if (sign < 0) return "day0";
  return "day1";
}

function markCitations(citations: readonly string[], catalog: Map<string, number>): string {
  if (citations.length === 0) return "";
  const text = citationFootnote(citations);
  const existing = catalog.get(text);
  if (existing !== undefined) return superscript(existing);
  const n = catalog.size + 1;
  catalog.set(text, n);
  return superscript(n);
}

function superscript(n: number): string {
  const digits = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return String(n)
    .split("")
    .map((digit) => digits[Number(digit)] ?? digit)
    .join("");
}

function exhibitLetter(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

function issuedDate(date: Date): string {
  const parts = zoned(date);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

function zoned(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function rawAmount(formatted: string): string {
  return formatted.replaceAll(",", "");
}

function cents(amount: string): number {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(amount.replaceAll(",", ""));
  if (match?.[2] === undefined || match[3] === undefined) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 100 + Number(match[3]));
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll("\"", "\"\"")}"`;
  return value;
}

export function csvInvoiceTotals(csv: string, column: "in dispute (day 1)" | "in dispute (day 0)"): Map<string, string> {
  const lines = csv.trim().split("\n");
  const header = splitCsv(lines[0] ?? "");
  const invoiceAt = header.indexOf("invoice");
  const amountAt = header.indexOf(column);
  const totals = new Map<string, string>();
  for (const line of lines.slice(1)) {
    if (line === "") continue;
    const cells = splitCsv(line);
    const invoice = cells[invoiceAt];
    const amount = cells[amountAt];
    if (invoice === undefined || amount === undefined) continue;
    totals.set(invoice, amount);
  }
  return totals;
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === "\"" && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else if (char === "\"") quoted = false;
      else current += char;
      continue;
    }
    if (char === "\"") quoted = true;
    else if (char === ",") {
      cells.push(current);
      current = "";
    } else current += char;
  }
  cells.push(current);
  return cells;
}
