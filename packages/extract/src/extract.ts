import { APIError } from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import type { PageExtraction } from "dd-core";
import { readAnthropicPage, type ModelResponse } from "./anthropic.js";
import { addUsage, emptyUsage, priceUsage, type Usage } from "./cost.js";
import { mapModelText } from "./map.js";
import { splitPdf } from "./pdf.js";
import { PROMPT_VERSION } from "./prompt.js";
import { SCHEMA_VERSION } from "./provider-schema.js";
import { buildAnthropicRequest, DEFAULT_EFFORT, DEFAULT_MODEL, isEffort, type Effort } from "./request.js";

export type { Effort, Usage };
export { DEFAULT_EFFORT, DEFAULT_MODEL, PROMPT_VERSION, SCHEMA_VERSION };

/** What one page of the model returned. A fake stands in for Anthropic in tests. */
export type PageReader = (input: {
  pageNumber: number;
  pdf: Uint8Array;
  model: string;
  effort: Effort;
  retry: { previous: string; errors: string } | null;
}) => Promise<ModelResponse> | ModelResponse;

export type PageRecord = {
  page: number;
  status: "ok" | "failed";
  model: string;
  effort: Effort;
  prompt_version: string;
  schema_version: string;
  latency_ms: number;
  usage: Usage;
  cost_usd: string | null;
  cost_note?: string;
  inference_geo: string | null;
  attempts: number;
  reason?: string;
};

export type ExtractedPage =
  | { status: "ok"; extraction: PageExtraction; record: PageRecord }
  | { status: "failed"; record: PageRecord };

export type ExtractResult = {
  pages: ExtractedPage[];
};

export type ExtractOptions = {
  pdf: Uint8Array;
  outDir: string;
  provider: "anthropic" | "fake";
  model?: string;
  effort?: Effort;
  fake?: PageReader;
};

/**
 * Read each page of a PDF. Files are written only under `outDir`.
 * Anthropic is called only when `provider` is `"anthropic"`.
 */
export async function extract(options: ExtractOptions): Promise<ExtractResult> {
  if (options.outDir.trim() === "") throw new Error("outDir is required.");
  const model = options.model ?? DEFAULT_MODEL;
  const effort = options.effort ?? DEFAULT_EFFORT;
  if (!isEffort(effort)) throw new Error("effort is not a supported level.");
  const read = reader(options);
  const pages = await splitPdf(options.pdf);
  const result: ExtractedPage[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    const pdf = pages[index];
    if (pdf === undefined) continue;
    result.push(await readPage(read, { pdf, pageNumber: index + 1, model, effort, outDir: options.outDir }));
  }
  fs.mkdirSync(options.outDir, { recursive: true });
  fs.writeFileSync(
    path.join(options.outDir, "usage.json"),
    `${JSON.stringify(result.map((page) => page.record), null, 2)}\n`,
  );
  return { pages: result };
}

function reader(options: ExtractOptions): PageReader {
  if (options.provider === "fake") {
    if (options.fake === undefined) throw new Error("A fake provider is required.");
    return options.fake;
  }
  if (options.provider !== "anthropic") throw new Error("provider must be anthropic or fake.");
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (apiKey === undefined || apiKey === "") throw new Error("ANTHROPIC_API_KEY is not set.");
  return async (input) => {
    const request = buildAnthropicRequest(input);
    return readAnthropicPage(request, apiKey);
  };
}

async function readPage(
  read: PageReader,
  input: { pdf: Uint8Array; pageNumber: number; model: string; effort: Effort; outDir: string },
): Promise<ExtractedPage> {
  let usage = emptyUsage();
  let latency = 0;
  let inferenceGeo: string | null = null;
  const attempts: string[] = [];
  let errors = "";
  let reason = "The page did not match the schema.";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const started = performance.now();
    let response: ModelResponse;
    try {
      response = await read({
        pageNumber: input.pageNumber,
        pdf: input.pdf,
        model: input.model,
        effort: input.effort,
        retry: attempt === 1 ? null : { previous: attempts[attempts.length - 1] ?? "", errors },
      });
    } catch (error) {
      latency += elapsed(started);
      reason = transportReason(error);
      break;
    }
    latency += elapsed(started);
    usage = addUsage(usage, response.usage);
    inferenceGeo = response.inferenceGeo;
    attempts.push(response.text);

    if (response.inferenceGeo !== "us") {
      reason = `Inference ran in ${response.inferenceGeo ?? "an unknown region"}.`;
      break;
    }
    if (response.stopReason === "max_tokens") {
      errors = "The response was cut off.";
      reason = errors;
      if (attempt === 1) continue;
      break;
    }
    const mapped = mapModelText(response.text, input.pageNumber);
    if (mapped.ok) {
      const record = recordOf(input, "ok", usage, latency, inferenceGeo, attempts.length);
      writePage(input.outDir, record, attempts);
      return { status: "ok", extraction: mapped.extraction, record };
    }
    errors = mapped.errors;
    reason = errors;
  }

  const record = recordOf(input, "failed", usage, latency, inferenceGeo, attempts.length, reason);
  writePage(input.outDir, record, attempts);
  return { status: "failed", record };
}

function recordOf(
  input: { pageNumber: number; model: string; effort: Effort },
  status: "ok" | "failed",
  usage: Usage,
  latency: number,
  inferenceGeo: string | null,
  attempts: number,
  reason?: string,
): PageRecord {
  const priced = priceUsage(input.model, usage);
  const record: PageRecord = {
    page: input.pageNumber,
    status,
    model: input.model,
    effort: input.effort,
    prompt_version: PROMPT_VERSION,
    schema_version: SCHEMA_VERSION,
    latency_ms: latency,
    usage,
    cost_usd: priced.cost_usd,
    inference_geo: inferenceGeo,
    attempts,
  };
  if (priced.cost_note !== undefined) record.cost_note = priced.cost_note;
  if (reason !== undefined) record.reason = reason;
  return record;
}

/** SDK error type and HTTP status only. The response body is not recorded. */
function transportReason(error: unknown): string {
  if (error instanceof APIError) {
    const type = error.type ?? error.name;
    if (typeof error.status === "number") return `${type} ${error.status}`;
    return type;
  }
  if (error instanceof Error && error.name !== "") return error.name;
  return "request_failed";
}

function writePage(outDir: string, record: PageRecord, attempts: string[]): void {
  const dir = path.join(outDir, "pages", String(record.page).padStart(3, "0"));
  fs.mkdirSync(dir, { recursive: true });
  attempts.forEach((text, index) => {
    fs.writeFileSync(path.join(dir, `attempt-${index + 1}.txt`), text);
  });
  fs.writeFileSync(path.join(dir, "record.json"), `${JSON.stringify(record, null, 2)}\n`);
}

function elapsed(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}
