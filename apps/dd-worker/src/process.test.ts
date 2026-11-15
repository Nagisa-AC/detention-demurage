import { ELEMENT_KEYS } from "dd-core";
import { describe, expect, it } from "vitest";
import { processDocument, sha256Hex, type GroundPage } from "./process.js";

const SECRET = "marked-secret-value";

describe("processDocument", () => {
  it("does not call the model when the hash is outside the eight or the bytes differ", async () => {
    const pdf = new Uint8Array([1, 2, 3, 4]);
    const hash = sha256Hex(pdf);
    const extract = (): Promise<GroundPage[]> => Promise.reject(new Error("model called"));
    const outside = await processDocument({
      pdf,
      declaredHash: hash,
      allow: new Set(),
      readPages: async () => ["text"],
      extract,
    });
    expect(outside.modelCalled).toBe(false);
    expect(outside.pages[0]?.reason).toBe("not_synthetic");
    const mismatch = await processDocument({
      pdf,
      declaredHash: "ab".repeat(32),
      allow: new Set([hash]),
      readPages: async () => ["text"],
      extract,
    });
    expect(mismatch.modelCalled).toBe(false);
    expect(mismatch.pages[0]?.reason).toBe("checksum");
  });

  it("marks every element unreadable and skips the model when the text layer is empty", async () => {
    const pdf = new Uint8Array([9]);
    const hash = sha256Hex(pdf);
    const result = await processDocument({
      pdf,
      declaredHash: hash,
      allow: new Set([hash]),
      readPages: async () => ["", "   "],
      extract: () => Promise.reject(new Error("model called")),
    });
    expect(result.modelCalled).toBe(false);
    expect(result.finish).toBe("ok");
    expect(result.pages.map((page) => page.status)).toEqual(["no_text_layer", "no_text_layer"]);
    for (const page of result.pages) expect(page.ungrounded).toEqual([...ELEMENT_KEYS].sort());
  });

  it("keeps a verbatim value, a normalized date, and a miss, on that page only", async () => {
    const pdf = new Uint8Array([7, 7]);
    const hash = sha256Hex(pdf);
    const logs: string[] = [];
    let requested: readonly number[] = [];
    const result = await processDocument({
      pdf,
      declaredHash: hash,
      allow: new Set([hash]),
      readPages: async () => ["Invoice SYN-1001 March 2, 2026", ""],
      extract: async (_pdf, pages) => {
        requested = pages;
        const page: GroundPage = {
          page: 1,
          status: "ok",
          attempts: 1,
          model: "fake",
          promptVersion: "1",
          schemaVersion: "1",
          values: [
            { field: "invoice_number", text: "SYN-1001" },
            { field: "invoice_date", text: "2026-03-02" },
            { field: "bl_number", text: SECRET },
            { field: "port_of_discharge", text: "second page only" },
          ],
        };
        return [page];
      },
      log: (line) => logs.push(line),
    });
    expect(requested).toEqual([1]);
    const stored = result.pages.find((page) => page.page === 1);
    expect(stored?.ungrounded).not.toContain("invoice_number");
    expect(stored?.ungrounded).not.toContain("invoice_date");
    expect(stored?.ungrounded).toContain("bl_number");
    expect(stored?.ungrounded).toContain("port_of_discharge");
    const body = JSON.stringify(result);
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain("SYN-1001");
    expect(logs.join("\n")).not.toContain(SECRET);
  });

  it("does not treat a value on another page as found", async () => {
    const pdf = new Uint8Array([3]);
    const hash = sha256Hex(pdf);
    const result = await processDocument({
      pdf,
      declaredHash: hash,
      allow: new Set([hash]),
      readPages: async () => ["ONLYONPAGEONE", "nothing else"],
      extract: async () => [
        {
          page: 2,
          status: "ok",
          attempts: 1,
          model: "fake",
          promptVersion: "1",
          schemaVersion: "1",
          values: [{ field: "invoice_number", text: "ONLYONPAGEONE" }],
        },
      ],
    });
    const page = result.pages.find((item) => item.page === 2);
    expect(page?.ungrounded).toContain("invoice_number");
    expect(JSON.stringify(result)).not.toContain("ONLYONPAGEONE");
  });
});
