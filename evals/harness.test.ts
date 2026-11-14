import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ELEMENT_KEYS, fixtureTruthSchema, pageExtractionSchema, type ElementKey, type FixtureTruth, type PageExtraction } from "dd-core";
import { describe, expect, it } from "vitest";
import { failed, formatReport, run, scoreDirectory, type ScoreOptions, type ScoreReport } from "./harness.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const harbor = path.join(repo, "fixtures/config/harbor_home.yaml");

const TEXTS: Record<ElementKey, string> = {
  bl_number: "SYN-BL-1",
  container_number: "SLLU0000048",
  port_of_discharge: "Port Sample",
  billed_party_basis: "Harbor Home Goods is the consignee named on the bill of lading.",
  invoice_date: "2026-03-10",
  invoice_due_date: "2026-04-09",
  free_time_days: "5 days",
  free_time_start: "2026-03-01",
  free_time_end: "2026-03-05",
  container_availability_date: "2026-03-01",
  earliest_return_date: "2026-03-02",
  charged_dates: "2026-03-04 through 2026-03-04",
  total_due: "100.00 USD",
  applicable_rule: "Sample Line Logistics demurrage schedule SL-1",
  rates: "100.00 USD per day",
  dispute_contact: "disputes@sample-line.example",
  dispute_info_link: "https://example.com/sample-line/mitigation",
  dispute_timeframes: "Request a waiver within 30 days.",
  cert_rules_compliance: "The charges are consistent with the demurrage and detention rules.",
  cert_no_contribution: "The billing party's performance did not cause or contribute to these charges.",
};

const LINE = {
  container: "SLLU0000048",
  charge: "demurrage",
  charged_from: "2026-03-04",
  charged_to: "2026-03-04",
  days: "1",
  rate: "100.00",
  amount: "100.00",
  placement: { kind: "row" as const, page: 1 },
};

describe("eval harness", () => {
  it("fails a false absence and counts the date miss", () => {
    const scored = writeAndScore((texts) => ({
      page: buildPage(texts, { omit: ["invoice_date"] }),
      truth: buildTruth(texts),
    }));
    expect(scored.report.falseAbsences).toBe(1);
    expect(scored.report.notes).toContain("sample invoice_date false_absence");
    expect(scored.report.notes).toContain("sample invoice_date date_miss");
    expect(scored.report.datesHit).toBe(scored.report.datesTotal - 1);
    expect(scored.code).toBe(1);
  });

  it("prints a missed absence without failing", () => {
    const scored = writeAndScore((texts) => ({
      page: buildPage(texts),
      truth: buildTruth(texts, {
        elements: { cert_no_contribution: { state: "suggested_absent", page: null } },
      }),
    }));
    expect(scored.report.missedAbsences).toBe(1);
    expect(scored.report.falseAbsences).toBe(0);
    expect(scored.report.notes).toContain("sample cert_no_contribution missed_absence");
    expect(scored.code).toBe(0);
  });

  it("counts a gold confirmed_absent label as a missed absence", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-eval-"));
    const truth = buildTruth(TEXTS) as unknown as { elements: Record<string, unknown> };
    truth.elements["cert_no_contribution"] = { state: "confirmed_absent", page: null };
    writeCase(dir, "sample", { page: buildPage(TEXTS), truth, pdf: Buffer.from("pdf") });
    const scored = score(dir);
    expect(scored.report.missedAbsences).toBe(1);
    expect(scored.code).toBe(0);
  });

  it("counts a garbage date as unreadable and as a date miss", () => {
    const texts = { ...TEXTS, invoice_date: "not-a-date" };
    const scored = writeAndScore(() => ({
      page: buildPage(texts),
      truth: buildTruth({ ...TEXTS }),
    }));
    expect(scored.report.unreadable).toBe(1);
    expect(scored.report.falseAbsences).toBe(0);
    expect(scored.report.notes).toContain("sample invoice_date unreadable");
    expect(scored.report.notes).toContain("sample invoice_date date_miss");
    expect(scored.report.datesHit).toBe(6);
    expect(scored.report.datesTotal).toBe(7);
    expect(scored.code).toBe(0);
  });

  it("keeps earliest_return_date out of both absence counts on an import", () => {
    const scored = writeAndScore((texts) => ({
      page: buildPage(texts, { includeEarliest: true }),
      truth: buildTruth(texts),
    }));
    expect(scored.report.falseAbsences).toBe(0);
    expect(scored.report.missedAbsences).toBe(0);
    expect(scored.report.notes.some((line) => line.includes("earliest_return_date"))).toBe(false);
    expect(scored.code).toBe(0);
  });

  it("fails when a not_applicable element does not match", () => {
    const scored = writeAndScore((texts) => ({
      page: buildPage(texts),
      truth: buildTruth(texts, {
        elements: { port_of_discharge: { state: "not_applicable", page: null } },
      }),
    }));
    expect(scored.report.notes).toContain("sample port_of_discharge not_applicable");
    expect(scored.code).toBe(1);
  });

  it("matches an expected R4 line and fails when that finding is missed", () => {
    const matched = writeAndScore((texts) => ({
      page: buildPage(texts, { lineAmount: "150.00", totalText: "150.00 USD" }),
      truth: buildTruth(
        { ...texts, total_due: "150.00 USD" },
        {
          total_due: "150.00",
          charge_lines: [{ ...LINE, amount: "150.00" }],
          expected_findings: [r4("line", "50.00")],
        },
      ),
    }));
    expect(matched.report.findings.day0).toEqual({ matched: 1, missed: 0, extra: 0 });
    expect(matched.report.findings.day1).toEqual({ matched: 1, missed: 0, extra: 0 });
    expect(matched.code).toBe(0);

    const missed = writeAndScore((texts) => ({
      page: buildPage(texts),
      truth: buildTruth(texts, { expected_findings: [r4("line", "50.00")] }),
    }));
    expect(missed.report.findings.day1.missed).toBe(1);
    expect(missed.report.notes).toContain("SYN-1 R4 line 50.00 missed");
    expect(missed.code).toBe(1);
  });

  it("fails an extra finding on the synthetic set and prints it for a gold directory", () => {
    const spec = (texts: Record<ElementKey, string>) => ({
      page: buildPage(texts, { lineAmount: "150.00", totalText: "200.00 USD" }),
      truth: buildTruth(
        { ...texts, total_due: "200.00 USD" },
        {
          total_due: "200.00",
          charge_lines: [{ ...LINE, amount: "150.00" }],
          expected_findings: [r4("line", "50.00")],
        },
      ),
    });
    const synthetic = writeAndScore(spec, true);
    expect(synthetic.report.findings.day0).toEqual({ matched: 1, missed: 0, extra: 1 });
    expect(synthetic.report.notes).toContain("SYN-1 R4 total 50.00 extra");
    expect(synthetic.code).toBe(1);

    const gold = writeAndScore(spec, false);
    expect(gold.report.findings.day1.extra).toBe(1);
    expect(gold.code).toBe(0);
    expect(gold.text).toContain("extra 1");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-gold-"));
    const built = spec(TEXTS);
    writeCase(dir, "sample", { page: built.page, truth: built.truth, pdf: Buffer.from("pdf") });
    const command = capture(["--dir", dir]);
    expect(command.code).toBe(0);
    expect(command.stdout).toContain("extra 1");
    expect(command.stdout.startsWith(`${path.basename(dir)}\n`)).toBe(true);
  });

  it("scores day 0 and day 1 as different amounts", () => {
    const texts: Record<ElementKey, string> = {
      ...TEXTS,
      invoice_date: "2026-02-25",
      invoice_due_date: "2026-03-27",
      free_time_start: "2026-02-10",
      free_time_end: "2026-02-14",
      container_availability_date: "2026-02-10",
      charged_dates: "2026-02-13 through 2026-02-20",
      total_due: "1600.00 USD",
    };
    const lines = [
      { ...LINE, charged_from: "2026-02-13", charged_to: "2026-02-16", days: "4", rate: "150.00", amount: "600.00" },
      { ...LINE, charged_from: "2026-02-17", charged_to: "2026-02-20", days: "4", rate: "250.00", amount: "1000.00" },
    ];
    const scored = writeAndScore(() => ({
      page: buildPage(texts, { lines, invoice: "SYN-1004" }),
      truth: buildTruth(texts, {
        invoice_number: "SYN-1004",
        total_due: "1600.00",
        charge_lines: lines,
        convention_sensitive: true,
        by_convention: {
          day1: {
            chargeable_days: 6,
            expected_amount: "1100.00",
            finding: { rule: "R3", ground: "billing_error", disputable_amount: "500.00", currency: "USD" },
          },
          day0: {
            chargeable_days: 5,
            expected_amount: "850.00",
            finding: { rule: "R3", ground: "billing_error", disputable_amount: "750.00", currency: "USD" },
          },
        },
      }),
    }));
    expect(scored.report.findings.day1).toEqual({ matched: 1, missed: 0, extra: 0 });
    expect(scored.report.findings.day0).toEqual({ matched: 1, missed: 0, extra: 0 });
    expect(scored.code).toBe(0);
  });

  it("confirms a truth absence and matches the R1 finding", () => {
    const omitted = ["free_time_start", "free_time_end", "cert_rules_compliance", "cert_no_contribution"] as const;
    const texts = { ...TEXTS, total_due: "300.00 USD" };
    const scored = writeAndScore(() => ({
      page: buildPage(texts, { omit: [...omitted], lineAmount: "300.00", rate: "300.00" }),
      truth: buildTruth(texts, {
        total_due: "300.00",
        charge_lines: [{ ...LINE, rate: "300.00", amount: "300.00" }],
        elements: Object.fromEntries(omitted.map((key) => [key, { state: "suggested_absent", page: null }])),
        review_cases: {
          before_review: { rule: "R1", outcome: "not_evaluable" },
          after_review: {
            confirmed_absent: [...omitted],
            finding: {
              rule: "R1",
              ground: "missing_information",
              citations: ["46 CFR 541.6"],
              disputable_amount: "300.00",
              currency: "USD",
            },
          },
        },
      }),
    }));
    expect(scored.report.findings.day0).toEqual({ matched: 1, missed: 0, extra: 0 });
    expect(scored.report.findings.day1).toEqual({ matched: 1, missed: 0, extra: 0 });
    expect(scored.report.falseAbsences).toBe(0);
    expect(scored.code).toBe(0);
  });

  it("fails when the pdf hash in record.json does not match", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-eval-"));
    writeCase(dir, "sample", {
      page: buildPage(TEXTS),
      truth: buildTruth(TEXTS),
      pdf: Buffer.from("pdf-bytes"),
      recordHash: "a".repeat(64),
    });
    const scored = score(dir);
    expect(scored.report.notes).toContain("sample pdf hash does not match record.json");
    expect(scored.report.fatal).toContain("sample pdf hash does not match record.json");
    expect(scored.code).toBe(1);

    const clean = fs.mkdtempSync(path.join(os.tmpdir(), "dd-eval-"));
    writeCase(clean, "sample", { page: buildPage(TEXTS), truth: buildTruth(TEXTS), pdf: Buffer.from("pdf-bytes") });
    const ok = score(clean);
    expect(ok.report.notes.some((line) => line.includes("pdf"))).toBe(false);
    expect(ok.code).toBe(0);
  });

  it("fails a missing, failed, or unreadable stored page and names the fixture", () => {
    const missing = fs.mkdtempSync(path.join(os.tmpdir(), "dd-eval-"));
    writeCase(missing, "sample", { page: buildPage(TEXTS), truth: buildTruth(TEXTS), pdf: Buffer.from("pdf"), skipExtraction: true });
    expect(score(missing).report.notes).toContain("sample page 001 is missing");

    const failedPage = fs.mkdtempSync(path.join(os.tmpdir(), "dd-eval-"));
    writeCase(failedPage, "sample", { page: buildPage(TEXTS), truth: buildTruth(TEXTS), pdf: Buffer.from("pdf"), status: "failed" });
    expect(score(failedPage).report.notes).toContain("sample page 001 failed");

    const broken = fs.mkdtempSync(path.join(os.tmpdir(), "dd-eval-"));
    writeCase(broken, "sample", { page: buildPage(TEXTS), truth: buildTruth(TEXTS), pdf: Buffer.from("pdf") });
    fs.writeFileSync(path.join(broken, "sample", "pages", "001", "extraction.json"), "{");
    expect(score(broken).report.notes).toContain("sample page 001 did not parse");
    expect(score(broken).code).toBe(1);
  });

  it("uses the same scorer for a directory and names a missing one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-gold-"));
    const result = capture(["--dir", dir]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`${dir} has no cases.`);

    const missing = path.join(dir, "missing");
    const absent = capture(["--dir", missing]);
    expect(absent.code).toBe(1);
    expect(absent.stderr).toContain(`directory ${missing} is missing.`);
  });

  it("prints a stable synthetic report and does not call fetch", () => {
    const previous = globalThis.fetch;
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      throw new Error("network");
    }) as typeof fetch;
    try {
      const first = capture([]);
      const second = capture([]);
      expect(called).toBe(false);
      expect(second).toEqual(first);
      expect(first.stdout.startsWith("synthetic\n")).toBe(true);
      expect(first.stdout).toContain("false_absences ");
      expect(first.stdout).toContain("findings day0 matched ");
      expect(first.stdout).toContain("findings day1 matched ");
    } finally {
      globalThis.fetch = previous;
    }
  });

  it("runs the harness command while fetch throws", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-eval-"));
    writeCase(dir, "sample", { page: buildPage(TEXTS), truth: buildTruth(TEXTS), pdf: Buffer.from("pdf"), party: "sample_line" });
    const deny = path.join(dir, "deny-fetch.mjs");
    fs.writeFileSync(deny, "globalThis.fetch = () => { throw new Error(\"network\") }\n");
    const result = spawnSync(process.execPath, ["--import", "tsx", "--import", deny, path.join(repo, "evals/harness.ts"), "--dir", dir], {
      cwd: repo,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("false_absences 0");
    expect(result.stderr).not.toContain("network");
  });

  it("imports dd-core only from the harness", () => {
    const harness = fs.readFileSync(path.join(repo, "evals/harness.ts"), "utf8");
    const capture = fs.readFileSync(path.join(repo, "evals/capture.ts"), "utf8");
    expect(harness.includes("dd-extract")).toBe(false);
    expect(capture.includes("dd-extract")).toBe(true);
  });

  it("refuses capture in CI and when the key is missing", () => {
    const ci = spawnSync(process.execPath, ["--import", "tsx", path.join(repo, "evals/capture.ts")], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, CI: "true", ANTHROPIC_API_KEY: "not-used" },
    });
    expect(ci.status).toBe(1);
    expect(ci.stderr).toContain("evals:capture does not run in CI.");

    const env = { ...process.env };
    delete env.CI;
    delete env.ANTHROPIC_API_KEY;
    const missing = spawnSync(process.execPath, ["--import", "tsx", path.join(repo, "evals/capture.ts")], {
      cwd: repo,
      encoding: "utf8",
      env,
    });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("ANTHROPIC_API_KEY is not set.");
  });
});

function capture(argv: readonly string[]): { code: number; stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  const code = run(argv, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { code, stdout, stderr };
}

function writeAndScore(
  build: (texts: Record<ElementKey, string>) => { page: PageExtraction; truth: FixtureTruth | Record<string, unknown> },
  failOnExtra = true,
): { report: ScoreReport; text: string; code: number } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-eval-"));
  const built = build(TEXTS);
  writeCase(dir, "sample", { ...built, pdf: Buffer.from("pdf") });
  return score(dir, failOnExtra);
}

function score(dir: string, failOnExtra = true): { report: ScoreReport; text: string; code: number } {
  const report = scoreDirectory(dir, options(dir, failOnExtra));
  return { report, text: formatReport(path.basename(dir), report), code: failed(report, failOnExtra) ? 1 : 0 };
}

function options(dir: string, failOnExtra: boolean): ScoreOptions {
  return {
    truthPath: (id) => path.join(dir, id, "truth.json"),
    pdfPath: (id) => path.join(dir, id, "source.pdf"),
    partyId: (id) => {
      const file = path.join(dir, id, "party.txt");
      return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "sample_line";
    },
    configPath: harbor,
    failOnExtra,
  };
}

function writeCase(
  dir: string,
  id: string,
  spec: {
    page: PageExtraction;
    truth: unknown;
    pdf: Buffer;
    recordHash?: string;
    status?: "ok" | "failed";
    skipExtraction?: boolean;
    party?: string;
  },
): void {
  const caseDir = path.join(dir, id);
  const hash = sha256(spec.pdf);
  fs.mkdirSync(path.join(caseDir, "pages", "001"), { recursive: true });
  fs.writeFileSync(path.join(caseDir, "source.pdf"), spec.pdf);
  fs.writeFileSync(path.join(caseDir, "truth.json"), `${JSON.stringify(spec.truth, null, 2)}\n`);
  fs.writeFileSync(path.join(caseDir, "party.txt"), `${spec.party ?? "sample_line"}\n`);
  if (spec.skipExtraction !== true) {
    fs.writeFileSync(path.join(caseDir, "pages", "001", "extraction.json"), `${JSON.stringify(spec.page, null, 2)}\n`);
  }
  fs.writeFileSync(
    path.join(caseDir, "pages", "001", "record.json"),
    `${JSON.stringify({ page: 1, status: spec.status ?? "ok", document_sha256: spec.recordHash ?? hash }, null, 2)}\n`,
  );
}

function buildTruth(
  texts: Record<ElementKey, string>,
  overrides: {
    invoice_number?: string;
    total_due?: string;
    charge_lines?: FixtureTruth["charge_lines"];
    expected_findings?: FixtureTruth["expected_findings"];
    elements?: Partial<Record<ElementKey, FixtureTruth["elements"][ElementKey]>>;
    convention_sensitive?: true;
    by_convention?: FixtureTruth["by_convention"];
    review_cases?: FixtureTruth["review_cases"];
  } = {},
): FixtureTruth {
  const elements = {} as FixtureTruth["elements"];
  for (const key of ELEMENT_KEYS) {
    elements[key] =
      key === "earliest_return_date"
        ? { state: "not_applicable", page: null }
        : { state: "present", text: texts[key], page: 1 };
  }
  for (const [key, value] of Object.entries(overrides.elements ?? {})) {
    elements[key as ElementKey] = value as FixtureTruth["elements"][ElementKey];
  }
  const body: Record<string, unknown> = {
    id: "sample",
    invoice_number: overrides.invoice_number ?? "SYN-1",
    pages: 1,
    movement: "import",
    currency: "USD",
    billing_party: "Sample Line Logistics",
    billed_party: "Harbor Home Goods",
    reissue_of: null,
    elements,
    charge_lines: overrides.charge_lines ?? [LINE],
    total_due: overrides.total_due ?? "100.00",
    expected_findings: overrides.expected_findings ?? [],
  };
  if (overrides.convention_sensitive === true) body["convention_sensitive"] = true;
  if (overrides.by_convention !== undefined) body["by_convention"] = overrides.by_convention;
  if (overrides.review_cases !== undefined) body["review_cases"] = overrides.review_cases;
  return fixtureTruthSchema.parse(body);
}

function buildPage(
  texts: Record<ElementKey, string>,
  tweaks: {
    omit?: readonly ElementKey[];
    includeEarliest?: boolean;
    lineAmount?: string;
    rate?: string;
    totalText?: string;
    invoice?: string;
    lines?: FixtureTruth["charge_lines"];
  } = {},
): PageExtraction {
  const elements: PageExtraction["elements"] = {};
  for (const key of ELEMENT_KEYS) {
    if (key === "earliest_return_date" && tweaks.includeEarliest !== true) continue;
    if (tweaks.omit?.includes(key) === true) continue;
    const text = key === "total_due" && tweaks.totalText !== undefined ? tweaks.totalText : texts[key];
    elements[key] = { text, page: 1 };
  }
  const lines = tweaks.lines ?? [
    {
      ...LINE,
      rate: tweaks.rate ?? LINE.rate,
      amount: tweaks.lineAmount ?? LINE.amount,
    },
  ];
  return pageExtractionSchema.parse({
    page: 1,
    invoice_number: tweaks.invoice ?? "SYN-1",
    billing_party: "Sample Line Logistics",
    billed_party: "Harbor Home Goods",
    currency: "USD",
    elements,
    charge_lines: lines.map((line) => ({
      page: 1,
      container: line.container,
      charge: line.charge,
      charged_from: line.charged_from,
      charged_to: line.charged_to,
      days: line.days,
      rate: line.rate,
      amount: line.amount,
    })),
  });
}

function r4(part: "line" | "total", amount: string): FixtureTruth["expected_findings"][number] {
  return { rule: "R4", ground: "billing_error", part, disputable_amount: amount, currency: "USD" };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
