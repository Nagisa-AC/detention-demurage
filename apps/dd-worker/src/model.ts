import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PageExtraction } from "dd-core";
import { extract, type ExtractedPage, type ExtractResult } from "dd-extract";
import type { GroundPage } from "./process.js";

const CHARGE_FIELDS = ["container", "charge", "charged_from", "charged_to", "days", "rate", "amount"] as const;
const HEADERS = ["invoice_number", "billing_party", "billed_party", "currency"] as const;

export async function readModelPages(
  pdf: Uint8Array,
  pages: readonly number[],
  run: (pdf: Uint8Array, pages: readonly number[], outDir: string) => Promise<ExtractResult> = runAnthropic,
): Promise<GroundPage[]> {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-worker-"));
  try {
    const result = await run(pdf, pages, outDir);
    return result.pages.map(toGround);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
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
    const reason = page.record.reason;
    const failed: GroundPage = { ...base, status: "failed", values: [] };
    if (reason !== undefined) failed.reason = reason;
    return failed;
  }
  return { ...base, status: "ok", values: valuesOf(page.extraction) };
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
