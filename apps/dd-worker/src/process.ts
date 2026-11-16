import { createHash } from "node:crypto";
import { ELEMENT_KEYS } from "dd-core";
import { foldText, groundValue } from "./ground.js";

const HEADERS = ["invoice_number", "billing_party", "billed_party", "currency"] as const;

export type GroundPage = {
  page: number;
  status: "ok" | "failed";
  attempts: number;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  reason?: string;
  values: readonly { field: string; text: string }[];
};

export type StoredPage = {
  page: number;
  status: "ok" | "failed" | "no_text_layer";
  reason?: string;
  attempts?: number;
  model?: string;
  prompt_version?: string;
  schema_version?: string;
  ungrounded: string[];
};

export type ProcessResult = {
  finish: "ok" | "failed";
  modelCalled: boolean;
  pages: StoredPage[];
  modelVersion: string | null;
  promptVersion: string | null;
  schemaVersion: string | null;
};

export async function processDocument(input: {
  pdf: Uint8Array;
  declaredHash: string;
  allow: ReadonlySet<string>;
  readPages: (pdf: Uint8Array) => Promise<readonly string[]>;
  extract: (pdf: Uint8Array, pages: readonly number[]) => Promise<readonly GroundPage[]>;
  log?: (line: string) => void;
}): Promise<ProcessResult> {
  const actual = sha256Hex(input.pdf);
  if (actual !== input.declaredHash) return skipped("checksum", input.log);
  if (!input.allow.has(actual)) return skipped("not_synthetic", input.log);

  const texts = await input.readPages(input.pdf);
  const withText: number[] = [];
  const stored: StoredPage[] = [];
  texts.forEach((text, index) => {
    if (foldText(text).length === 0) {
      stored.push({
        page: index + 1,
        status: "no_text_layer",
        reason: "The page has no text layer.",
        ungrounded: [...ELEMENT_KEYS].sort(),
      });
    } else {
      withText.push(index + 1);
    }
  });
  if (withText.length === 0) {
    input.log?.("document no-text");
    return done("ok", false, stored);
  }

  const extracted = await input.extract(input.pdf, withText);
  input.log?.("document read");
  for (const page of extracted) {
    const pageText = texts[page.page - 1] ?? "";
    stored.push(storePage(page, pageText));
  }
  stored.sort((left, right) => left.page - right.page);
  const failed = stored.some((page) => page.status === "failed");
  const version = extracted.find((page) => page.status === "ok") ?? extracted[0];
  return {
    finish: failed ? "failed" : "ok",
    modelCalled: true,
    pages: stored,
    modelVersion: version?.model ?? null,
    promptVersion: version?.promptVersion ?? null,
    schemaVersion: version?.schemaVersion ?? null,
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function skipped(reason: "checksum" | "not_synthetic", log?: (line: string) => void): ProcessResult {
  log?.(`document ${reason}`);
  return {
    finish: "failed",
    modelCalled: false,
    pages: [{ page: 1, status: "failed", reason, ungrounded: [] }],
    modelVersion: null,
    promptVersion: null,
    schemaVersion: null,
  };
}

function done(finish: "ok" | "failed", modelCalled: boolean, pages: StoredPage[]): ProcessResult {
  return { finish, modelCalled, pages, modelVersion: null, promptVersion: null, schemaVersion: null };
}

function storePage(page: GroundPage, pageText: string): StoredPage {
  if (page.status === "failed") {
    const failed: StoredPage = {
      page: page.page,
      status: "failed",
      reason: safeReason(page.reason),
      attempts: page.attempts,
      model: page.model,
      prompt_version: page.promptVersion,
      schema_version: page.schemaVersion,
      ungrounded: [...ELEMENT_KEYS].sort(),
    };
    return failed;
  }
  const ungrounded = new Set<string>();
  const grounded = new Set<string>();
  for (const value of page.values) {
    if (groundValue(pageText, value.text) === "miss") ungrounded.add(value.field);
    else grounded.add(value.field);
  }
  for (const key of ELEMENT_KEYS) {
    if (!grounded.has(key)) ungrounded.add(key);
  }
  for (const header of HEADERS) {
    if (!grounded.has(header)) ungrounded.add(header);
  }
  const stored: StoredPage = {
    page: page.page,
    status: "ok",
    attempts: page.attempts,
    model: page.model,
    prompt_version: page.promptVersion,
    schema_version: page.schemaVersion,
    ungrounded: [...ungrounded].sort(),
  };
  return stored;
}

function safeReason(reason: string | undefined): string {
  if (reason === undefined || reason.includes("{") || reason.length > 180) return "The page did not match the schema.";
  return reason;
}
