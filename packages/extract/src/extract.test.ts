import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APIError, RateLimitError } from "@anthropic-ai/sdk";
import { ELEMENT_KEYS, fixtureTruthSchema, invoiceExtractionSchema, type FixtureTruth } from "dd-core";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { priceUsage, type Usage } from "./cost.js";
import { extract, type PageReader } from "./extract.js";
import type { ModelResponse } from "./anthropic.js";
import { buildAnthropicRequest } from "./request.js";
import { providerSchema } from "./provider-schema.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixtureDir = path.join(repoRoot, "fixtures/synthetic");
const fixtureIds = [
  "clean",
  "missing_elements",
  "late_37",
  "free_time_overbill",
  "arithmetic",
  "duplicate_a",
  "duplicate_b",
  "split_row",
];

const oneCall: Usage = {
  input_tokens: 1000,
  output_tokens: 500,
  cache_5m_tokens: 0,
  cache_1h_tokens: 0,
  cache_read_tokens: 0,
};

beforeEach(() => {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("network")));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("priceUsage", () => {
  it("prices Sonnet 5.5 tokens at the US rate and leaves other models unpriced", () => {
    expect(priceUsage("claude-sonnet-5-5", oneCall)).toEqual({ cost_usd: "0.0077" });
    expect(priceUsage("claude-sonnet-5-5", { ...oneCall, input_tokens: 0, output_tokens: 0, cache_read_tokens: 1_000_000 })).toEqual({ cost_usd: "0.11" });
    expect(priceUsage("claude-sonnet-5-5", { ...oneCall, input_tokens: 0, output_tokens: 0, cache_5m_tokens: 1_000_000 })).toEqual({ cost_usd: "2.75" });
    expect(priceUsage("claude-sonnet-5-5", { ...oneCall, input_tokens: 0, output_tokens: 0, cache_1h_tokens: 1_000_000 })).toEqual({ cost_usd: "4.4" });
    expect(priceUsage("claude-opus-5-5", oneCall)).toEqual({ cost_usd: null, cost_note: "No price for claude-opus-5-5." });
  });
});

describe("provider schema", () => {
  it("enumerates the 20 element keys", () => {
    const properties = providerSchema()["properties"] as {
      elements: { items: { properties: { key: { enum: string[] } } } };
    };
    expect(properties.elements.items.properties.key.enum).toEqual([...ELEMENT_KEYS]);
  });
});

describe("Anthropic request", () => {
  it("pins the model, US inference, low effort, and a one-page PDF", () => {
    const request = buildAnthropicRequest({
      model: "claude-opus-5-5",
      effort: "medium",
      pageNumber: 2,
      pdf: new Uint8Array([1, 2, 3]),
      retry: null,
    });
    expect(request.model).toBe("claude-opus-5-5");
    expect(request.inference_geo).toBe("us");
    expect(request.output_config?.effort).toBe("medium");
    expect(request.output_config?.format?.type).toBe("json_schema");
    expect(request.max_tokens).toBe(8192);
    expect("temperature" in request).toBe(false);

    const content = request.messages[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    const document = content.find((block) => block.type === "document");
    const text = content.find((block) => block.type === "text");
    expect(document?.type).toBe("document");
    if (document?.type === "document" && document.source.type === "base64") {
      expect(document.source.media_type).toBe("application/pdf");
    } else {
      throw new Error("missing pdf");
    }
    expect(text?.type === "text" ? text.text : "").toBe("This is page 2.");
    const system = typeof request.system === "string" ? request.system : "";
    expect(system).not.toContain("Harbor Home Goods");
    expect(system).not.toContain("Sample Line");
    const schema = request.output_config?.format?.type === "json_schema" ? request.output_config.format.schema : {};
    const enumKeys = (((schema["properties"] as { elements?: { items?: { properties?: { key?: { enum?: string[] } } } } }).elements
      ?.items?.properties?.key?.enum) ?? []);
    expect(enumKeys).toEqual([...ELEMENT_KEYS]);
  });
});

describe("extract", () => {
  it("validates the eight synthetic fixtures and writes only to the given directory", async () => {
    for (const id of fixtureIds) {
      const truth = fixtureTruthSchema.parse(
        JSON.parse(fs.readFileSync(path.join(fixtureDir, `${id}.json`), "utf8")),
      ) as FixtureTruth;
      const pdf = new Uint8Array(fs.readFileSync(path.join(fixtureDir, `${id}.pdf`)));
      let calls = 0;
      const dir = tempDir();
      try {
        const result = await extract({
          pdf,
          outDir: dir,
          provider: "fake",
          fake: (input) => {
            calls += 1;
            expect(input.model).toBe("claude-sonnet-5-5");
            expect(input.effort).toBe("low");
            expect(input.retry).toBeNull();
            return reply(modelPage(truth, input.pageNumber));
          },
        });
        expect(calls, id).toBe(truth.pages);
        expect(result.pages.every((page) => page.status === "ok"), id).toBe(true);
        const extractions = result.pages.flatMap((page) => (page.status === "ok" ? [page.extraction] : []));
        invoiceExtractionSchema.parse(extractions);
        const usage = JSON.parse(fs.readFileSync(path.join(dir, "usage.json"), "utf8")) as { page: number }[];
        expect(usage).toHaveLength(truth.pages);
        for (const page of result.pages) {
          expect(page.record.model).toBe("claude-sonnet-5-5");
          expect(page.record.effort).toBe("low");
          expect(page.record.prompt_version).toBe("1");
          expect(page.record.schema_version).toBe("1");
          expect(page.record.cost_usd).toBe("0.0077");
          expect(page.record.cost_note).toBeUndefined();
          expect(page.record.inference_geo).toBe("us");
          expect(Number.isInteger(page.record.latency_ms)).toBe(true);
          const pageDir = path.join(dir, "pages", String(page.record.page).padStart(3, "0"));
          expect(fs.existsSync(path.join(pageDir, "attempt-1.txt"))).toBe(true);
          expect(fs.existsSync(path.join(pageDir, "record.json"))).toBe(true);
        }
        if (id === "split_row") {
          const page2 = extractions[1];
          const page3 = extractions[2];
          const head = page2?.charge_lines.find((line) => line.days === "3");
          const tail = page3?.charge_lines[0];
          expect(head?.container).toBe("SLLU0000074");
          expect(head?.amount).toBeUndefined();
          expect(tail?.amount).toBe("300.00");
          expect(tail?.container).toBeUndefined();
        }
        expect(path.relative(repoRoot, dir).startsWith("..")).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("retries a page once and then keeps the failure", async () => {
    const pdf = await blankPdf();
    const bad = reply("{");
    const good = reply(validPage());
    let calls = 0;
    const fake: PageReader = () => {
      calls += 1;
      return calls === 1 ? bad : good;
    };
    const dir = tempDir();
    try {
      const retried = await extract({ pdf, outDir: dir, provider: "fake", model: "claude-opus-5-5", effort: "high", fake });
      expect(calls).toBe(2);
      expect(retried.pages[0]?.status).toBe("ok");
      expect(retried.pages[0]?.record.model).toBe("claude-opus-5-5");
      expect(retried.pages[0]?.record.effort).toBe("high");
      expect(retried.pages[0]?.record.attempts).toBe(2);
      expect(retried.pages[0]?.record.cost_usd).toBeNull();
      expect(retried.pages[0]?.record.cost_note).toBe("No price for claude-opus-5-5.");
      expect(fs.existsSync(path.join(dir, "pages/001/attempt-2.txt"))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    calls = 0;
    const failing: PageReader = () => {
      calls += 1;
      return reply("{");
    };
    const failDir = tempDir();
    try {
      const failed = await extract({ pdf, outDir: failDir, provider: "fake", fake: failing });
      expect(calls).toBe(2);
      expect(failed.pages[0]?.status).toBe("failed");
      expect(failed.pages[0]?.record.reason).toContain("Response is not JSON.");
      expect(failed.pages[0]?.record.prompt_version).toBe("1");
      expect(failed.pages[0]?.record.schema_version).toBe("1");
    } finally {
      fs.rmSync(failDir, { recursive: true, force: true });
    }
  });

  it("does not retry a transport error or a non-US inference geo", async () => {
    const pdf = await blankPdf();
    let calls = 0;
    const dir = tempDir();
    try {
      const thrown = await extract({
        pdf,
        outDir: dir,
        provider: "fake",
        fake: () => {
          calls += 1;
          throw new Error("socket dropped the invoice body");
        },
      });
      expect(calls).toBe(1);
      expect(thrown.pages[0]?.record.reason).toBe("Error");
      expect(thrown.pages[0]?.record.reason).not.toContain("invoice");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    calls = 0;
    const apiDir = tempDir();
    try {
      const api = await extract({
        pdf,
        outDir: apiDir,
        provider: "fake",
        fake: () => {
          calls += 1;
          throw new APIError(
            400,
            { error: { type: "api_error", message: "invoice SYN-1001 leaked" } },
            "invoice SYN-1001 leaked",
            new Headers(),
            "api_error",
          );
        },
      });
      expect(calls).toBe(1);
      expect(api.pages[0]?.record.reason).toBe("api_error 400");
      expect(JSON.stringify(api.pages[0]?.record)).not.toContain("SYN-1001");
    } finally {
      fs.rmSync(apiDir, { recursive: true, force: true });
    }

    calls = 0;
    const limitDir = tempDir();
    try {
      const limited = await extract({
        pdf,
        outDir: limitDir,
        provider: "fake",
        fake: () => {
          calls += 1;
          throw new RateLimitError(
            429,
            { error: { type: "rate_limit_error", message: "slow down SYN-1001" } },
            "slow down SYN-1001",
            new Headers(),
          );
        },
      });
      expect(calls).toBe(1);
      expect(limited.pages[0]?.record.reason).toBe("rate_limit_error 429");
      expect(JSON.stringify(limited.pages[0]?.record)).not.toContain("SYN-1001");
    } finally {
      fs.rmSync(limitDir, { recursive: true, force: true });
    }

    calls = 0;
    const geoDir = tempDir();
    try {
      const geo = await extract({
        pdf,
        outDir: geoDir,
        provider: "fake",
        fake: () => {
          calls += 1;
          return { ...reply(validPage()), inferenceGeo: "global" };
        },
      });
      expect(calls).toBe(1);
      expect(geo.pages[0]?.record.reason).toBe("Inference ran in global.");
    } finally {
      fs.rmSync(geoDir, { recursive: true, force: true });
    }
  });
});

function reply(text: string, usage: Usage = oneCall): ModelResponse {
  return { text, stopReason: "end_turn", usage, inferenceGeo: "us" };
}

function validPage(): string {
  return JSON.stringify({
    invoice_number: "SYN-1",
    billing_party: "",
    billed_party: "",
    currency: "USD",
    elements: [{ key: "bl_number", text: "SYN-BL-1" }],
    charge_lines: [],
  });
}

function modelPage(truth: FixtureTruth, page: number): string {
  const elements = [];
  for (const key of ELEMENT_KEYS) {
    const element = truth.elements[key];
    if (element.state === "present" && element.page === page && element.text !== undefined && element.text !== "") {
      elements.push({ key, text: element.text });
    }
  }
  const charge_lines = [];
  for (const line of truth.charge_lines) {
    if (line.placement.kind === "row" && line.placement.page === page) {
      charge_lines.push(fragments(line, true));
    }
    if (line.placement.kind === "split" && line.placement.head_page === page) {
      charge_lines.push({ ...fragments(line, true), amount: "" });
    }
    if (line.placement.kind === "split" && line.placement.tail_page === page) {
      charge_lines.push({
        container: "",
        charge: "",
        charged_from: "",
        charged_to: "",
        days: "",
        rate: "",
        amount: line.amount,
      });
    }
  }
  const first = page === 1;
  return JSON.stringify({
    invoice_number: first ? truth.invoice_number : "",
    billing_party: first ? truth.billing_party : "",
    billed_party: first ? truth.billed_party : "",
    currency: first ? truth.currency : "",
    elements,
    charge_lines,
  });
}

function fragments(line: FixtureTruth["charge_lines"][number], full: boolean) {
  return {
    container: full ? line.container : "",
    charge: full ? line.charge : "",
    charged_from: full ? line.charged_from : "",
    charged_to: full ? line.charged_to : "",
    days: full ? line.days : "",
    rate: full ? line.rate : "",
    amount: full ? line.amount : "",
  };
}

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage();
  return doc.save();
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dd-extract-"));
}
