import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SYNTHETIC_DOCUMENTS } from "../../../../fixtures/synthetic/hashes";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/synthetic");

describe("synthetic allow list", () => {
  it("is the hash of each committed PDF", () => {
    const pdfs = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".pdf"))
      .map((name) => name.slice(0, -".pdf".length))
      .sort();
    expect(SYNTHETIC_DOCUMENTS.map((document) => document.id).sort()).toEqual(pdfs);
    for (const document of SYNTHETIC_DOCUMENTS) {
      const bytes = fs.readFileSync(path.join(dir, `${document.id}.pdf`));
      expect(createHash("sha256").update(bytes).digest("hex"), document.id).toBe(document.sha256);
    }
  });
});
