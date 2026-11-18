import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  assignPresence,
  fixtureTruthSchema,
  parseCustomerConfig,
  runRules,
  startReview,
  stitch,
  type CustomerConfig,
  type ElementKey,
  type FixtureTruth,
  type RunReport,
  type SavedDecision,
} from "dd-core";
import { describe, expect, it } from "vitest";
import { toRunInvoice } from "../../dd-cli/src/rules-command";
import { assembleRead } from "../../dd-worker/src/read";
import { pagesFromFixture, textOf } from "../../dd-worker/src/synthetic-pages";
import type { ReviewSql } from "./review-data";
import { buildRunInvoice } from "./rules-input";
import { formatChecksLine, formatDisputable, runCustomerChecks, type RulesFailure, type RulesSummary } from "./rules-run";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureIds = ["clean", "missing_elements", "late_37", "free_time_overbill", "arithmetic", "duplicate_a", "duplicate_b", "split_row"] as const;
const reviewedAt = "2026-11-10T16:00:00Z";
const customerId = "00000000-0000-4000-8000-0000000000aa";
const runId = "00000000-0000-4000-8000-0000000000bb";

type FixtureId = (typeof fixtureIds)[number];

describe("rules run", () => {
  it("matches dd-cli findings and totals for the eight synthetic fixtures", () => {
    const config = harbor();
    const reviewed = fixtureIds.map((id) => reviewFixture(id));
    reviewed.sort((left, right) => left.number.localeCompare(right.number));
    const parties = Object.fromEntries(reviewed.map((invoice) => [invoice.number, "sample_line"]));
    for (const convention of ["day0", "day1"] as const) {
      const cli = runRules(reviewed.map((invoice) => invoice.cli), config, convention, parties, []);
      const web = runRules(reviewed.map((invoice) => invoice.web), config, convention, parties, []);
      expect(slice(web), convention).toEqual(slice(cli));
    }
  });

  it("saves both conventions on one rules run and leaves a failed run when an input was not stored", async () => {
    const config = harbor();
    const clean = storedInvoice("clean", "00000000-0000-4000-8000-000000000001");
    const missing = storedInvoice("missing_elements", "00000000-0000-4000-8000-000000000002");
    const saved = recording(config, [clean, missing]);
    await runCustomerChecks(saved.sql, customerId);
    const success = saved.read();
    expect(success.findings).toHaveLength(2);
    expect(success.findings.map((row) => row.convention).sort()).toEqual(["day0", "day1"]);
    expect(success.findings.every((row) => row.rule === "R1" && row.amount === "300.00" && row.invoiceId === missing.id)).toBe(true);
    expect(success.summary.failed).toBe(false);
    if (success.summary.failed) return;
    expect(success.summary.settings_version).toBe(1);
    expect(success.summary.invoice_ids).toEqual([clean.id, missing.id]);
    expect(success.summary.total_disputable.day0).toEqual([{ currency: "USD", amount: "300.00" }]);
    expect(success.summary.total_disputable.day1).toEqual([{ currency: "USD", amount: "300.00" }]);

    const blank = storedInvoice("clean", clean.id);
    blank.unresolved = null;
    const failed = recording(config, [blank]);
    await runCustomerChecks(failed.sql, customerId);
    expect(failed.read()).toEqual({
      findings: [],
      summary: { failed: true, message: "Unresolved fragments were not saved. Requeue the invoice." },
    });

    const unpaged = storedInvoice("clean", clean.id);
    const line = unpaged.lines[0];
    if (line === undefined) throw new Error("missing line");
    line.containerPage = null;
    const missingPages = recording(config, [unpaged]);
    await runCustomerChecks(missingPages.sql, customerId);
    expect(missingPages.read()).toEqual({
      findings: [],
      summary: { failed: true, message: "Charge line pages were not saved. Requeue the invoice." },
    });
  });

  it("formats the two disputable totals", () => {
    expect(formatDisputable([])).toBe("none");
    expect(formatDisputable([{ currency: "USD", amount: "300.00" }])).toBe("300.00 USD");
    expect(
      formatChecksLine({
        status: "ok",
        ranAt: "2026-11-18T17:00:00.000Z",
        day0Findings: 1,
        day1Findings: 1,
        day0: "300.00 USD",
        day1: "300.00 USD",
      }),
    ).toBe("1 finding · day 1 300.00 USD");
    expect(
      formatChecksLine({
        status: "ok",
        ranAt: "2026-11-18T17:00:00.000Z",
        day0Findings: 2,
        day1Findings: 1,
        day0: "3,250.00 USD",
        day1: "3,000.00 USD",
      }),
    ).toBe("day 1 1 finding · 3,000.00 USD · day 0 2 findings · 3,250.00 USD");
  });
});

function slice(report: RunReport): Pick<RunReport, "findings" | "total_disputable" | "not_evaluable" | "needs_info"> {
  return {
    findings: report.findings,
    total_disputable: report.total_disputable,
    not_evaluable: report.not_evaluable,
    needs_info: report.needs_info,
  };
}

function reviewFixture(id: FixtureId): {
  number: string;
  cli: ReturnType<typeof toRunInvoice>;
  web: ReturnType<typeof buildRunInvoice>;
} {
  const truth = truthOf(id);
  const pages = pagesFromFixture(id);
  const read = assembleRead(pages, pages.map((page) => textOf(page)));
  const stitched = stitch([...pages]);
  const presence = assignPresence(stitched, "import");
  const hash = documentHash(id);
  const session = startReview({
    documentHash: hash,
    invoice: stitched,
    elements: presence,
    pages: truth.pages,
    name: "Reviewer",
    at: reviewedAt,
  });
  for (let page = 1; page <= truth.pages; page += 1) session.acknowledge(page);
  for (const key of confirmedKeys(truth)) {
    if (presence[key].state === "suggested_absent") session.confirmAbsent(key);
  }
  session.approveLines();
  const review = session.finish();
  return {
    number: truth.invoice_number,
    cli: toRunInvoice(review, "batch"),
    web: buildRunInvoice({
      invoiceNumber: read.invoiceNumber,
      billingParty: read.billingParty,
      billedParty: read.billedParty,
      currency: read.currency,
      pageCount: read.pageCount,
      documentHash: hash,
      elements: read.elements.map((element) => ({
        elementKey: element.key,
        state: element.state,
        text: element.text,
        value: element.value,
        page: element.page,
        grounded: element.grounded,
      })),
      lines: read.lines.map((line) => ({
        lineId: line.lineId,
        container: line.container,
        charge: line.charge,
        chargedFrom: line.chargedFrom,
        chargedTo: line.chargedTo,
        days: line.days,
        rate: line.rate,
        amount: line.amount,
        containerPage: line.containerPage,
        fromPage: line.fromPage,
        toPage: line.toPage,
        daysPage: line.daysPage,
        ratePage: line.ratePage,
        amountPage: line.amountPage,
      })),
      unresolved: read.unresolved,
      decisions: review.decisions,
    }),
  };
}

type StoredLine = {
  lineId: string;
  container: string;
  charge: string;
  chargedFrom: string;
  chargedTo: string;
  days: number;
  rate: string;
  amount: string;
  containerPage: number | null;
  fromPage: number | null;
  toPage: number | null;
  daysPage: number | null;
  ratePage: number | null;
  amountPage: number | null;
};

type Stored = {
  id: string;
  hash: string;
  number: string;
  billingParty: string;
  billedParty: string;
  currency: string;
  pageCount: number;
  unresolved: unknown;
  elements: ReturnType<typeof assembleRead>["elements"];
  lines: StoredLine[];
  decisions: SavedDecision[];
};

function storedInvoice(id: FixtureId, invoiceId: string): Stored {
  const truth = truthOf(id);
  const pages = pagesFromFixture(id);
  const read = assembleRead(pages, pages.map((page) => textOf(page)));
  return {
    id: invoiceId,
    hash: documentHash(id),
    number: truth.invoice_number,
    billingParty: read.billingParty,
    billedParty: read.billedParty,
    currency: read.currency,
    pageCount: read.pageCount,
    unresolved: read.unresolved,
    elements: read.elements,
    lines: read.lines.map((line) => ({ ...line })),
    decisions: approvedDecisions(id),
  };
}

function approvedDecisions(id: FixtureId): SavedDecision[] {
  const truth = truthOf(id);
  const pages = pagesFromFixture(id);
  const stitched = stitch([...pages]);
  const presence = assignPresence(stitched, "import");
  const session = startReview({
    documentHash: documentHash(id),
    invoice: stitched,
    elements: presence,
    pages: truth.pages,
    name: "Reviewer",
    at: reviewedAt,
  });
  for (let page = 1; page <= truth.pages; page += 1) session.acknowledge(page);
  for (const key of confirmedKeys(truth)) {
    if (presence[key].state === "suggested_absent") session.confirmAbsent(key);
  }
  session.approveLines();
  return session.finish().decisions.map((decision) =>
    decision.outcome === "approved" ? { ...decision, party_id: "sample_line", settings_version: 1 } : decision,
  );
}

type RecordedFinding = { convention: string; rule: string; amount: string; invoiceId: string };

function recording(config: CustomerConfig, invoices: readonly Stored[]): { sql: ReviewSql; read: () => { summary: RulesSummary | RulesFailure; findings: RecordedFinding[] } } {
  let summary: RulesSummary | RulesFailure | null = null;
  const findings: RecordedFinding[] = [];
  const sql: ReviewSql = {
    async query<T extends Record<string, unknown>>(text: string, values?: readonly unknown[]) {
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] as T[] };
      if (text.startsWith('INSERT INTO "ProcessingRun"')) {
        summary = JSON.parse(String(values?.[1])) as RulesSummary | RulesFailure;
        return { rows: [{ id: runId } as unknown as T] };
      }
      if (text.startsWith('INSERT INTO "Finding"')) {
        findings.push({
          invoiceId: String(values?.[1]),
          rule: String(values?.[3]),
          amount: String(values?.[10]),
          convention: String(values?.[14]),
        });
        return { rows: [] as T[] };
      }
      if (text.includes('FROM "CustomerConfigVersion"')) return { rows: [{ version: 1, config } as unknown as T] };
      if (text.includes('FROM "ElementValue"')) {
        return {
          rows: invoices.flatMap((invoice) =>
            invoice.elements.map((element) => ({
              invoice_id: invoice.id,
              element_key: element.key,
              state: element.state,
              text: element.text,
              value: element.value,
              page: element.page,
              grounded: element.grounded,
            })),
          ) as unknown as T[],
        };
      }
      if (text.includes('FROM "ChargeLine"')) {
        return {
          rows: invoices.flatMap((invoice) =>
            invoice.lines.map((line) => ({
              invoice_id: invoice.id,
              line_id: line.lineId,
              container: line.container,
              charge: line.charge,
              charged_from: line.chargedFrom,
              charged_to: line.chargedTo,
              days: line.days,
              rate: line.rate,
              amount: line.amount,
              container_page: line.containerPage,
              from_page: line.fromPage,
              to_page: line.toPage,
              days_page: line.daysPage,
              rate_page: line.ratePage,
              amount_page: line.amountPage,
            })),
          ) as unknown as T[],
        };
      }
      if (text.includes("review_decision")) {
        return { rows: invoices.flatMap((invoice) => invoice.decisions.map((decision) => ({ payload: decision }))) as unknown as T[] };
      }
      if (text.includes("billing_party_set")) return { rows: [] as T[] };
      if (text.includes('FROM "Invoice"')) {
        return {
          rows: invoices.map((invoice) => ({
            id: invoice.id,
            invoice_number: invoice.number,
            billing_party: invoice.billingParty,
            billed_party: invoice.billedParty,
            currency: invoice.currency,
            page_count: invoice.pageCount,
            unresolved: invoice.unresolved,
            sha256: invoice.hash,
          })) as unknown as T[],
        };
      }
      throw new Error(text);
    },
  };
  return {
    sql,
    read: () => {
      if (summary === null) throw new Error("no rules run was saved");
      return { summary, findings };
    },
  };
}

function confirmedKeys(truth: FixtureTruth): readonly ElementKey[] {
  return truth.review_cases?.after_review.confirmed_absent ?? [];
}

function truthOf(id: FixtureId): FixtureTruth {
  return fixtureTruthSchema.parse(JSON.parse(fs.readFileSync(path.join(repoRoot, "fixtures/synthetic", `${id}.json`), "utf8")));
}

function harbor(): CustomerConfig {
  return parseCustomerConfig(fs.readFileSync(path.join(repoRoot, "fixtures/config/harbor_home.yaml"), "utf8"), "harbor_home.yaml");
}

function documentHash(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}
