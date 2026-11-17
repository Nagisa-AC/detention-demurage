import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PageExtraction } from "dd-core";
import { extract, tempDirError, type ExtractedPage, type ExtractResult } from "dd-extract";
import { InferenceGeoError, ModelOutputError } from "./errors.js";
import type { GroundPage } from "./process.js";

const CHARGE_FIELDS = ["container", "charge", "charged_from", "charged_to", "days", "rate", "amount"] as const;
const HEADERS = ["invoice_number", "billing_party", "billed_party", "currency"] as const;

export async function readModelPages(
  pdf: Uint8Array,
  pages: readonly number[],
  run: (pdf: Uint8Array, pages: readonly number[], outDir: string) => Promise<ExtractResult> = runAnthropic,
): Promise<GroundPage[]> {
  const outDir = makeTempDir();
  try {
    const result = await run(pdf, pages, outDir);
    const grounded = result.pages.map(toGround);
    removeTempDir(outDir);
    return grounded;
  } catch (error) {
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch {
      // The processing error is the one the attempt records.
    }
    throw error;
  }
}

function removeTempDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    throw tempDirError(error);
  }
}

/** One directory per attempt, under the process temp dir, which PrivateTmp maps to a writable /tmp. */
function makeTempDir(): string {
  const root = path.resolve(os.tmpdir());
  let dir: string;
  try {
    dir = fs.mkdtempSync(path.join(root, "dd-worker-"));
  } catch (error) {
    throw tempDirError(error);
  }
  const resolved = path.resolve(dir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw tempDirError(new Error("outside"));
  return resolved;
}

async function runAnthropic(pdf: Uint8Array, pages: readonly number[], outDir: string): Promise<ExtractResult> {
  return extract({ pdf, outDir, provider: "anthropic", onlyPages: pages });
}

function toGround(page: ExtractedPage): GroundPage {
  const base = {
    page: page.record.page,
    attempts: page.record.attempts,
    model: page.record.model,
    promptVersion: page.record.prompt_version,
    schemaVersion: page.record.schema_version,
  };
  if (page.status === "failed") {
    const geo = page.record.inference_geo;
    if (geo !== null && geo !== "us") throw new InferenceGeoError();
    const reason = page.record.reason;
    if (!isTransportReason(reason)) throw new ModelOutputError();
    const failed: GroundPage = { ...base, status: "failed", values: [] };
    if (reason !== undefined) failed.reason = reason;
    return failed;
  }
  return { ...base, status: "ok", values: valuesOf(page.extraction) };
}

/** SDK names and HTTP statuses. A sentence is model output, and its text is not kept. */
function isTransportReason(reason: string | undefined): boolean {
  if (reason === undefined) return false;
  return /^[A-Za-z][A-Za-z0-9_.]*$/.test(reason) || /^[A-Za-z][A-Za-z0-9_.]* \d{3}$/.test(reason);
}

function valuesOf(extraction: PageExtraction): { field: string; text: string }[] {
  const found: { field: string; text: string }[] = [];
  for (const field of HEADERS) {
    const text = extraction[field];
    if (typeof text === "string" && text.length > 0) found.push({ field, text });
  }
  for (const [key, element] of Object.entries(extraction.elements)) {
    if (element !== undefined && element.text.length > 0) found.push({ field: key, text: element.text });
  }
  extraction.charge_lines.forEach((line, index) => {
    for (const field of CHARGE_FIELDS) {
      const text = line[field];
      if (typeof text === "string" && text.length > 0) found.push({ field: `line${index + 1}.${field}`, text });
    }
  });
  return found;
}
