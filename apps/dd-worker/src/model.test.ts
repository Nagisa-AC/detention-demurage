import fs from "node:fs";
import path from "node:path";
import type { ExtractedPage } from "dd-extract";
import { describe, expect, it } from "vitest";
import { readModelPages } from "./model.js";

describe("readModelPages", () => {
  it("removes the attempt file when the call finishes", async () => {
    const secret = "marked-secret-value";
    let dir = "";
    const result = await readModelPages(new Uint8Array([1]), [2], async (_pdf, pages, outDir) => {
      dir = outDir;
      fs.writeFileSync(path.join(outDir, "attempt-1.txt"), secret);
      expect(pages).toEqual([2]);
      const page = {
        status: "failed",
        record: {
          page: 2,
          status: "failed",
          model: "fake",
          effort: "low",
          prompt_version: "1",
          schema_version: "1",
          latency_ms: 1,
          usage: { input_tokens: 0, output_tokens: 0, cache_5m_tokens: 0, cache_1h_tokens: 0, cache_read_tokens: 0 },
          cost_usd: null,
          inference_geo: "us",
          attempts: 1,
          reason: "The page did not match the schema.",
        },
      } as ExtractedPage;
      return { pages: [page] };
    });
    expect(dir).not.toBe("");
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(path.join(dir, "attempt-1.txt"))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result[0]?.reason).toBe("The page did not match the schema.");
  });
});
