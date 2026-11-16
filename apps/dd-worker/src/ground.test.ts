import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SYNTHETIC_DOCUMENTS } from "../../../fixtures/synthetic/hashes.js";
import { groundValue } from "./ground.js";
import { readPdfPages } from "./pdf-text.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("grounding", () => {
  it("finds a value only in the page it was given", () => {
    expect(groundValue("Invoice SYN-1001", "SYN-1001")).toBe("verbatim");
    expect(groundValue("INV 100", "INV100")).toBe("verbatim");
    expect(groundValue("March 2, 2026", "2026-03-02")).toBe("normalized");
    expect(groundValue("other page", "SYN-1001")).toBe("miss");
    expect(groundValue("", "SYN-1001")).toBe("miss");
  });

  it("matches the 274 synthetic values on their own page, 21 of them three characters or fewer", async () => {
    let passed = 0;
    let short = 0;
    const failures: string[] = [];
    for (const document of SYNTHETIC_DOCUMENTS) {
      const pdf = new Uint8Array(fs.readFileSync(path.join(repoRoot, "fixtures/synthetic", `${document.id}.pdf`)));
      const pages = await readPdfPages(pdf);
      const pageDir = path.join(repoRoot, "evals/synthetic", document.id, "pages");
      for (const dir of fs.readdirSync(pageDir).sort()) {
        const extractionPath = path.join(pageDir, dir, "extraction.json");
        if (!fs.existsSync(extractionPath)) continue;
        const pageNumber = Number(dir);
        const text = pages[pageNumber - 1] ?? "";
        const body = JSON.parse(fs.readFileSync(extractionPath, "utf8")) as Record<string, unknown>;
        for (const value of valuesOf(body)) {
          const hit = groundValue(text, value.text);
          if (hit === "miss") {
            failures.push(`${document.id} page ${pageNumber} ${value.field}`);
            continue;
          }
          passed += 1;
          if (value.text.length <= 3) short += 1;
        }
      }
    }
    expect(failures).toEqual([]);
    expect(passed).toBe(274);
    expect(short).toBe(21);
  });
});

function valuesOf(body: Record<string, unknown>): { field: string; text: string }[] {
  const found: { field: string; text: string }[] = [];
  for (const field of ["invoice_number", "billing_party", "billed_party", "currency"]) {
    const text = body[field];
    if (typeof text === "string" && text.length > 0) found.push({ field, text });
  }
  const elements = body.elements;
  if (elements !== null && typeof elements === "object") {
    for (const [key, element] of Object.entries(elements as Record<string, { text?: string }>)) {
      if (typeof element?.text === "string" && element.text.length > 0) found.push({ field: key, text: element.text });
    }
  }
  const lines = body.charge_lines;
  if (Array.isArray(lines)) {
    lines.forEach((line, index) => {
      if (line === null || typeof line !== "object") return;
      for (const field of ["container", "charge", "charged_from", "charged_to", "days", "rate", "amount"]) {
        const text = (line as Record<string, unknown>)[field];
        if (typeof text === "string" && text.length > 0) found.push({ field: `line${index + 1}.${field}`, text });
      }
    });
  }
  return found;
}
