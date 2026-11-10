import fs from "node:fs";
import path from "node:path";
import { loadReview, reportJson, runRules, type ReviewResult, type RunInvoice } from "dd-core";
import { CliError, fail } from "./cli-error.js";
import {
  blobPath,
  documentDir,
  listRuns,
  loadConfig,
  readIngest,
  requireRun,
  sha256,
  type CommandIo,
} from "./layout.js";
import { readPrepared } from "./prepared.js";
import { publishFiles, type PublishHooks } from "./publish.js";
import { readReviewInput, validateReviewInput } from "./review-input.js";

export type RulesIo = CommandIo & { publish?: PublishHooks };

export async function runRulesCommand(io: RulesIo): Promise<number> {
  try {
    const { root, run, runDir, customer } = requireRun(io.argv, io.env);
    const config = loadConfig(root, customer);
    if (!fs.existsSync(path.join(runDir, "ingest.json"))) throw new CliError(`run ${run} was not ingested.`);
    const history = loadHistory(root);
    const input = readReviewInput(root);
    validateReviewInput(
      input,
      [...new Set(history.map((item) => item.invoice.invoice_number))],
      config,
    );
    const invoices = [...history]
      .sort((left, right) => compare(left.runId, right.runId) || compare(left.invoice.invoice_number, right.invoice.invoice_number) || compare(left.hash, right.hash))
      .map((item) => item.invoice);
    const day0 = reportJson(runRules(invoices, config, "day0", input.parties, input.reissues));
    const day1 = reportJson(runRules(invoices, config, "day1", input.parties, input.reissues));
    publishFiles(
      [
        { path: path.join(runDir, "rules", "day0.json"), contents: day0 },
        { path: path.join(runDir, "rules", "day1.json"), contents: day1 },
      ],
      io.publish,
    );
    return 0;
  } catch (error) {
    return fail(io, error);
  }
}

type Reviewed = { runId: string; hash: string; invoice: RunInvoice };

function loadHistory(root: string): Reviewed[] {
  const problems: string[] = [];
  const reviewed: Reviewed[] = [];
  for (const runId of listRuns(root)) {
    for (const document of readIngest(path.join(root, "runs", runId))) {
      if (document.type !== "invoice") continue;
      const dir = documentDir(root, runId, document.sha256);
      const preparedPath = path.join(dir, "prepared.json");
      const number = peekInvoiceNumber(preparedPath);
      const label = number === "" ? `run ${runId} document ${document.sha256}` : `run ${runId} document ${document.sha256} invoice ${number}`;
      const reviewPath = path.join(dir, "review.json");
      if (!fs.existsSync(preparedPath) || !fs.existsSync(reviewPath)) {
        problems.push(`${label} has no finished review.`);
        continue;
      }
      const preparedBytes = fs.readFileSync(preparedPath);
      const stampPath = path.join(dir, "review.stamp");
      const stamp = fs.existsSync(stampPath) ? fs.readFileSync(stampPath, "utf8").trim() : "";
      const blob = blobPath(root, document.sha256);
      const blobBytes = fs.existsSync(blob) ? fs.readFileSync(blob) : undefined;
      if (stamp !== sha256(preparedBytes) || blobBytes === undefined || sha256(blobBytes) !== document.sha256) {
        problems.push(`${label} review is stale.`);
        continue;
      }
      try {
        const prepared = readPrepared(preparedPath);
        const saved: unknown = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
        const review = loadReview(saved, prepared.pages);
        if (review.document_hash !== document.sha256) {
          problems.push(`${label} review is stale.`);
          continue;
        }
        if (number === "") {
          problems.push(`${label} has no invoice number.`);
          continue;
        }
        reviewed.push({ runId, hash: document.sha256, invoice: toRun(review, runId) });
      } catch (error) {
        if (error instanceof CliError) throw error;
        problems.push(`${label} has no finished review.`);
      }
    }
  }
  if (problems.length > 0) throw new CliError(problems.join("\n"));
  if (reviewed.length === 0) throw new CliError("no invoice to report.");
  return reviewed;
}

function peekInvoiceNumber(preparedPath: string): string {
  if (!fs.existsSync(preparedPath)) return "";
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(preparedPath, "utf8"));
    if (!isRecord(raw) || !isRecord(raw["invoice"])) return "";
    const number = raw["invoice"]["invoice_number"];
    if (!isRecord(number) || typeof number["text"] !== "string") return "";
    return number["text"];
  } catch {
    return "";
  }
}

function toRun(review: ReviewResult, runId: string): RunInvoice {
  const stitched = review.invoice;
  return {
    invoice_number: stitched.invoice_number?.text ?? "",
    currency: stitched.currency?.text ?? "",
    run_id: runId,
    elements: review.elements,
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

function compare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
