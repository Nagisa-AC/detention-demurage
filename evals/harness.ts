import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ELEMENT_KEYS,
  assignPresence,
  fixtureTruthSchema,
  isUnreadable,
  loadCustomerConfig,
  pageExtractionSchema,
  parseDate,
  runRules,
  startReview,
  stitch,
  type ElementKey,
  type ElementRecord,
  type FixtureTruth,
  type PageExtraction,
  type RunInvoice,
  type StitchedInvoice,
} from "dd-core";

const SYNTHETIC_IDS = [
  "clean",
  "missing_elements",
  "late_37",
  "free_time_overbill",
  "arithmetic",
  "duplicate_a",
  "duplicate_b",
  "split_row",
] as const;

const DATE_KEYS = new Set<ElementKey>([
  "invoice_date",
  "invoice_due_date",
  "free_time_start",
  "free_time_end",
  "container_availability_date",
  "earliest_return_date",
]);

const REVIEW_AT = "2026-01-01T00:00:00.000Z";

export type FindingCounts = {
  matched: number;
  missed: number;
  extra: number;
};

export type ScoreReport = {
  falseAbsences: number;
  missedAbsences: number;
  unreadable: number;
  datesHit: number;
  datesTotal: number;
  findings: { day0: FindingCounts; day1: FindingCounts };
  notes: string[];
  fatal: string[];
};

export type ScoreOptions = {
  truthPath: (caseId: string) => string;
  pdfPath: (caseId: string) => string;
  partyId: (caseId: string) => string;
  configPath: string;
  failOnExtra: boolean;
  expectedIds?: readonly string[];
};

type ExpectedFinding = {
  rule: string;
  invoice: string;
  currency: string;
  amount: string;
  part: "" | "line" | "total";
};

type Loaded = {
  id: string;
  fatal: string[];
  notes: string[];
  truth: FixtureTruth | null;
  invoice: RunInvoice | null;
  confirmedReview: boolean;
  falseAbsences: number;
  missedAbsences: number;
  unreadable: number;
  datesHit: number;
  datesTotal: number;
  party: string;
};

export class ScoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoreError";
  }
}

type Io = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

export function scoreDirectory(dir: string, options: ScoreOptions): ScoreReport {
  const ids = caseIds(dir, options.expectedIds);
  const config = loadCustomerConfig(options.configPath);
  const loaded = ids.map((id) => loadCase(dir, id, options));
  const parties: Record<string, string> = {};
  const invoices: RunInvoice[] = [];
  for (const entry of loaded) {
    if (entry.invoice === null || entry.party === "") continue;
    invoices.push(entry.invoice);
    if (entry.invoice.invoice_number !== "") parties[entry.invoice.invoice_number] = entry.party;
  }

  const day0 = pairFindings(
    loaded.flatMap((entry) => expectedFindings(entry, "day0")),
    actualFindings(runRules(invoices, config, "day0", parties, []).findings),
  );
  const day1 = pairFindings(
    loaded.flatMap((entry) => expectedFindings(entry, "day1")),
    actualFindings(runRules(invoices, config, "day1", parties, []).findings),
  );
  const notes = [...new Set([...loaded.flatMap((entry) => entry.notes), ...day0.notes, ...day1.notes])].sort(compare);

  return {
    falseAbsences: sum(loaded, (entry) => entry.falseAbsences),
    missedAbsences: sum(loaded, (entry) => entry.missedAbsences),
    unreadable: sum(loaded, (entry) => entry.unreadable),
    datesHit: sum(loaded, (entry) => entry.datesHit),
    datesTotal: sum(loaded, (entry) => entry.datesTotal),
    findings: { day0: day0.counts, day1: day1.counts },
    notes,
    fatal: [...new Set(loaded.flatMap((entry) => entry.fatal))],
  };
}

export function formatReport(label: string, report: ScoreReport): string {
  const lines = [
    label,
    `false_absences ${report.falseAbsences}`,
    `missed_absences ${report.missedAbsences}`,
    `unreadable ${report.unreadable}`,
    `dates ${report.datesHit}/${report.datesTotal}`,
    findingLine("day0", report.findings.day0),
    findingLine("day1", report.findings.day1),
    ...report.notes,
  ];
  return `${lines.join("\n")}\n`;
}

export function failed(report: ScoreReport, failOnExtra: boolean): boolean {
  if (report.fatal.length > 0) return true;
  if (report.falseAbsences > 0) return true;
  if (report.findings.day0.missed > 0 || report.findings.day1.missed > 0) return true;
  if (failOnExtra && (report.findings.day0.extra > 0 || report.findings.day1.extra > 0)) return true;
  return false;
}

export function run(argv: readonly string[], io?: Io): number {
  const out = io ?? {
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
  };
  try {
    const command = parseArgs(argv);
    const report = scoreDirectory(command.dir, command.options);
    out.stdout(formatReport(command.label, report));
    return failed(report, command.options.failOnExtra) ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "evals failed.";
    out.stderr(`${message}\n`);
    return 1;
  }
}

function parseArgs(argv: readonly string[]): { dir: string; label: string; options: ScoreOptions } {
  const root = repoRoot();
  const harbor = path.join(root, "fixtures/config/harbor_home.yaml");
  if (argv.length === 0) {
    return {
      dir: path.join(root, "evals/synthetic"),
      label: "synthetic",
      options: {
        truthPath: (id) => path.join(root, "fixtures/synthetic", `${id}.json`),
        pdfPath: (id) => path.join(root, "fixtures/synthetic", `${id}.pdf`),
        partyId: () => "sample_line",
        configPath: harbor,
        failOnExtra: true,
        expectedIds: SYNTHETIC_IDS,
      },
    };
  }
  // Gold is the directory in DD_GOLD_DIR, passed here, so the folder name cannot collide with a customer id.
  if (argv.length === 2 && argv[0] === "--dir" && argv[1] !== undefined && argv[1] !== "") {
    const dir = argv[1];
    const config = path.join(dir, "config.yaml");
    return {
      dir,
      label: path.basename(dir),
      options: {
        truthPath: (id) => path.join(dir, id, "truth.json"),
        pdfPath: (id) => pdfInCase(path.join(dir, id)),
        partyId: (id) => readParty(path.join(dir, id)),
        configPath: fs.existsSync(config) ? config : harbor,
        failOnExtra: false,
      },
    };
  }
  throw new ScoreError("evals takes no arguments, or --dir <path>.");
}

function caseIds(dir: string, expected: readonly string[] | undefined): string[] {
  const present = fs.existsSync(dir) ? listDirs(dir) : [];
  if (!fs.existsSync(dir) && expected === undefined) throw new ScoreError(`directory ${dir} is missing.`);
  const ids = expected === undefined ? present : [...new Set([...expected, ...present])];
  ids.sort(compare);
  if (ids.length === 0) throw new ScoreError(`${dir} has no cases.`);
  return ids;
}

function loadCase(dir: string, id: string, options: ScoreOptions): Loaded {
  const blank = empty(id);
  const caseDir = path.join(dir, id);
  if (!fs.existsSync(caseDir)) {
    blank.fatal.push(`${id} page 001 is missing`);
    blank.notes.push(`${id} page 001 is missing`);
    return blank;
  }

  const party = readPartyId(id, options, blank);
  blank.party = party;
  const truthFile = options.truthPath(id);
  const prepared = loadTruth(truthFile);
  if (prepared === null) {
    blank.fatal.push(`${id} truth did not parse`);
    blank.notes.push(`${id} truth did not parse`);
    noteHash(id, caseDir, options.pdfPath(id), blank);
    return blank;
  }
  blank.truth = prepared.truth;

  const pages = loadPages(id, caseDir, prepared.truth.pages, blank);
  noteHash(id, caseDir, options.pdfPath(id), blank, pages.hashes);
  if (pages.extractions === null) return blank;

  let stitched: StitchedInvoice;
  try {
    stitched = stitch(pages.extractions);
  } catch {
    blank.fatal.push(`${id} did not stitch`);
    blank.notes.push(`${id} did not stitch`);
    return blank;
  }

  let presence: ElementRecord;
  try {
    presence = assignPresence(stitched, prepared.truth.movement);
  } catch {
    blank.fatal.push(`${id} presence did not parse`);
    blank.notes.push(`${id} presence did not parse`);
    return blank;
  }

  scoreElements(id, prepared.truth, prepared.absent, presence, stitched, blank);
  blank.invoice = toRun(stitched, presence, prepared.truth, prepared.absent, pages.hashes[0] ?? "eval", blank);
  return blank;
}

function scoreElements(
  id: string,
  truth: FixtureTruth,
  absent: ReadonlySet<ElementKey>,
  presence: ElementRecord,
  stitched: StitchedInvoice,
  loaded: Loaded,
): void {
  for (const key of ELEMENT_KEYS) {
    const expected = truth.elements[key];
    const got = presence[key];
    if (expected.state === "not_applicable") {
      if (got.state !== "not_applicable") {
        loaded.fatal.push(`${id} ${key} not_applicable`);
        loaded.notes.push(`${id} ${key} not_applicable`);
      }
      continue;
    }
    if (got.state === "not_applicable" && expected.state !== "present") {
      loaded.fatal.push(`${id} ${key} not_applicable`);
      loaded.notes.push(`${id} ${key} not_applicable`);
      continue;
    }
    if (expected.state === "present" && (got.state === "suggested_absent" || got.state === "not_applicable")) {
      loaded.falseAbsences += 1;
      loaded.notes.push(`${id} ${key} false_absence`);
    } else if ((expected.state === "suggested_absent" || absent.has(key)) && got.state === "present") {
      loaded.missedAbsences += 1;
      loaded.notes.push(`${id} ${key} missed_absence`);
    }
    if (got.state === "unreadable") {
      loaded.unreadable += 1;
      loaded.notes.push(`${id} ${key} unreadable`);
    }
    if (expected.state === "present" && DATE_KEYS.has(key)) {
      loaded.datesTotal += 1;
      const left = expected.text === undefined ? null : isoDate(expected.text);
      const right = got.state === "present" ? isoOfElement(got) : null;
      if (left !== null && right !== null && left === right) loaded.datesHit += 1;
      else loaded.notes.push(`${id} ${key} date_miss`);
    }
  }

  truth.charge_lines.forEach((line, index) => {
    const got = stitched.charge_lines[index];
    scoreLineDate(id, index, "charged_from", line.charged_from, got?.charged_from?.text, loaded);
    scoreLineDate(id, index, "charged_to", line.charged_to, got?.charged_to?.text, loaded);
  });
}

function scoreLineDate(
  id: string,
  index: number,
  field: "charged_from" | "charged_to",
  truthText: string,
  pipelineText: string | undefined,
  loaded: Loaded,
): void {
  loaded.datesTotal += 1;
  const left = isoDate(truthText);
  const right = pipelineText === undefined ? null : isoDate(pipelineText);
  if (left !== null && right !== null && left === right) loaded.datesHit += 1;
  else loaded.notes.push(`${id} charge_line_${index + 1}_${field} date_miss`);
}

function toRun(
  stitched: StitchedInvoice,
  presence: ElementRecord,
  truth: FixtureTruth,
  absent: ReadonlySet<ElementKey>,
  documentHash: string,
  loaded: Loaded,
): RunInvoice | null {
  try {
    const session = startReview({
      documentHash,
      invoice: stitched,
      elements: presence,
      pages: Math.max(truth.pages, 1),
      name: "eval",
      at: REVIEW_AT,
    });
    for (let page = 1; page <= truth.pages; page += 1) session.acknowledge(page);
    const confirmed = new Set<ElementKey>();
    for (const key of ELEMENT_KEYS) {
      const element = presence[key];
      if (!absent.has(key) || element.state !== "suggested_absent") continue;
      session.confirmAbsent(key);
      confirmed.add(key);
    }
    const reviewKeys = truth.review_cases?.after_review.confirmed_absent ?? [];
    loaded.confirmedReview = reviewKeys.length > 0 && reviewKeys.every((key) => confirmed.has(key));
    const elements = session.view().elements;
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
  } catch {
    loaded.fatal.push(`${loaded.id} review did not finish`);
    loaded.notes.push(`${loaded.id} review did not finish`);
    return null;
  }
}

function expectedFindings(entry: Loaded, convention: "day0" | "day1"): ExpectedFinding[] {
  if (entry.truth === null) return [];
  const invoice = entry.truth.invoice_number;
  const items: ExpectedFinding[] = [];
  for (const finding of entry.truth.expected_findings) {
    items.push({
      rule: finding.rule,
      invoice,
      currency: finding.currency,
      amount: finding.disputable_amount,
      part: finding.rule === "R4" ? finding.part : "",
    });
  }
  const side = entry.truth.by_convention?.[convention];
  if (side !== undefined) {
    items.push({
      rule: "R3",
      invoice,
      currency: side.finding.currency,
      amount: side.finding.disputable_amount,
      part: "",
    });
  }
  if (entry.confirmedReview) {
    const finding = entry.truth.review_cases?.after_review.finding;
    if (finding !== undefined) {
      items.push({
        rule: "R1",
        invoice,
        currency: finding.currency,
        amount: finding.disputable_amount,
        part: "",
      });
    }
  }
  return items;
}

function pairFindings(expected: readonly ExpectedFinding[], actual: readonly ExpectedFinding[]): {
  counts: FindingCounts;
  notes: string[];
} {
  const pool = actual.map((item) => ({ item, used: false }));
  const missed: ExpectedFinding[] = [];
  let matched = 0;
  for (const item of expected) {
    const slot = pool.find((entry) => !entry.used && sameFinding(entry.item, item));
    if (slot === undefined) missed.push(item);
    else {
      slot.used = true;
      matched += 1;
    }
  }
  const extra = pool.filter((entry) => !entry.used).map((entry) => entry.item);
  missed.sort(byFinding);
  extra.sort(byFinding);
  return {
    counts: { matched, missed: missed.length, extra: extra.length },
    notes: [...missed.map((item) => findingNote(item, "missed")), ...extra.map((item) => findingNote(item, "extra"))],
  };
}

function actualFindings(
  findings: readonly { rule: string; invoice_id: string; currency: string; disputable_amount: string; explain: string }[],
): ExpectedFinding[] {
  return findings.map((finding) => ({
    rule: finding.rule,
    invoice: finding.invoice_id,
    currency: finding.currency,
    amount: finding.disputable_amount,
    part: r4Part(finding.rule, finding.explain),
  }));
}

function r4Part(rule: string, explain: string): "" | "line" | "total" {
  if (rule !== "R4") return "";
  return explain.startsWith("The charge lines sum") ? "total" : "line";
}

function sameFinding(left: ExpectedFinding, right: ExpectedFinding): boolean {
  return (
    left.rule === right.rule &&
    left.invoice === right.invoice &&
    left.currency === right.currency &&
    left.amount === right.amount &&
    left.part === right.part
  );
}

function findingNote(item: ExpectedFinding, kind: "missed" | "extra"): string {
  const part = item.part === "" ? "" : ` ${item.part}`;
  return `${item.invoice} ${item.rule}${part} ${item.amount} ${kind}`;
}

function byFinding(left: ExpectedFinding, right: ExpectedFinding): number {
  return compare(left.invoice, right.invoice) || compare(left.rule, right.rule) || compare(left.part, right.part) || compare(left.amount, right.amount);
}

function loadPages(
  id: string,
  caseDir: string,
  expectedPages: number,
  loaded: Loaded,
): { extractions: PageExtraction[] | null; hashes: string[] } {
  const present = pageDirs(caseDir);
  const expected = Array.from({ length: expectedPages }, (_value, index) => pageName(index + 1));
  let blocked = false;
  const extractions: PageExtraction[] = [];
  const hashes: string[] = [];

  for (const name of present) {
    if (!expected.includes(name)) {
      loaded.fatal.push(`${id} page ${name} is extra`);
      loaded.notes.push(`${id} page ${name} is extra`);
      blocked = true;
    }
  }

  for (const name of expected) {
    const number = Number(name);
    const folder = path.join(caseDir, "pages", name);
    if (!present.includes(name)) {
      loaded.fatal.push(`${id} page ${name} is missing`);
      loaded.notes.push(`${id} page ${name} is missing`);
      blocked = true;
      continue;
    }
    const record = readRecord(path.join(folder, "record.json"));
    if (record.kind === "missing") {
      loaded.fatal.push(`${id} page ${name} is missing`);
      loaded.notes.push(`${id} page ${name} is missing`);
      blocked = true;
      continue;
    }
    if (record.kind === "parse") {
      loaded.fatal.push(`${id} page ${name} did not parse`);
      loaded.notes.push(`${id} page ${name} did not parse`);
      blocked = true;
      continue;
    }
    if (record.kind === "hash") {
      loaded.fatal.push(`${id} record.json has no pdf sha256`);
      loaded.notes.push(`${id} record.json has no pdf sha256`);
      blocked = true;
      continue;
    }
    hashes.push(record.hash);
    if (record.status === "failed") {
      loaded.fatal.push(`${id} page ${name} failed`);
      loaded.notes.push(`${id} page ${name} failed`);
      blocked = true;
      continue;
    }
    const extractionFile = path.join(folder, "extraction.json");
    if (!fs.existsSync(extractionFile)) {
      loaded.fatal.push(`${id} page ${name} is missing`);
      loaded.notes.push(`${id} page ${name} is missing`);
      blocked = true;
      continue;
    }
    const extraction = readExtraction(extractionFile);
    if (extraction === null || extraction.page !== number) {
      loaded.fatal.push(`${id} page ${name} did not parse`);
      loaded.notes.push(`${id} page ${name} did not parse`);
      blocked = true;
      continue;
    }
    extractions.push(extraction);
  }

  return { extractions: blocked ? null : extractions, hashes };
}

function noteHash(id: string, caseDir: string, pdfPath: string, loaded: Loaded, hashes: readonly string[] = hashesOf(caseDir)): void {
  void caseDir;
  const digest = fileHash(pdfPath);
  if (digest === null) {
    loaded.fatal.push(`${id} pdf is missing`);
    loaded.notes.push(`${id} pdf is missing`);
    return;
  }
  if (hashes.some((hash) => hash !== digest)) {
    loaded.fatal.push(`${id} pdf hash does not match record.json`);
    loaded.notes.push(`${id} pdf hash does not match record.json`);
  }
}

function hashesOf(caseDir: string): string[] {
  const hashes: string[] = [];
  for (const name of pageDirs(caseDir)) {
    const record = readRecord(path.join(caseDir, "pages", name, "record.json"));
    if (record.kind === "ok") hashes.push(record.hash);
  }
  return hashes;
}

type RecordRead =
  | { kind: "missing" }
  | { kind: "parse" }
  | { kind: "hash" }
  | { kind: "ok"; status: "ok" | "failed"; hash: string };

function readRecord(file: string): RecordRead {
  if (!fs.existsSync(file)) return { kind: "missing" };
  const raw = readJson(file);
  if (!isRecord(raw)) return { kind: "parse" };
  const status = raw["status"];
  if (status !== "ok" && status !== "failed") return { kind: "parse" };
  const hash = raw["document_sha256"];
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return { kind: "hash" };
  return { kind: "ok", status, hash };
}

function readExtraction(file: string): PageExtraction | null {
  const raw = readJson(file);
  const parsed = pageExtractionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function loadTruth(file: string): { truth: FixtureTruth; absent: Set<ElementKey> } | null {
  if (!fs.existsSync(file)) return null;
  const raw = readJson(file);
  if (!isRecord(raw)) return null;
  const confirmed = new Set<ElementKey>();
  const elements = raw["elements"];
  let body: unknown = raw;
  if (isRecord(elements)) {
    const next: Record<string, unknown> = { ...elements };
    for (const key of ELEMENT_KEYS) {
      const value = elements[key];
      if (!isRecord(value) || value["state"] !== "confirmed_absent") continue;
      confirmed.add(key);
      next[key] = { state: "suggested_absent", page: null };
    }
    body = { ...raw, elements: next };
  }
  const parsed = fixtureTruthSchema.safeParse(body);
  if (!parsed.success) return null;
  const absent = new Set<ElementKey>(confirmed);
  for (const key of ELEMENT_KEYS) {
    if (parsed.data.elements[key].state === "suggested_absent") absent.add(key);
  }
  return { truth: parsed.data, absent };
}

function readPartyId(id: string, options: ScoreOptions, loaded: Loaded): string {
  try {
    const party = options.partyId(id).trim();
    if (party === "") {
      loaded.fatal.push(`${id} has no party id`);
      loaded.notes.push(`${id} has no party id`);
      return "";
    }
    return party;
  } catch {
    loaded.fatal.push(`${id} has no party id`);
    loaded.notes.push(`${id} has no party id`);
    return "";
  }
}

function pdfInCase(caseDir: string): string {
  const named = path.join(caseDir, "source.pdf");
  if (fs.existsSync(named)) return named;
  if (!fs.existsSync(caseDir)) return named;
  const pdfs = fs.readdirSync(caseDir).filter((name) => name.endsWith(".pdf")).sort(compare);
  const only = pdfs.length === 1 ? pdfs[0] : undefined;
  return only === undefined ? named : path.join(caseDir, only);
}

function readParty(caseDir: string): string {
  const file = path.join(caseDir, "party.txt");
  if (!fs.existsSync(file)) throw new ScoreError("party file is missing");
  return fs.readFileSync(file, "utf8").trim();
}

function empty(id: string): Loaded {
  return {
    id,
    fatal: [],
    notes: [],
    truth: null,
    invoice: null,
    confirmedReview: false,
    falseAbsences: 0,
    missedAbsences: 0,
    unreadable: 0,
    datesHit: 0,
    datesTotal: 0,
    party: "",
  };
}

function pageDirs(caseDir: string): string[] {
  const pagesDir = path.join(caseDir, "pages");
  if (!fs.existsSync(pagesDir)) return [];
  return fs
    .readdirSync(pagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{3}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort(compare);
}

function pageName(number: number): string {
  return String(number).padStart(3, "0");
}

function isoOfElement(element: ElementRecord[ElementKey]): string | null {
  if (element.state !== "present") return null;
  if (element.value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(element.value)) return element.value;
  if (element.text === undefined) return null;
  return isoDate(element.text);
}

function isoDate(text: string): string | null {
  const parsed = parseDate(text);
  return isUnreadable(parsed) ? null : parsed;
}

function fileHash(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  try {
    return sha256(fs.readFileSync(file));
  } catch {
    return null;
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function listDirs(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function sum(loaded: readonly Loaded[], pick: (entry: Loaded) => number): number {
  let total = 0;
  for (const entry of loaded) total += pick(entry);
  return total;
}

function findingLine(convention: "day0" | "day1", counts: FindingCounts): string {
  return `findings ${convention} matched ${counts.matched} missed ${counts.missed} extra ${counts.extra}`;
}

function compare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

const entry = process.argv[1];
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
