/** Real customer PDFs may be larger than the 20 MiB sample upload cap. */
export const REAL_PDF_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Staff can set a page limit. Extraction refuses more than 30 pages, so the
 * limit that uploads and the worker actually use never rises above that.
 */
export const REAL_PDF_MAX_PAGES = 50;
export const REAL_PDF_PAGE_CEILING = 30;

export const REAL_PDF_REASONS = ["too_large", "too_many_pages", "encrypted", "malformed"] as const;
export type RealPdfReason = (typeof REAL_PDF_REASONS)[number];

export type PdfRead = { kind: "ok"; pages: number } | { kind: "encrypted" } | { kind: "malformed" };

export type RealPdfLimits = { maxBytes: number; maxPages: number };

type Env = Record<string, string | undefined>;

/** Bytes and pages actually enforced. A page setting above the extraction ceiling is lowered to it. */
export function realPdfLimits(env: Env = process.env): RealPdfLimits {
  return {
    maxBytes: boundedInt(env.DD_REAL_PDF_MAX_BYTES, REAL_PDF_MAX_BYTES, 1, 100 * 1024 * 1024),
    maxPages: boundedInt(env.DD_REAL_PDF_MAX_PAGES, REAL_PDF_MAX_PAGES, 1, REAL_PDF_PAGE_CEILING),
  };
}

/** Why a real PDF is refused, or null when it may be stored and read. */
export function refusalForRealPdf(input: { byteSize: number; read: PdfRead; limits: RealPdfLimits }): RealPdfReason | null {
  if (input.byteSize > input.limits.maxBytes) return "too_large";
  if (input.read.kind === "encrypted") return "encrypted";
  if (input.read.kind === "malformed") return "malformed";
  if (input.read.pages < 1) return "malformed";
  if (input.read.pages > input.limits.maxPages) return "too_many_pages";
  return null;
}

export function realPdfMessage(reason: RealPdfReason, limits: RealPdfLimits): string {
  if (reason === "too_large") return `This PDF is over ${megabytes(limits.maxBytes)} MB.`;
  if (reason === "too_many_pages") return `This PDF has more than ${limits.maxPages} pages.`;
  if (reason === "encrypted") return "This PDF is encrypted or password-protected.";
  return "This PDF could not be read.";
}

/** PasswordException from the PDF reader, or anything else the reader could not open. */
export function pdfReadFailure(error: unknown): "encrypted" | "malformed" {
  return error instanceof Error && error.name === "PasswordException" ? "encrypted" : "malformed";
}

/** True when the PDF trailer points at an encryption dictionary. */
export function trailerEncrypts(bytes: Uint8Array): boolean {
  const text = Buffer.from(bytes).toString("latin1");
  const at = text.lastIndexOf("trailer");
  if (at < 0) return false;
  return /\/Encrypt\b/.test(text.slice(at, at + 4096));
}

function megabytes(bytes: number): string {
  const value = bytes / (1024 * 1024);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return Math.min(max, Math.max(min, fallback));
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return Math.min(max, Math.max(min, fallback));
  return Math.min(max, Math.max(min, parsed));
}
