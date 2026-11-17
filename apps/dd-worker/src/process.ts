import { createHash } from "node:crypto";
import { ELEMENT_KEYS, ELEMENTS, StitchError, type ElementKey, type PageExtraction } from "dd-core";
import { MAX_PAGES, PageLimitError } from "dd-extract";
import { GroundingError, StitchFailure } from "./errors.js";
import { foldText, groundValue } from "./ground.js";
import { MOVEMENT, assembleRead, type SavedRead } from "./read.js";

export type GroundPage = {
  page: number;
  status: "ok" | "failed";
  attempts: number;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  reason?: string;
  values: readonly { field: string; text: string }[];
  extraction?: PageExtraction;
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
  read?: SavedRead;
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
  if (texts.length > MAX_PAGES) throw new PageLimitError();
  const withText: number[] = [];
  const stored: StoredPage[] = [];
  texts.forEach((text, index) => {
    if (foldText(text).length === 0) {
      stored.push({
        page: index + 1,
        status: "no_text_layer",
        reason: "The page has no text layer.",
        ungrounded: [],
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
    const pageText = texts[page.page - 1];
    if (pageText === undefined) throw new GroundingError();
    try {
      stored.push(storePage(page, pageText));
    } catch (error) {
      if (error instanceof GroundingError) throw error;
      throw new GroundingError(error);
    }
  }
  stored.sort((left, right) => left.page - right.page);
  const failed = stored.some((page) => page.status === "failed");
  const version = extracted.find((page) => page.status === "ok") ?? extracted[0];
  const result: ProcessResult = {
    finish: failed ? "failed" : "ok",
    modelCalled: true,
    pages: stored,
    modelVersion: version?.model ?? null,
    promptVersion: version?.promptVersion ?? null,
    schemaVersion: version?.schemaVersion ?? null,
  };
  if (failed) return result;
  const extractions = extractionsOf(extracted);
  if (extractions === null) return result;
  try {
    result.read = assembleRead(extractions, texts);
  } catch (error) {
    if (error instanceof StitchError) throw new StitchFailure();
    throw error;
  }
  return result;
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
      ungrounded: missed(page, pageText),
    };
    return failed;
  }
  const stored: StoredPage = {
    page: page.page,
    status: "ok",
    attempts: page.attempts,
    model: page.model,
    prompt_version: page.promptVersion,
    schema_version: page.schemaVersion,
    ungrounded: missed(page, pageText),
  };
  return stored;
}

function extractionsOf(pages: readonly GroundPage[]): PageExtraction[] | null {
  const ok = pages.filter((page) => page.status === "ok");
  if (ok.length === 0) return null;
  const extractions: PageExtraction[] = [];
  for (const page of ok) {
    if (page.extraction === undefined) return null;
    extractions.push(page.extraction);
  }
  return extractions;
}

/**
 * Ungrounded means the model returned a value this page does not contain.
 * A value the model never returned is suggested_absent. An export-only element is not applicable.
 */
function missed(page: GroundPage, pageText: string): string[] {
  const ungrounded = new Set<string>();
  for (const value of page.values) {
    if (!countsAsUngrounded(value.field)) continue;
    if (groundValue(pageText, value.text) === "miss") ungrounded.add(value.field);
  }
  return [...ungrounded].sort();
}

function countsAsUngrounded(field: string): boolean {
  if (!isElementKey(field)) return true;
  const applicability = ELEMENTS[field].applicability;
  return applicability === "both" || applicability === MOVEMENT;
}

function isElementKey(field: string): field is ElementKey {
  return (ELEMENT_KEYS as readonly string[]).includes(field);
}

function safeReason(reason: string | undefined): string {
  if (reason === undefined || reason.includes("{") || reason.length > 180) return "The page did not match the schema.";
  return reason;
}
