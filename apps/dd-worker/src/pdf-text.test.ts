import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitPdf } from "dd-extract";
import { describe, expect, it } from "vitest";
import { inspectPdf, readPdfPages } from "./pdf-text.js";

const cleanPdf = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/synthetic/clean.pdf");

describe("readPdfPages", () => {
  it("leaves the caller's bytes intact so pdf-lib can load them", async () => {
    const pdf = new Uint8Array(fs.readFileSync(cleanPdf));
    const length = pdf.byteLength;
    const header = Buffer.from(pdf.subarray(0, 8)).toString("latin1");
    const pages = await readPdfPages(pdf);
    expect(pages.length).toBeGreaterThan(0);
    expect(pdf.byteLength).toBe(length);
    expect(Buffer.from(pdf.subarray(0, 8)).toString("latin1")).toBe(header);
    const split = await splitPdf(pdf);
    expect(split.length).toBe(pages.length);
    expect(await inspectPdf(pdf)).toEqual({ kind: "ok", pages: pages.length });
  });

  it("names an encrypted trailer and a file that is not a PDF", async () => {
    const encrypted = new TextEncoder().encode("%PDF-1.4\ntrailer<</Encrypt 3 0 R>>\n%%EOF");
    expect(await inspectPdf(encrypted)).toEqual({ kind: "encrypted" });
    expect(await inspectPdf(new Uint8Array([1, 2, 3, 4]))).toEqual({ kind: "malformed" });
  });
});
