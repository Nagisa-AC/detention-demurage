/** A document above this count is refused before any model call. */
export const MAX_PAGES = 30;

export class PageLimitError extends Error {
  constructor() {
    super("The document has too many pages.");
    this.name = "PageLimitError";
  }
}

export class TempDirError extends Error {
  readonly code?: string;
  constructor(code?: string) {
    super("The temporary directory could not be used.");
    this.name = "TempDirError";
    if (code !== undefined) this.code = code;
  }
}

/** The filesystem code is kept when it is a short token. The original message is not. */
export function tempDirError(error: unknown): TempDirError {
  if (typeof error !== "object" || error === null || !("code" in error)) return new TempDirError();
  const code = (error as { code: unknown }).code;
  if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code)) return new TempDirError(code);
  return new TempDirError();
}
