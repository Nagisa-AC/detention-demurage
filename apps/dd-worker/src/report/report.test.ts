import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ELEMENT_KEYS,
  assignPresence,
  fixtureTruthSchema,
  loadCustomerConfig,
  pageExtractionSchema,
  runRules,
  startReview,
  stitch,
  type FixtureTruth,
  type PageExtraction,
  type PrintedChargeLine,
  type RunInvoice,
  type RunReport,
  type StitchedInvoice,
} from "dd-core";
import { describe, expect, it } from "vitest";
import { renderReport } from "./assemble.js";
import { clipInvoicePage, renderClip } from "./exhibits.js";
import { sumAmounts } from "./format.js";
import { buildReport, csvInvoiceTotals, type ConventionSource, type SourceInvoice } from "./model.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixtureDir = path.join(repoRoot, "fixtures/synthetic");
const harborPath = path.join(repoRoot, "fixtures/config/harbor_home.yaml");
const removed = ["free_time_start", "free_time_end", "cert_rules_compliance", "cert_no_contribution"] as const;
const files: Record<string, string> = {
  "SYN-1001": "clean.pdf",
  "SYN-1002": "missing_elements.pdf",
  "SYN-1003": "late_37.pdf",
  "SYN-1004": "free_time_overbill.pdf",
  "SYN-1005": "arithmetic.pdf",
  "SYN-1006": "duplicate_a.pdf",
  "SYN-1007": "duplicate_b.pdf",
  "SYN-1008": "split_row.pdf",
};
const ids = ["clean", "missing_elements", "late_37", "free_time_overbill", "arithmetic", "duplicate_a", "duplicate_b", "split_row"] as const;

describe("report export", () => {
  it("matches the run totals in the PDF and the CSV, and the same run renders the same bytes", async () => {
    const model = harborReport();
    expect(model.convention).toBe("day1");
    expect(model.headline).toEqual([{ currency: "USD", amount: "3000.00" }]);
    expect(model.other).toEqual([{ currency: "USD", amount: "3250.00" }]);
    expect(model.rows.map((row) => row.invoice)).toEqual(["SYN-1003", "SYN-1007", "SYN-1004", "SYN-1005", "SYN-1002"]);
    expect(model.rows.map((row) => row.dispute)).toEqual(["1,100.00", "600.00", "500.00", "500.00", "300.00"]);
    expect(model.rows.find((row) => row.invoice === "SYN-1004")?.amber).toBe(true);
    expect(model.scope.find((row) => row.invoice === "SYN-1001")?.result).toBe("No findings");

    const day1 = csvInvoiceTotals(model.csv, "in dispute (day 1)");
    const day0 = csvInvoiceTotals(model.csv, "in dispute (day 0)");
    expect(plain(sumAmounts([...day1.values()]))).toBe("3000.00");
    expect(plain(sumAmounts([...day0.values()]))).toBe("3250.00");
    expect(day1.get("SYN-1005")).toBe("500.00");
    expect(model.csv.match(/SYN-1005/g)?.length).toBe(2);

    const late = fs.readFileSync(path.join(fixtureDir, "late_37.pdf"));
    const lateClip = await renderClip(new Uint8Array(late), 1, ["2026-04-08", "2026-03-02"]);
    expect(lateClip).not.toBeNull();
    const lateText = await pdfText(lateClip ?? new Uint8Array());
    expect(lateText).toContain("2026-04-08");
    expect(lateText).toContain("2026-03-02");
    expect(lateText).not.toContain("SYN-1002");
    const bounds = await clipInvoicePage(new Uint8Array(late), 1, ["2026-04-08", "2026-03-02"]);
    expect(bounds?.page).toBe(1);
    expect(bounds?.left).toBe(0);
    expect(bounds?.right).toBe(612);
    expect(bounds?.pageWidth).toBe(612);
    const lateHeight = (bounds?.top ?? 0) - (bounds?.bottom ?? 0);
    expect(lateHeight).toBeGreaterThan(200);
    expect(lateHeight).toBeLessThan(700);
    const chargeRow = bounds?.boxes.filter((box) => box.y < 320) ?? [];
    expect(chargeRow).toHaveLength(1);
    expect(chargeRow[0]?.x).toBeGreaterThan(280);
    const missingPdf = new Uint8Array(fs.readFileSync(path.join(fixtureDir, "missing_elements.pdf")));
    const missingBounds = await clipInvoicePage(missingPdf, 1, ["Allowed free time", "Free-time start", "rules compliance", "no contribution"]);
    expect(missingBounds?.pageWidth).toBe(bounds?.pageWidth);
    expect((missingBounds?.top ?? 0) - (missingBounds?.bottom ?? 0)).toBeLessThan(80);

    expect(model.footnotes.map((note) => note.text)).toContain("46 CFR 541.6(b)(4), (b)(5), (e)(1), (e)(2)");
    const missingCard = model.cards.find((card) => card.invoice === "SYN-1002");
    expect(missingCard?.body.split("This one omits")[0]?.match(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g)).toHaveLength(1);
    expect(model.stats[0]?.note).toBe("Day 1 count · day 0 gives 3,250.00");
    expect(model.total?.label).toBe("Billed 7,450.00 → correct 4,450.00");

    const exhibit = model.exhibits.find((item) => item.who.startsWith("SYN-1003"));
    expect(exhibit?.clips.map((clip) => clip.page)).toEqual([1]);
    expect(exhibit?.clips[0]?.pdf.byteLength).toBe(late.byteLength);

    const first = await renderReport(model);
    const second = await renderReport(model);
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
    const text = await pdfText(first);
    expect(text).toContain("3,000.00");
    expect(text).toContain("3,250.00");
    expect(text).toContain("TMR-2026-001");
    expect(text).toContain("Ibrahim Kebbeh");
    expect(text).toContain("Invoice issued after the 30-day limit");
    expect(text).toContain("Billed 7,450.00 → correct 4,450.00");
    expect(text).toContain("46 CFR 541.6(b)(4), (b)(5), (e)(1), (e)(2)");
    const peakKb = process.resourceUsage().maxRSS;
    expect(peakKb, `peak rss ${peakKb} KiB`).toBeLessThan(512 * 1024);
    fs.writeFileSync("/tmp/harbor-report.pdf", first);
  }, 60_000);

  it("labels an equal day count and the billed-to-correct total on the three-invoice report", async () => {
    const model = harborReport(["clean", "missing_elements", "late_37"]);
    expect(model.headline).toEqual([{ currency: "USD", amount: "1400.00" }]);
    expect(model.other).toEqual([{ currency: "USD", amount: "1400.00" }]);
    expect(model.stats[0]?.note).toBe("Both counts give the same total");
    expect(model.total?.label).toBe("Billed 1,400.00 → correct 0.00");
    const pdf = await renderReport(model);
    fs.writeFileSync("/tmp/live-style-report.pdf", pdf);
    const text = await pdfText(pdf);
    expect(text).toContain("Both counts give the same total");
    expect(text).toContain("Billed 1,400.00 → correct 0.00");
    expect(text).not.toContain("day 0 gives");
  }, 60_000);
});

function harborReport(only?: readonly (typeof ids)[number][]) {
  const config = loadCustomerConfig(harborPath);
  const chosen = only === undefined ? [...ids] : ids.filter((id) => only.includes(id));
  const loaded = chosen.map((id) => load(id));
  const invoices = loaded.map((entry) => (entry.invoice.invoice_number === "SYN-1002" ? reviewedMissing(entry) : entry.invoice));
  const parties = Object.fromEntries(invoices.map((invoice) => [invoice.invoice_number, "sample_line"]));
  const day1 = runRules(invoices, config, "day1", parties, []);
  const day0 = runRules(invoices, config, "day0", parties, []);
  const rates = (config.contract_terms ?? []).map((term) => ({
    partyId: term.billing_party,
    bands: term.rates.filter((rate) => rate.charge === "demurrage").map((rate) => ({
      fromDay: rate.from_day,
      perDay: rate.per_day,
      ...(rate.to_day === undefined ? {} : { toDay: rate.to_day }),
    })),
  }));
  return buildReport({
    firmName: "Tidemark Recovery",
    cityState: "New Haven, CT",
    replyTo: "disputes@tidemark.example",
    signerName: "Ibrahim Kebbeh",
    signerTitle: "Principal",
    customerName: "Harbor Home Goods",
    reportNumber: "TMR-2026-001",
    runId: "8f3c1a20-6b14-4d55-9c0e-1a2b3c4d5e6f",
    finishedAt: "2026-11-18T16:00:00.000Z",
    feeLabel: "25%",
    rates,
    day0: convention(day0),
    day1: convention(day1),
    invoices: loaded.map((entry) => sourceInvoice(entry.invoice.invoice_number === "SYN-1002" ? reviewedMissing(entry) : entry.invoice, entry.truth.billing_party)),
  });
}

function convention(report: RunReport): ConventionSource {
  return {
    total: report.total_disputable,
    invoices: report.invoices.map((invoice) => ({
      number: invoice.invoice_id,
      disputable: invoice.disputable,
      currency: invoice.currency,
      doNotPursue: invoice.do_not_pursue,
      supersededBy: invoice.superseded_by,
    })),
    findings: report.findings.map((finding) => ({
      invoiceNumber: finding.invoice_id,
      rule: finding.rule,
      citations: [...finding.citations],
      lineIds: [...finding.line_ids],
      expected: finding.expected,
      actual: finding.actual,
      amount: finding.disputable_amount,
      explain: finding.explain,
      evidence: finding.evidence.map((item) => ({ page: item.page, field: item.field })),
    })),
  };
}

function sourceInvoice(invoice: RunInvoice, carrier: string): SourceInvoice {
  const file = files[invoice.invoice_number];
  if (file === undefined) throw new Error(invoice.invoice_number);
  return {
    number: invoice.invoice_number,
    carrier,
    container: invoice.lines[0]?.container ?? "",
    billed: moneyElement(invoice.elements.total_due),
    currency: invoice.currency,
    invoiceDate: dateElement(invoice.elements.invoice_date),
    partyId: "sample_line",
    pdf: new Uint8Array(fs.readFileSync(path.join(fixtureDir, file))),
    lines: invoice.lines.map((line) => ({
      id: line.id,
      container: line.container,
      chargedFrom: line.charged_from,
      chargedTo: line.charged_to,
      days: Number(line.days),
      rate: line.rate,
      amount: line.amount,
    })),
  };
}

function reviewedMissing(entry: { invoice: RunInvoice; stitched: StitchedInvoice; elements: ReturnType<typeof assignPresence>; truth: FixtureTruth }): RunInvoice {
  const session = startReview({
    documentHash: "hash-missing",
    invoice: entry.stitched,
    elements: entry.elements,
    pages: entry.truth.pages,
    name: "Reviewer",
    at: "2026-11-09T21:13:00Z",
  });
  for (let page = 1; page <= entry.truth.pages; page += 1) session.acknowledge(page);
  for (const key of removed) session.confirmAbsent(key);
  session.approveLines();
  return toRun(entry.stitched, session.finish().elements);
}

function moneyElement(element: { state: string; text?: string; value?: string }): string {
  if (element.state !== "present") return "0.00";
  if (element.value !== undefined && /^\d+\.\d{2}$/.test(element.value)) return element.value;
  const match = element.text?.match(/(\d+\.\d{2})/);
  return match?.[1] ?? "0.00";
}

function dateElement(element: { state: string; text?: string; value?: string }): string | null {
  if (element.state !== "present") return null;
  const value = element.value ?? element.text ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function load(id: string): { invoice: RunInvoice; stitched: StitchedInvoice; elements: ReturnType<typeof assignPresence>; truth: FixtureTruth } {
  const truth = fixtureTruthSchema.parse(JSON.parse(fs.readFileSync(path.join(fixtureDir, `${id}.json`), "utf8"))) as FixtureTruth;
  const stitched = stitch(pagesFromTruth(truth));
  const elements = assignPresence(stitched, "import");
  return { invoice: toRun(stitched, elements), stitched, elements, truth };
}

function toRun(stitched: StitchedInvoice, elements: RunInvoice["elements"]): RunInvoice {
  return {
    invoice_number: stitched.invoice_number?.text ?? "",
    currency: stitched.currency?.text ?? "",
    elements,
    unresolved: stitched.unresolved,
    lines: stitched.charge_lines.map((entry) => ({
      id: entry.id,
      container: entry.container.text,
      charge: entry.charge?.text ?? "",
      charged_from: entry.charged_from?.text ?? "",
      charged_to: entry.charged_to?.text ?? "",
      days: entry.days?.text ?? "",
      rate: entry.rate?.text ?? "",
      amount: entry.amount.text,
      container_page: entry.container.page,
      from_page: entry.charged_from?.page ?? 0,
      to_page: entry.charged_to?.page ?? 0,
      days_page: entry.days?.page ?? 0,
      rate_page: entry.rate?.page ?? 0,
      amount_page: entry.amount.page,
    })),
  };
}

function pagesFromTruth(truth: FixtureTruth): PageExtraction[] {
  const buckets = new Map<number, { elements: PageExtraction["elements"]; charge_lines: PrintedChargeLine[] }>();
  for (let number = 1; number <= truth.pages; number += 1) buckets.set(number, { elements: {}, charge_lines: [] });
  for (const key of ELEMENT_KEYS) {
    const element = truth.elements[key];
    if (element.state !== "present" || element.page === null || element.text === undefined || element.text === "") continue;
    const bucket = buckets.get(element.page);
    if (bucket !== undefined) bucket.elements[key] = { text: element.text, page: element.page };
  }
  for (const entry of truth.charge_lines) {
    if (entry.placement.kind === "row") {
      buckets.get(entry.placement.page)?.charge_lines.push({
        page: entry.placement.page,
        container: entry.container,
        charge: entry.charge,
        charged_from: entry.charged_from,
        charged_to: entry.charged_to,
        days: entry.days,
        rate: entry.rate,
        amount: entry.amount,
      });
      continue;
    }
    buckets.get(entry.placement.head_page)?.charge_lines.push({
      page: entry.placement.head_page,
      container: entry.container,
      charge: entry.charge,
      charged_from: entry.charged_from,
      charged_to: entry.charged_to,
      days: entry.days,
      rate: entry.rate,
    });
    buckets.get(entry.placement.tail_page)?.charge_lines.push({ page: entry.placement.tail_page, amount: entry.amount });
  }
  return [...buckets.entries()].sort((left, right) => left[0] - right[0]).map(([number, bucket]) => {
    const value: Record<string, unknown> = { page: number, elements: bucket.elements, charge_lines: bucket.charge_lines };
    if (number === 1) {
      value.invoice_number = truth.invoice_number;
      value.billing_party = truth.billing_party;
      value.billed_party = truth.billed_party;
      value.currency = truth.currency;
    }
    return pageExtractionSchema.parse(value);
  });
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as {
    getDocument: (input: { data: Uint8Array; verbosity?: number }) => { promise: Promise<{ numPages: number; getPage: (page: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }> }> };
  };
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  let text = "";
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (typeof item === "object" && item !== null && "str" in item && typeof item.str === "string") text += `${item.str} `;
    }
  }
  return text;
}

function plain(amount: string | null): string {
  return amount?.replaceAll(",", "") ?? "";
}
