import { REAL_PDF_PAGE_CEILING } from "dd-core";
import { MAX_PAGES } from "dd-extract";
import { describe, expect, it } from "vitest";

describe("real PDF page ceiling", () => {
  it("matches the extraction page limit", () => {
    expect(REAL_PDF_PAGE_CEILING).toBe(MAX_PAGES);
    expect(REAL_PDF_PAGE_CEILING).toBe(30);
  });
});
