import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  ELEMENT_KEYS,
  assignPresence,
  fixtureTruthSchema,
  pageExtractionSchema,
  startReview,
  stitchedInvoiceSchema,
  type ElementKey,
  type FixtureTruth,
  type PageExtraction,
  type PrintedChargeLine,
} from "dd-core";
import { describe, expect, it } from "vitest";
import { runExtract } from "./extract-command.js";
import { runIngest } from "./ingest-command.js";
import type { CommandIo } from "./layout.js";
import { runReport } from "./report-command.js";
import { runReview } from "./review-command.js";
import { runRulesCommand, type RulesIo } from "./rules-command.js";
import type { PublishHooks } from "./publish.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const harborPath = path.join(repoRoot, "fixtures/config/harbor_home.yaml");
const fixtureDir = path.join(repoRoot, "fixtures/synthetic");
const fixtureIds = ["clean", "missing_elements", "late_37", "free_time_overbill", "arithmetic", "duplicate_a", "duplicate_b", "split_row"] as const;
const removed = ["free_time_start", "free_time_end", "cert_rules_compliance", "cert_no_contribution"] as const;
const now = "2026-11-10T16:00:00Z";

describe("dd commands", () => {
  it("rejects a run id that escapes the data directory and writes nothing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-path-"));
    const stderr: string[] = [];
    const code = await runIngest(command(dir, ["harbor_home", "--run", "../x", "--type", "invoice", path.join(fixtureDir, "clean.pdf")], stderr));
    expect(code).toBe(1);
    expect(stderr.join("")).toContain("run id must match ^[a-z0-9_-]+$");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("rejects a document hash that is not 64 hex characters and writes nothing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-hash-"));
    const stderr: string[] = [];
    const code = await runReview({
      ...command(dir, ["harbor_home", "--run", "batch", "--document", "../x", "--name", "Reviewer", "--now", now], stderr),
      stdin: Readable.from([]),
      opener: () => undefined,
    });
    expect(code).toBe(1);
    expect(stderr.join("")).toContain("document hash must match ^[0-9a-f]{64}$");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("reports a duplicate hash and keeps a single blob", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-dup-"));
    const env = customerEnv(dir);
    const pdf = path.join(fixtureDir, "clean.pdf");
    const first = await runIngest(command(dir, ["harbor_home", "--run", "batch", "--type", "invoice", pdf]));
    const stdout: string[] = [];
    const second = await runIngest({ ...command(dir, ["harbor_home", "--run", "batch", "--type", "invoice", pdf]), stdout: { write: (chunk) => { stdout.push(chunk); } } });
    expect(first).toBe(0);
    expect(second).toBe(0);
    expect(stdout.join("")).toMatch(/^duplicate [0-9a-f]{64}\n$/);
    const blobs = fs.readdirSync(path.join(env["DD_DATA_DIR"] ?? "", "harbor_home", "blobs"));
    expect(blobs).toHaveLength(1);
    const ingest = JSON.parse(fs.readFileSync(path.join(env["DD_DATA_DIR"] ?? "", "harbor_home", "runs", "batch", "ingest.json"), "utf8")) as { documents: unknown[] };
    expect(ingest.documents).toHaveLength(1);
  });

  it("reads the document type from the folder name", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-folder-"));
    const env = customerEnv(dir);
    const folder = path.join(dir, "invoice");
    fs.mkdirSync(folder);
    fs.copyFileSync(path.join(fixtureDir, "clean.pdf"), path.join(folder, "clean.pdf"));
    const code = await runIngest(command(dir, ["harbor_home", "--run", "batch", folder]));
    expect(code).toBe(0);
    const ingest = JSON.parse(fs.readFileSync(path.join(env["DD_DATA_DIR"] ?? dir, "harbor_home", "runs", "batch", "ingest.json"), "utf8")) as { documents: { type: string }[] };
    expect(ingest.documents.map((document) => document.type)).toEqual(["invoice"]);
  });

  it("stops when any invoice in any run has no finished review, and a stale review stays out", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-open-"));
    const env = customerEnv(dir);
    seed(env, "batch", "SYN-1", "reviewed");
    seed(env, "other", "SYN-2", "open");
    writeInput(env, { "SYN-1": "sample_line", "SYN-2": "sample_line" }, []);
    const blocked = await rulesRun(dir);
    expect(blocked.code).toBe(1);
    expect(blocked.stderr).toContain("run other");
    expect(blocked.stderr).toContain("invoice SYN-2");
    expect(blocked.stderr).toContain("has no finished review");
    expect(fs.existsSync(path.join(rootOf(env), "runs", "batch", "rules", "day0.json"))).toBe(false);

    const staleDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-stale-"));
    const staleEnv = customerEnv(staleDir);
    seed(staleEnv, "batch", "SYN-9", "stale");
    writeInput(staleEnv, { "SYN-9": "sample_line" }, []);
    const stale = await rulesRun(staleDir);
    expect(stale.code).toBe(1);
    expect(stale.stderr).toContain("review is stale");
    expect(fs.existsSync(path.join(rootOf(staleEnv), "runs", "batch", "rules"))).toBe(false);
  });

  it("rejects two live reissues, a missing invoice, and a party id outside the config", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-gate-"));
    const env = customerEnv(dir);
    seed(env, "batch", "SYN-A", "reviewed");
    seed(env, "batch", "SYN-B", "reviewed");
    seed(env, "batch", "SYN-C", "reviewed");

    writeInput(env, { "SYN-A": "sample_line", "SYN-B": "sample_line", "SYN-C": "sample_line" }, [
      { invoice_number: "SYN-B", reissue_of: "SYN-A" },
      { invoice_number: "SYN-C", reissue_of: "SYN-A" },
    ]);
    const live = await rulesRun(dir);
    expect(live.code).toBe(1);
    expect(live.stderr).toContain("SYN-A has 2 live reissues: SYN-B, SYN-C.");
    expect(fs.existsSync(path.join(rootOf(env), "runs", "batch", "rules"))).toBe(false);

    writeInput(env, { "SYN-A": "sample_line", "SYN-B": "sample_line", "SYN-C": "sample_line" }, [
      { invoice_number: "SYN-B", reissue_of: "SYN-A" },
      { invoice_number: "SYN-C", reissue_of: "SYN-B" },
    ]);
    const chain = await rulesRun(dir);
    expect(chain.code, chain.stderr).toBe(0);
    expect(fs.existsSync(path.join(rootOf(env), "runs", "batch", "rules", "day0.json"))).toBe(true);
    expect(fs.existsSync(path.join(rootOf(env), "runs", "batch", "rules", "day1.json"))).toBe(true);

    writeInput(env, { "SYN-A": "sample_line", "SYN-B": "sample_line", "SYN-C": "sample_line" }, [
      { invoice_number: "SYN-B", reissue_of: "SYN-MISSING" },
    ]);
    const missing = await rulesRun(dir);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("SYN-MISSING");

    writeInput(env, { "SYN-A": "not_a_party", "SYN-B": "sample_line", "SYN-C": "sample_line" }, []);
    const party = await rulesRun(dir);
    expect(party.code).toBe(1);
    expect(party.stderr).toContain("SYN-A party not_a_party is not in the config.");

    writeInput(env, { "SYN-B": "sample_line", "SYN-C": "sample_line" }, []);
    const absent = await rulesRun(dir);
    expect(absent.code).toBe(1);
    expect(absent.stderr).toContain("SYN-A has no party id.");
  });

  it("leaves the previous rules and report files when the second write fails", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-atomic-"));
    const env = customerEnv(dir);
    seed(env, "batch", "SYN-1", "reviewed");
    writeInput(env, { "SYN-1": "sample_line" }, []);
    const first = await rulesRun(dir);
    expect(first.code, first.stderr).toBe(0);
    const reported = await reportRun(dir);
    expect(reported.code, reported.stderr).toBe(0);
    const rulesDir = path.join(rootOf(env), "runs", "batch", "rules");
    const reportDir = path.join(rootOf(env), "runs", "batch", "report");
    const beforeRules = [path.join(rulesDir, "day0.json"), path.join(rulesDir, "day1.json")].map((file) => fs.readFileSync(file));
    const reportNames = ["day0/findings.csv", "day0/report.json", "day1/findings.csv", "day1/report.json"];
    const beforeReport = reportNames.map((name) => fs.readFileSync(path.join(reportDir, name)));

    seed(env, "later", "SYN-2", "reviewed");
    writeInput(env, { "SYN-1": "sample_line", "SYN-2": "sample_line" }, []);
    const tornRules = await rulesRun(dir, failOnWrite(2));
    expect(tornRules.code).toBe(1);
    expect([path.join(rulesDir, "day0.json"), path.join(rulesDir, "day1.json")].map((file) => fs.readFileSync(file))).toEqual(beforeRules);

    const fresh = await rulesRun(dir);
    expect(fresh.code, fresh.stderr).toBe(0);
    const history = JSON.parse(fs.readFileSync(path.join(rulesDir, "day1.json"), "utf8")) as { invoices: { invoice_id: string; run_id: string }[] };
    expect(history.invoices.map((invoice) => invoice.run_id).sort()).toEqual(["batch", "later"]);
    const tornReport = await reportRun(dir, failOnWrite(2));
    expect(tornReport.code).toBe(1);
    expect(reportNames.map((name) => fs.readFileSync(path.join(reportDir, name)))).toEqual(beforeReport);
  });

  it("replays stored extractions to byte-identical reports and does not call the network", async () => {
    const calls: unknown[][] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      calls.push(args);
      throw new Error("network");
    }) as typeof fetch;
    try {
      const first = await stageFixtures("one");
      const secondRun = await rulesRun(first.dir);
      expect(secondRun.code, secondRun.stderr).toBe(0);
      const secondReport = await reportRun(first.dir);
      expect(secondReport.code, secondReport.stderr).toBe(0);
      expect(readPair(first.dir, "rules")).toEqual(first.rules);
      expect(readPair(first.dir, "report")).toEqual(first.report);

      const again = await stageFixtures("two");
      expect(again.rules).toEqual(first.rules);
      expect(again.report).toEqual(first.report);
      expect(calls).toEqual([]);

      const day0File = first.rules[0];
      const day1File = first.rules[1];
      if (day0File === undefined || day1File === undefined) throw new Error("rules files");
      const day1 = JSON.parse(day1File.toString("utf8")) as {
        total_disputable: { currency: string; amount: string }[];
        findings: { invoice_id: string; rule: string; disputable_amount: string }[];
        invoices: { invoice_id: string; run_id?: string }[];
      };
      const day0 = JSON.parse(day0File.toString("utf8")) as typeof day1;
      expect(day1.findings.filter((finding) => finding.invoice_id === "SYN-1004").map((finding) => finding.disputable_amount)).toEqual(["500.00"]);
      expect(day0.findings.filter((finding) => finding.invoice_id === "SYN-1004").map((finding) => finding.disputable_amount)).toEqual(["750.00"]);
      expect(day1.findings.filter((finding) => finding.invoice_id === "SYN-1002").map((finding) => finding.rule)).toEqual(["R1"]);
      expect(day1.total_disputable).toEqual([{ currency: "USD", amount: "3000.00" }]);
      expect(day0.total_disputable).toEqual([{ currency: "USD", amount: "3250.00" }]);
      expect(day1.invoices.map((invoice) => invoice.run_id)).toEqual(day1.invoices.map(() => "batch"));
      const sample = day1.invoices[0];
      expect(sample === undefined ? [] : Object.keys(sample)).toEqual(["invoice_id", "run_id", "elements", "outcomes"]);
      expect(new Set(day1.invoices.map((invoice) => invoice.invoice_id)).size).toBe(8);
    } finally {
      globalThis.fetch = original;
    }
  });
});

async function stageFixtures(label: string): Promise<{ dir: string; rules: Buffer[]; report: Buffer[] }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dd-replay-${label}-`));
  customerEnv(dir);
  const truths = fixtureIds.map((id) => fixtureTruthSchema.parse(JSON.parse(fs.readFileSync(path.join(fixtureDir, `${id}.json`), "utf8"))) as FixtureTruth);
  const pdfs = fixtureIds.map((id) => path.join(fixtureDir, `${id}.pdf`));
  const ingested = await runIngest(command(dir, ["harbor_home", "--run", "batch", "--type", "invoice", ...pdfs]));
  expect(ingested).toBe(0);
  const hashes = new Map(pdfs.map((file) => [path.basename(file, ".pdf"), createHash("sha256").update(fs.readFileSync(file)).digest("hex")]));
  for (const truth of truths) {
    const hash = hashes.get(truth.id);
    if (hash === undefined) throw new Error(`missing ${truth.id}`);
    const pages = pagesFromTruth(truth);
    for (const page of pages) {
      const folder = path.join(rootOf({ DD_DATA_DIR: dir }), "runs", "batch", hash, "extract", "pages", String(page.page).padStart(3, "0"));
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, "extraction.json"), `${JSON.stringify(page, null, 2)}\n`);
    }
  }
  const extracted = await runExtract(command(dir, ["harbor_home", "--run", "batch"]));
  expect(extracted).toBe(0);

  for (const truth of truths) {
    if (truth.id === "missing_elements") continue;
    const hash = hashes.get(truth.id);
    if (hash === undefined) throw new Error(`missing ${truth.id}`);
    const code = await reviewDocument(dir, hash, truth.pages, []);
    expect(code).toBe(0);
  }
  const early = await rulesRun(dir);
  expect(early.code).toBe(1);
  expect(early.stderr).toContain("invoice SYN-1002");
  expect(fs.existsSync(path.join(rootOf({ DD_DATA_DIR: dir }), "runs", "batch", "rules"))).toBe(false);

  const missing = truths.find((truth) => truth.id === "missing_elements");
  const missingHash = hashes.get("missing_elements");
  if (missing === undefined || missingHash === undefined) throw new Error("missing_elements");
  expect(await reviewDocument(dir, missingHash, missing.pages, [...removed])).toBe(0);

  const parties = Object.fromEntries(truths.map((truth) => [truth.invoice_number, "sample_line"]));
  writeInput({ DD_DATA_DIR: dir }, parties, []);
  const rules = await rulesRun(dir);
  expect(rules.code, rules.stderr).toBe(0);
  const report = await reportRun(dir);
  expect(report.code, report.stderr).toBe(0);
  return { dir, rules: readPair(dir, "rules"), report: readPair(dir, "report") };
}

function readPair(dir: string, kind: "rules" | "report"): Buffer[] {
  if (kind === "rules") {
    const folder = path.join(dir, "harbor_home", "runs", "batch", "rules");
    return [fs.readFileSync(path.join(folder, "day0.json")), fs.readFileSync(path.join(folder, "day1.json"))];
  }
  const folder = path.join(dir, "harbor_home", "runs", "batch", "report");
  return ["day0/findings.csv", "day0/report.json", "day1/findings.csv", "day1/report.json"].map((name) => fs.readFileSync(path.join(folder, name)));
}

async function reviewDocument(dir: string, hash: string, pages: number, confirms: readonly string[]): Promise<number> {
  const lines = [...Array.from({ length: pages }, () => "\n"), ...confirms.map((key) => `confirm ${key}\n`), "approve-lines\n", "finish\n"];
  const stderr: string[] = [];
  const code = await runReview({
    ...command(dir, ["harbor_home", "--run", "batch", "--document", hash, "--name", "Reviewer", "--now", now], stderr),
    stdin: Readable.from(lines),
    opener: () => undefined,
  });
  if (code !== 0) throw new Error(stderr.join(""));
  return code;
}

function command(dir: string, argv: string[], stderr: string[] = []): CommandIo {
  return {
    argv,
    env: { DD_DATA_DIR: dir },
    stdout: { write: () => undefined },
    stderr: { write: (chunk) => { stderr.push(chunk); } },
  };
}

async function rulesRun(dir: string, publish?: PublishHooks): Promise<{ code: number; stderr: string }> {
  const stderr: string[] = [];
  const io: RulesIo = { ...command(dir, ["harbor_home", "--run", "batch"], stderr), ...(publish === undefined ? {} : { publish }) };
  return { code: await runRulesCommand(io), stderr: stderr.join("") };
}

async function reportRun(dir: string, publish?: PublishHooks): Promise<{ code: number; stderr: string }> {
  const stderr: string[] = [];
  return { code: await runReport({ ...command(dir, ["harbor_home", "--run", "batch"], stderr), ...(publish === undefined ? {} : { publish }) }), stderr: stderr.join("") };
}

function customerEnv(dir: string): NodeJS.ProcessEnv {
  const root = path.join(dir, "harbor_home");
  fs.mkdirSync(root, { recursive: true });
  fs.copyFileSync(harborPath, path.join(root, "config.yaml"));
  return { DD_DATA_DIR: dir };
}

function rootOf(env: NodeJS.ProcessEnv): string {
  return path.join(env["DD_DATA_DIR"] ?? "", "harbor_home");
}

function writeInput(env: NodeJS.ProcessEnv, parties: Record<string, string>, reissues: { invoice_number: string; reissue_of: string }[]): void {
  fs.writeFileSync(path.join(rootOf(env), "review-input.json"), `${JSON.stringify({ parties, reissues }, null, 2)}\n`);
}

function seed(env: NodeJS.ProcessEnv, run: string, invoiceNumber: string, mode: "reviewed" | "open" | "stale"): void {
  const pdf = Buffer.from(`synthetic ${run} ${invoiceNumber}`);
  const hash = createHash("sha256").update(pdf).digest("hex");
  const root = rootOf(env);
  const blob = path.join(root, "blobs", `${hash}.pdf`);
  fs.mkdirSync(path.dirname(blob), { recursive: true });
  fs.writeFileSync(blob, pdf);
  const runDir = path.join(root, "runs", run);
  fs.mkdirSync(runDir, { recursive: true });
  const ingestPath = path.join(runDir, "ingest.json");
  const current = fs.existsSync(ingestPath)
    ? (JSON.parse(fs.readFileSync(ingestPath, "utf8")) as { documents: { sha256: string; type: string; source: string; movement: string }[] })
    : { documents: [] };
  if (!current.documents.some((document) => document.sha256 === hash)) {
    current.documents.push({ sha256: hash, type: "invoice", source: `${invoiceNumber}.pdf`, movement: "import" });
    fs.writeFileSync(ingestPath, `${JSON.stringify(current, null, 2)}\n`);
  }
  const prepared = blankPrepared(invoiceNumber);
  const docDir = path.join(runDir, hash);
  fs.mkdirSync(docDir, { recursive: true });
  const preparedPath = path.join(docDir, "prepared.json");
  fs.writeFileSync(preparedPath, `${JSON.stringify(prepared, null, 2)}\n`);
  if (mode === "open") return;
  const session = startReview({
    documentHash: hash,
    invoice: prepared.invoice,
    elements: prepared.elements,
    pages: 1,
    name: "Reviewer",
    at: now,
  });
  session.acknowledge(1);
  session.approveLines();
  fs.writeFileSync(path.join(docDir, "review.json"), `${JSON.stringify(session.finish(), null, 2)}\n`);
  const stamp = mode === "stale" ? "0".repeat(64) : createHash("sha256").update(fs.readFileSync(preparedPath)).digest("hex");
  fs.writeFileSync(path.join(docDir, "review.stamp"), `${stamp}\n`);
}

function blankPrepared(invoiceNumber: string): { pages: number; movement: "import"; invoice: ReturnType<typeof stitchedInvoiceSchema.parse>; elements: ReturnType<typeof assignPresence> } {
  const invoice = stitchedInvoiceSchema.parse({
    invoice_number: { text: invoiceNumber, page: 1 },
    currency: { text: "USD", page: 1 },
    elements: {},
    conflicts: [],
    header_conflicts: [],
    charge_lines: [],
    unresolved: [],
  });
  const elements = assignPresence(invoice, "import");
  for (const key of ELEMENT_KEYS) {
    const element = elements[key];
    if (element.state === "suggested_absent") elements[key] = { state: "present", text: "shown", page: 1 };
  }
  return { pages: 1, movement: "import", invoice, elements };
}

function failOnWrite(at: number): PublishHooks {
  let writes = 0;
  return {
    mkdir: (dir) => {
      fs.mkdirSync(dir, { recursive: true });
    },
    writeFile: (file, contents) => {
      writes += 1;
      if (writes === at) throw new Error("disk full");
      fs.writeFileSync(file, contents);
    },
    rename: (from, to) => {
      fs.renameSync(from, to);
    },
    exists: (file) => fs.existsSync(file),
    remove: (file) => {
      fs.rmSync(file, { force: true });
    },
  };
}

function pagesFromTruth(truth: FixtureTruth): PageExtraction[] {
  const buckets = new Map<number, { elements: PageExtraction["elements"]; charge_lines: PrintedChargeLine[] }>();
  for (let number = 1; number <= truth.pages; number += 1) buckets.set(number, { elements: {}, charge_lines: [] });
  for (const key of ELEMENT_KEYS) {
    const element = truth.elements[key as ElementKey];
    if (element.state !== "present" || element.page === null || element.text === undefined || element.text === "") continue;
    const bucket = buckets.get(element.page);
    if (bucket !== undefined) bucket.elements[key as ElementKey] = { text: element.text, page: element.page };
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
