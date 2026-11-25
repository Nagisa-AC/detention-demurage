import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inspectPdf } from "./pdf-file";

const cleanPdf = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/synthetic/clean.pdf");

describe("inspectPdf", () => {
  it("counts pages of a sample and refuses encrypted or unreadable bytes", async () => {
    const pdf = new Uint8Array(fs.readFileSync(cleanPdf));
    const read = await inspectPdf(pdf);
    expect(read.kind).toBe("ok");
    if (read.kind === "ok") expect(read.pages).toBeGreaterThan(0);
    const encrypted = new TextEncoder().encode("%PDF-1.4\ntrailer<</Encrypt 3 0 R>>\n%%EOF");
    expect(await inspectPdf(encrypted)).toEqual({ kind: "encrypted" });
    expect(await inspectPdf(new Uint8Array([1, 2, 3, 4]))).toEqual({ kind: "malformed" });
  });
});
