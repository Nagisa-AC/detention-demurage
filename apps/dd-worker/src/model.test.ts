import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtractedPage } from "dd-extract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readModelPages } from "./model.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readModelPages", () => {
  it("removes the attempt directory under the temp dir when a transport failure returns", async () => {
    const secret = "marked-secret-value";
    let dir = "";
    const result = await readModelPages(new Uint8Array([1]), [2], async (_pdf, pages, outDir) => {
      dir = outDir;
      fs.writeFileSync(path.join(outDir, "attempt-1.txt"), secret);
      expect(pages).toEqual([2]);
      return { pages: [failedPage("api_error 400", "us")] };
    });
    expect(dir.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(path.join(dir, "attempt-1.txt"))).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result[0]?.reason).toBe("api_error 400");
  });

  it("throws ModelOutputError without the model text and still removes the directory", async () => {
    const secret = "marked-secret-value";
    let dir = "";
    const run = readModelPages(new Uint8Array([1]), [1], async (_pdf, _pages, outDir) => {
      dir = outDir;
      fs.writeFileSync(path.join(outDir, "attempt-1.txt"), secret);
      return { pages: [failedPage(`Response is not JSON. ${secret}`, "us")] };
    });
    const error = await rejection(run);
    expect(error).toMatchObject({ name: "ModelOutputError", message: "The model output is invalid." });
    expect(error.stack ?? "").not.toContain(secret);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("throws InferenceGeoError when inference did not stay in the US", async () => {
    const error = await rejection(
      readModelPages(new Uint8Array([1]), [1], async () => ({
        pages: [failedPage("Inference ran in global.", "global")],
      })),
    );
    expect(error).toMatchObject({ name: "InferenceGeoError", message: "Inference ran outside the US." });
    expect(error.stack ?? "").not.toContain("global");
  });

  it("names a temp directory that cannot be created", async () => {
    vi.spyOn(fs, "mkdtempSync").mockImplementation(() => {
      const error = new Error("read-only /opt/dd-worker");
      Object.assign(error, { code: "EROFS" });
      throw error;
    });
    const error = await rejection(readModelPages(new Uint8Array([1]), [1], async () => ({ pages: [] })));
    expect(error).toMatchObject({
      name: "TempDirError",
      code: "EROFS",
      message: "The temporary directory could not be used.",
    });
    expect(error.stack ?? "").not.toContain("/opt/dd-worker");
  });
});

async function rejection(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("The call did not fail.");
}

function failedPage(reason: string, geo: string): ExtractedPage {
  return {
    status: "failed",
    record: {
      page: 1,
      status: "failed",
      model: "fake",
      effort: "low",
      prompt_version: "1",
      schema_version: "1",
      latency_ms: 1,
      usage: { input_tokens: 0, output_tokens: 0, cache_5m_tokens: 0, cache_1h_tokens: 0, cache_read_tokens: 0 },
      cost_usd: null,
      inference_geo: geo,
      attempts: 1,
      reason,
    },
  };
}
