import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCustomerConfig, type CustomerConfig } from "../config.js";
import { ELEMENT_KEYS, type ElementKey } from "../elements.js";
import { findingsCsv, reportJson } from "../findings.js";
import { assignPresence } from "../presence.js";
import { startReview, type ReviewedElement } from "../review.js";
import {
  fixtureTruthSchema,
  pageExtractionSchema,
  type ElementRecord,
  type Finding,
  type FixtureTruth,
  type PageExtraction,
  type PrintedChargeLine,
  type StitchedInvoice,
} from "../schema.js";
import { stitch } from "../stitch.js";
import { runRules, type ReportFinding, type RunInvoice, type RunLine, type RunReport } from "./runRules.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixtureDir = path.join(repoRoot, "fixtures/synthetic");
const harborPath = path.join(repoRoot, "fixtures/config/harbor_home.yaml");
const fixtureIds = [
  "clean",
  "missing_elements",
  "late_37",
  "free_time_overbill",
  "arithmetic",
  "duplicate_a",
  "duplicate_b",
  "split_row",
] as const;
const removed = ["free_time_start", "free_time_end", "cert_rules_compliance", "cert_no_contribution"] as const;

describe("runRules", () => {
  it("matches all eight fixtures under both conventions", () => {
    const loaded = fixtureIds.map((id) => load(id));
    const invoices = loaded.map((entry) => entry.invoice);
    const parties = partyMap(invoices, "sample_line");
    const day1 = runRules(invoices, harbor(), "day1", parties, []);
    const day0 = runRules(invoices, harbor(), "day0", parties, []);

    expect(amounts(day1, "SYN-1004")).toEqual([{ rule: "R3", ground: "billing_error", disputable_amount: "500.00", currency: "USD" }]);
    expect(amounts(day0, "SYN-1004")).toEqual([{ rule: "R3", ground: "billing_error", disputable_amount: "750.00", currency: "USD" }]);
    expect(outcome(day1, "SYN-1004", "R3")?.convention_sensitive).toBe(true);
    expect(outcome(day0, "SYN-1004", "R3")?.convention_sensitive).toBe(true);

    for (const report of [day1, day0]) {
      expect(report.findings.filter((finding) => finding.invoice_id === "SYN-1003")).toEqual([
        expect.objectContaining({
          rule: "R2",
          ground: "late_invoice",
          citations: ["46 CFR 541.7(a)"],
          disputable_amount: "1100.00",
          currency: "USD",
          do_not_pursue: false,
        }),
      ]);
      expect(outcome(report, "SYN-1003", "R2")?.convention_sensitive).toBe(false);
      expect(partOf(report, "SYN-1005")).toEqual([
        { rule: "R4", ground: "billing_error", part: "line", disputable_amount: "250.00", currency: "USD" },
        { rule: "R4", ground: "billing_error", part: "total", disputable_amount: "250.00", currency: "USD" },
      ]);
      expect(overlapOf(report, "SYN-1007")).toEqual([
        { rule: "R5", ground: "duplicate_charge", overlapping_days: 3, disputable_amount: "600.00", currency: "USD" },
      ]);
      expect(amounts(report, "SYN-1006")).toEqual([]);
      expect(amounts(report, "SYN-1001")).toEqual([]);
      expect(amounts(report, "SYN-1008")).toEqual([]);
      expect(amounts(report, "SYN-1002")).toEqual([]);
      for (const rule of ["R1", "R2", "R3", "R4", "R5"] as const) {
        expect(report.not_evaluable).toContainEqual({ invoice_id: "SYN-1002", rule });
      }
    }

    expect(day1.total_disputable).toEqual([{ currency: "USD", amount: "2700.00" }]);
    expect(day0.total_disputable).toEqual([{ currency: "USD", amount: "2950.00" }]);
    expect(findingsCsv(day1)).toBe(findingsCsv(runRules([...invoices].reverse(), harbor(), "day1", parties, [])));
    expect(reportJson(day1)).toBe(reportJson(runRules(invoices, harbor(), "day1", parties, [])));
    expect(findingsCsv(day1).endsWith("\n")).toBe(true);
    expect(findingsCsv(day1).includes("\r")).toBe(false);

    const parsed = JSON.parse(reportJson(day1)) as { invoices: { invoice_id: string; elements: Record<string, unknown> }[] };
    expect(Object.keys(parsed)).toEqual(["convention", "total_disputable", "findings", "not_evaluable", "needs_info", "invoices"]);
    const clean = parsed.invoices.find((invoice) => invoice.invoice_id === "SYN-1001");
    expect(clean).toBeDefined();
    expect(Object.keys(clean?.elements ?? {})).toEqual([...ELEMENT_KEYS]);
  });

  it("finds the confirmed absences after review", () => {
    const { invoice, stitched, elements, truth } = load("missing_elements");
    const session = startReview({
      documentHash: "hash-missing",
      invoice: stitched,
      elements,
      pages: truth.pages,
      name: "Reviewer",
      at: "2026-11-09T21:13:00Z",
    });
    for (let page = 1; page <= truth.pages; page += 1) session.acknowledge(page);
    for (const key of removed) session.confirmAbsent(key);
    session.approveLines();
    const reviewed = toRun(stitched, session.finish().elements);
    const expected = truth.review_cases?.after_review.finding;
    if (expected === undefined) throw new Error("missing_elements records the review");

    for (const convention of ["day0", "day1"] as const) {
      const report = runRules([reviewed], harbor(), convention, { [reviewed.invoice_number]: "sample_line" }, []);
      expect(report.findings).toEqual([
        expect.objectContaining({
          rule: "R1",
          ground: "missing_information",
          citations: expected.citations,
          disputable_amount: expected.disputable_amount,
          currency: expected.currency,
        }),
      ]);
      expect(amounts(runRules([invoice], harbor(), convention, { [invoice.invoice_number]: "sample_line" }, []), "SYN-1002")).toEqual([]);
    }
  });

  it("counts an overlapping line once", () => {
    const later = overbillLine("SYN-9001", "2026-02-25", "2000.00");
    const earlier = earlierOverlap();
    const parties = partyMap([earlier, later], "sample_line");
    const report = runRules([later, earlier], harbor(), "day1", parties, []);
    expect(amounts(report, "SYN-9001")).toEqual([
      { rule: "R3", ground: "billing_error", disputable_amount: "900.00", currency: "USD" },
      { rule: "R4", ground: "billing_error", disputable_amount: "400.00", currency: "USD" },
      { rule: "R5", ground: "duplicate_charge", disputable_amount: "600.00", currency: "USD" },
    ]);
    expect(report.total_disputable).toEqual([{ currency: "USD", amount: "1000.00" }]);

    const alone = runRules([later], harbor(), "day1", partyMap([later], "sample_line"), []);
    expect(amounts(alone, "SYN-9001").map((finding) => finding.disputable_amount)).toEqual(["900.00", "400.00"]);
    expect(alone.total_disputable).toEqual([{ currency: "USD", amount: "900.00" }]);

    const gap = overbillLine("SYN-9001", "2026-02-25", "2100.00");
    const withGap = runRules([gap, earlier], harbor(), "day1", partyMap([gap, earlier], "sample_line"), []);
    expect(amounts(withGap, "SYN-9001").map((finding) => finding.disputable_amount)).toEqual(["900.00", "100.00", "400.00", "600.00"]);
    expect(withGap.total_disputable).toEqual([{ currency: "USD", amount: "1100.00" }]);

    const late = overbillLine("SYN-9001", "2026-04-01", "2100.00");
    const withLate = runRules([late, earlier], harbor(), "day1", partyMap([late, earlier], "sample_line"), []);
    expect(amounts(withLate, "SYN-9001").map((finding) => finding.rule)).toEqual(["R2", "R3", "R4", "R4", "R5"]);
    expect(withLate.findings.find((finding) => finding.rule === "R2")?.disputable_amount).toBe("2100.00");
    expect(withLate.total_disputable).toEqual([{ currency: "USD", amount: "2100.00" }]);
  });

  it("does not net an underbilled line against an overbilled line", () => {
    const invoice = load("arithmetic").invoice;
    const first = invoice.lines[0];
    const second = invoice.lines[1];
    if (first === undefined || second === undefined) throw new Error("arithmetic has two lines");
    const under = withLines(withElement(invoice, "total_due", "3150.00", "3150.00"), [first, { ...second, amount: "1400.00" }]);
    const report = runRules([under], harbor(), "day1", partyMap([under], "sample_line"), []);
    expect(report.findings.map((finding) => finding.disputable_amount)).toEqual(["250.00"]);
    expect(report.total_disputable).toEqual([{ currency: "USD", amount: "250.00" }]);
  });

  it("reports R2 on a reissue only when both dates are late", () => {
    const original = load("late_37").invoice;
    const onTime = withNumber(withElement(original, "invoice_date", "2026-03-10", "2026-03-10"), "SYN-2003");
    const bothLate = withNumber(withElement(withElement(original, "invoice_date", "2026-05-15", "2026-05-15"), "total_due", "800.00", "800.00"), "SYN-2003");
    const ownClock = withNumber(
      withElement(withChargedTo(original, "2026-04-01"), "invoice_date", "2026-04-20", "2026-04-20"),
      "SYN-2003",
    );
    const link = { invoice_number: "SYN-2003", reissue_of: original.invoice_number };

    const quiet = runRules([original, onTime], harbor(), "day1", partyMap([original, onTime], "sample_line"), [link]);
    expect(quiet.findings.filter((finding) => finding.rule === "R2")).toEqual([]);

    const lateOriginal = withElement(original, "invoice_date", "2026-03-10", "2026-03-10");
    const lateReissue = withNumber(withElement(original, "invoice_date", "2026-05-01", "2026-05-01"), "SYN-2004");
    const oneSide = runRules(
      [lateOriginal, lateReissue],
      harbor(),
      "day1",
      partyMap([lateOriginal, lateReissue], "sample_line"),
      [{ invoice_number: "SYN-2004", reissue_of: lateOriginal.invoice_number }],
    );
    expect(oneSide.findings.filter((finding) => finding.rule === "R2")).toEqual([]);

    const reported = runRules([original, bothLate], harbor(), "day0", partyMap([original, bothLate], "sample_line"), [link]);
    expect(reported.findings.filter((finding) => finding.rule === "R2")).toEqual([
      expect.objectContaining({ invoice_id: "SYN-2003", disputable_amount: "800.00", currency: "USD" }),
    ]);

    const separate = runRules([original, ownClock], harbor(), "day1", partyMap([original, ownClock], "sample_line"), [link]);
    expect(separate.findings.filter((finding) => finding.rule === "R2")).toEqual([]);
  });

  it("keeps a finding when another R5 pair cannot be judged", () => {
    const earlier = load("duplicate_a").invoice;
    const later = load("duplicate_b").invoice;
    const twin = withNumber(later, "SYN-1099");
    const report = runRules([twin, earlier, later], harbor(), "day1", partyMap([earlier, later, twin], "sample_line"), []);
    expect(overlapOf(report, "SYN-1007")).toEqual([
      { rule: "R5", ground: "duplicate_charge", overlapping_days: 3, disputable_amount: "600.00", currency: "USD" },
    ]);
    expect(report.not_evaluable).toContainEqual({ invoice_id: "SYN-1007", rule: "R5" });
    expect(outcome(report, "SYN-1007", "R5")).toEqual({ rule: "R5", outcome: "finding", not_evaluable: true });
  });

  it("uses the resolved party id and never the printed name", () => {
    const earlier = load("duplicate_a").invoice;
    const later = load("duplicate_b").invoice;
    const split = runRules([earlier, later], harbor(), "day1", { "SYN-1006": "sample_line", "SYN-1007": "cobalt_line" }, []);
    expect(split.findings.filter((finding) => finding.rule === "R5")).toEqual([]);

    const named = load("free_time_overbill").invoice;
    const report = runRules([named], harbor(), "day1", { "SYN-1004": "Sample Line Logistics" }, []);
    expect(report.findings.filter((finding) => finding.rule === "R3")).toEqual([]);
    expect(outcome(report, "SYN-1004", "R3")?.outcome).toBe("not_evaluable");

    const missing = runRules([earlier, later], harbor(), "day1", { "SYN-1006": "sample_line" }, []);
    expect(missing.findings.filter((finding) => finding.rule === "R5")).toEqual([]);
    expect(outcome(missing, "SYN-1007", "R5")?.outcome).toBe("not_evaluable");
    expect(outcome(missing, "SYN-1006", "R5")?.outcome).toBe("none");
  });

  it("lists an NVOCC invoice as needs_info and leaves it out of the total", () => {
    const invoice = load("late_37").invoice;
    const config = { ...harbor(), billed_party_role: "nvocc_passthrough" as const };
    const report = runRules([invoice], config, "day1", partyMap([invoice], "sample_line"), []);
    expect(report.findings.filter((finding) => finding.rule === "R2")).toEqual([]);
    expect(report.needs_info).toEqual([{ invoice_id: "SYN-1003", rule: "R2" }]);
    expect(report.total_disputable).toEqual([{ currency: "USD", amount: "0.00" }]);
  });

  it("marks do-not-pursue findings and leaves them out of the total", () => {
    const late = load("late_37").invoice;
    const arith = load("arithmetic").invoice;
    const report = runRules(
      [late, arith],
      harbor(),
      "day1",
      { "SYN-1003": "northbay_line", "SYN-1005": "sample_line" },
      [],
    );
    const refused = report.findings.filter((finding) => finding.invoice_id === "SYN-1003");
    expect(refused.map((finding) => finding.disputable_amount)).toEqual(["1100.00"]);
    expect(refused.every((finding) => finding.do_not_pursue)).toBe(true);
    expect(report.findings.filter((finding) => finding.invoice_id === "SYN-1005").every((finding) => finding.do_not_pursue)).toBe(false);
    expect(report.total_disputable).toEqual([{ currency: "USD", amount: "500.00" }]);
    expect(findingsCsv(report)).toContain("1100.00,USD,true,");
    expect(findingsCsv(report)).toContain("250.00,USD,false,");
  });
});

describe("findings report", () => {
  it("sorts disputable amounts as decimals", () => {
    const report = bare([
      fake("1000.00", "largest"),
      fake("20.00", "middle"),
      fake("3.00", "smallest"),
    ]);
    const rows = findingsCsv(report).trim().split("\n").slice(1);
    expect(rows.map((row) => row.split(",")[5])).toEqual(["3.00", "20.00", "1000.00"]);
    const parsed = JSON.parse(reportJson(report)) as { findings: { disputable_amount: string }[] };
    expect(parsed.findings.map((finding) => finding.disputable_amount)).toEqual(["3.00", "20.00", "1000.00"]);
  });

  it("prefixes formula characters in untrusted cells", () => {
    const prefixes = ["=SUM(A1)", "+1", "-1", "@cmd", "\tnote", "\rnote", "=a,b"];
    const report = bare(prefixes.map((explain, index) => fake("10.00", explain, { invoice_id: `SYN-${index}` })));
    const csv = findingsCsv(report);
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain("'+1");
    expect(csv).toContain("'-1");
    expect(csv).toContain("'@cmd");
    expect(csv).toContain("'\tnote");
    expect(csv).toContain("\"'\rnote\"");
    expect(csv).toContain("\"'=a,b\"");
    expect(csv).toContain(",10.00,");
    expect(csv.startsWith("invoice_id,rule,rule_version,ground,line_ids,disputable_amount,currency,do_not_pursue,convention,citations,expected,actual,explain,evidence\n")).toBe(true);
  });

  it("prefixes a citation taken from the invoice", () => {
    const invoice = withElement(load("arithmetic").invoice, "applicable_rule", "=SUM(A1)", "=SUM(A1)");
    const csv = findingsCsv(runRules([invoice], harbor(), "day1", partyMap([invoice], "sample_line"), []));
    expect(csv).toContain("'=SUM(A1)");
    expect(csv.includes(",=SUM(A1)")).toBe(false);
  });
});

function amounts(report: RunReport, invoiceId: string): { rule: string; ground: string; disputable_amount: string; currency: string }[] {
  return report.findings
    .filter((finding) => finding.invoice_id === invoiceId)
    .map((finding) => ({
      rule: finding.rule,
      ground: finding.ground,
      disputable_amount: finding.disputable_amount,
      currency: finding.currency,
    }));
}

function partOf(report: RunReport, invoiceId: string): { rule: string; ground: string; part: string; disputable_amount: string; currency: string }[] {
  return report.findings
    .filter((finding) => finding.invoice_id === invoiceId)
    .map((finding) => ({
      rule: finding.rule,
      ground: finding.ground,
      part: finding.evidence.some((item) => item.field === "total_due") ? "total" : "line",
      disputable_amount: finding.disputable_amount,
      currency: finding.currency,
    }));
}

function overlapOf(report: RunReport, invoiceId: string): { rule: string; ground: string; overlapping_days: number; disputable_amount: string; currency: string }[] {
  return report.findings
    .filter((finding) => finding.invoice_id === invoiceId)
    .map((finding) => ({
      rule: finding.rule,
      ground: finding.ground,
      overlapping_days: leadingDays(finding.actual),
      disputable_amount: finding.disputable_amount,
      currency: finding.currency,
    }));
}

function leadingDays(actual: string): number {
  const match = /^(\d+) day/.exec(actual);
  if (match?.[1] === undefined) throw new Error(`No day count in ${actual}`);
  return Number(match[1]);
}

function outcome(report: RunReport, invoiceId: string, rule: string): RunReport["invoices"][number]["outcomes"][number] | undefined {
  return report.invoices.find((invoice) => invoice.invoice_id === invoiceId)?.outcomes.find((item) => item.rule === rule);
}

function harbor(): CustomerConfig {
  return structuredClone(loadCustomerConfig(harborPath));
}

function partyMap(invoices: readonly RunInvoice[], partyId: string): Record<string, string> {
  return Object.fromEntries(invoices.map((invoice) => [invoice.invoice_number, partyId]));
}

function overbillLine(invoiceNumber: string, invoiceDate: string, total: string): RunInvoice {
  const base = withNumber(load("free_time_overbill").invoice, invoiceNumber);
  return withLines(withElement(withElement(base, "invoice_date", invoiceDate, invoiceDate), "total_due", total, total), [
    line({ amount: "2000.00" }),
  ]);
}

function earlierOverlap(): RunInvoice {
  const base = withNumber(withElement(load("free_time_overbill").invoice, "invoice_date", "2026-02-18", "2026-02-18"), "SYN-9000");
  return withLines(withElement(base, "total_due", "800.00", "800.00"), [
    line({ charged_to: "2026-02-15", days: "3", amount: "600.00" }),
    line({
      id: "ln_2",
      container: "SLLU0000099",
      charged_from: "2026-02-01",
      charged_to: "2026-02-02",
      days: "2",
      rate: "100.00",
      amount: "200.00",
    }),
  ]);
}

function line(overrides: Partial<RunLine>): RunLine {
  return {
    id: "ln_1",
    container: "SLLU0000048",
    charge: "demurrage",
    charged_from: "2026-02-13",
    charged_to: "2026-02-20",
    days: "8",
    rate: "200.00",
    amount: "2000.00",
    container_page: 1,
    from_page: 1,
    to_page: 1,
    days_page: 1,
    rate_page: 1,
    amount_page: 1,
    ...overrides,
  };
}

function withNumber(invoice: RunInvoice, invoiceNumber: string): RunInvoice {
  return { ...structuredClone(invoice), invoice_number: invoiceNumber };
}

function withElement(invoice: RunInvoice, key: ElementKey, text: string, value: string): RunInvoice {
  const current = invoice.elements[key];
  if (current.state !== "present") throw new Error(`${key} is present on this invoice`);
  return { ...invoice, elements: { ...invoice.elements, [key]: { ...current, text, value } } };
}

function withLines(invoice: RunInvoice, lines: readonly RunLine[]): RunInvoice {
  return { ...invoice, lines };
}

function withChargedTo(invoice: RunInvoice, chargedTo: string): RunInvoice {
  return { ...invoice, lines: invoice.lines.map((entry) => ({ ...entry, charged_to: chargedTo })) };
}

function bare(findings: ReportFinding[]): RunReport {
  return { convention: "day1", total_disputable: [], findings, not_evaluable: [], needs_info: [], invoices: [] };
}

function fake(amount: string, explain: string, extra?: Partial<Finding>): ReportFinding {
  return {
    rule: "R4",
    rule_version: 1,
    ground: "billing_error",
    citations: ["schedule"],
    invoice_id: "SYN-1",
    line_ids: ["ln_1"],
    expected: "ok",
    actual: "no",
    disputable_amount: amount,
    currency: "USD",
    do_not_pursue: false,
    evidence: [{ page: 1, field: "amount" }],
    explain,
    ...extra,
  };
}

function load(id: string): { invoice: RunInvoice; stitched: StitchedInvoice; elements: ElementRecord; truth: FixtureTruth } {
  const truth = readTruth(id);
  const stitched = stitch(pagesFromTruth(truth));
  const elements = assignPresence(stitched, "import");
  return { invoice: toRun(stitched, elements), stitched, elements, truth };
}

function toRun(stitched: StitchedInvoice, elements: Record<ElementKey, ReviewedElement>): RunInvoice {
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

function readTruth(id: string): FixtureTruth {
  return fixtureTruthSchema.parse(JSON.parse(fs.readFileSync(path.join(fixtureDir, `${id}.json`), "utf8"))) as FixtureTruth;
}

function pagesFromTruth(truth: FixtureTruth): PageExtraction[] {
  const buckets = new Map<number, { elements: PageExtraction["elements"]; charge_lines: PrintedChargeLine[] }>();
  for (let number = 1; number <= truth.pages; number += 1) buckets.set(number, { elements: {}, charge_lines: [] });
  for (const key of ELEMENT_KEYS) {
    const element = truth.elements[key];
    if (element.state !== "present" || element.page === null || element.text === undefined || element.text === "") continue;
    const bucket = buckets.get(element.page);
    if (bucket === undefined) continue;
    bucket.elements[key] = { text: element.text, page: element.page };
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
  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([number, bucket]) => {
      const value: Record<string, unknown> = { page: number, elements: bucket.elements, charge_lines: bucket.charge_lines };
      if (number === 1) {
        value["invoice_number"] = truth.invoice_number;
        value["billing_party"] = truth.billing_party;
        value["billed_party"] = truth.billed_party;
        value["currency"] = truth.currency;
      }
      return pageExtractionSchema.parse(value);
    });
}
