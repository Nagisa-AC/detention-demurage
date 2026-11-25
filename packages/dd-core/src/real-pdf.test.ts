import { describe, expect, it } from "vitest";
import {
  REAL_PDF_MAX_BYTES,
  REAL_PDF_PAGE_CEILING,
  realPdfLimits,
  realPdfMessage,
  refusalForRealPdf,
  trailerEncrypts,
} from "./real-pdf.js";

describe("real PDF limits", () => {
  it("defaults to 25 MB and the extraction page ceiling", () => {
    expect(realPdfLimits({})).toEqual({ maxBytes: REAL_PDF_MAX_BYTES, maxPages: REAL_PDF_PAGE_CEILING });
    expect(REAL_PDF_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(realPdfLimits({ DD_REAL_PDF_MAX_BYTES: "1048576" }).maxBytes).toBe(1024 * 1024);
    expect(realPdfLimits({ DD_REAL_PDF_MAX_PAGES: "10" }).maxPages).toBe(10);
    expect(realPdfLimits({ DD_REAL_PDF_MAX_PAGES: "50" }).maxPages).toBe(REAL_PDF_PAGE_CEILING);
    expect(realPdfLimits({ DD_REAL_PDF_MAX_PAGES: "nope" }).maxPages).toBe(REAL_PDF_PAGE_CEILING);
  });

  it("names each real-file refusal", () => {
    const limits = { maxBytes: 100, maxPages: 2 };
    expect(refusalForRealPdf({ byteSize: 101, read: { kind: "ok", pages: 1 }, limits })).toBe("too_large");
    expect(refusalForRealPdf({ byteSize: 100, read: { kind: "ok", pages: 3 }, limits })).toBe("too_many_pages");
    expect(refusalForRealPdf({ byteSize: 100, read: { kind: "encrypted" }, limits })).toBe("encrypted");
    expect(refusalForRealPdf({ byteSize: 100, read: { kind: "malformed" }, limits })).toBe("malformed");
    expect(refusalForRealPdf({ byteSize: 100, read: { kind: "ok", pages: 0 }, limits })).toBe("malformed");
    expect(refusalForRealPdf({ byteSize: 100, read: { kind: "ok", pages: 2 }, limits })).toBeNull();
    expect(realPdfMessage("too_large", { maxBytes: REAL_PDF_MAX_BYTES, maxPages: 30 })).toBe("This PDF is over 25 MB.");
    expect(realPdfMessage("too_many_pages", { maxBytes: REAL_PDF_MAX_BYTES, maxPages: 30 })).toBe(
      "This PDF has more than 30 pages.",
    );
    expect(realPdfMessage("encrypted", limits)).toBe("This PDF is encrypted or password-protected.");
    expect(realPdfMessage("malformed", limits)).toBe("This PDF could not be read.");
  });

  it("sees an encryption dictionary in the trailer", () => {
    const encrypted = new TextEncoder().encode("%PDF-1.4\ntrailer<</Encrypt 3 0 R>>\n%%EOF");
    const plain = new TextEncoder().encode("%PDF-1.4\ntrailer<</Size 1>>\n%%EOF");
    expect(trailerEncrypts(encrypted)).toBe(true);
    expect(trailerEncrypts(plain)).toBe(false);
  });
});
