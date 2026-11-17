import { PageLimitError, TempDirError } from "dd-extract";
import { describe, expect, it } from "vitest";
import { GroundingError, InferenceGeoError, ModelOutputError, NormalizeError, StitchFailure } from "./errors.js";
import { runOnce } from "./loop.js";
import type { ClaimedRun } from "./queue.js";
import type { ProcessResult } from "./process.js";

function claimedRun(id: string, attempts: number): ClaimedRun {
  return {
    id,
    customerId: "cust",
    documentId: "doc",
    attempts,
    leaseToken: "token",
    storageKey: "documents/cust/file.pdf",
    sha256: "ab".repeat(32),
  };
}

describe("runOnce", () => {
  it("does not log a filename carried by a failed download", async () => {
    const secret = "marked-secret-filename";
    const logs: string[] = [];
    let finished: (ProcessResult & { permanent: boolean }) | undefined;
    const claimed: ClaimedRun = {
      id: "run-1",
      customerId: "cust",
      documentId: "doc",
      attempts: 1,
      leaseToken: "token",
      storageKey: `documents/cust/${secret}.pdf`,
      sha256: "ab".repeat(32),
    };
    const downloadError = new Error(secret);
    downloadError.name = "NoSuchKey";
    Object.assign(downloadError, { $metadata: { httpStatusCode: 404 } });
    const outcome = await runOnce({
      claim: async () => claimed,
      download: async () => Promise.reject(downloadError),
      process: () => Promise.reject(new Error("should not process")),
      finish: async (_claimed, result) => {
        finished = result;
      },
      log: (line) => logs.push(line),
    });
    expect(outcome).toBe("finished");
    expect(logs).toEqual(["run run-1 failed download NoSuchKey 404", "run run-1 retry"]);
    expect(logs.join("\n")).not.toContain(secret);
    expect(logs.join("\n")).not.toContain(claimed.customerId);
    expect(logs.join("\n")).not.toContain(claimed.storageKey);
    expect(logs.join("\n")).not.toContain("stack");
    expect(JSON.stringify(finished)).not.toContain(secret);
    expect(finished?.pages[0]?.reason).toBe("download NoSuchKey 404");
    expect(finished?.permanent).toBe(false);
  });

  it("logs a process failure as the stage, name, and code", async () => {
    const secret = "process-secret-message";
    const logs: string[] = [];
    let finished: (ProcessResult & { permanent: boolean }) | undefined;
    const error = new Error(secret);
    Object.assign(error, { code: "ETIMEDOUT" });
    await runOnce({
      claim: async () => claimedRun("run-process", 1),
      download: async () => new Uint8Array([1]),
      process: () => Promise.reject(error),
      finish: async (_claimed, result) => {
        finished = result;
      },
      log: (line) => logs.push(line),
    });
    expect(logs).toEqual(["run run-process failed process Error ETIMEDOUT", "run run-process retry"]);
    expect(logs.join("\n")).not.toContain(secret);
    expect(finished?.pages[0]?.reason).toBe("process Error ETIMEDOUT");
    expect(finished?.permanent).toBe(false);
  });

  it("logs our own process failures by name and omits the message", async () => {
    const errors = [
      new ModelOutputError(),
      new InferenceGeoError(),
      new GroundingError(),
      new PageLimitError(),
      new TempDirError(),
      new TempDirError("EROFS"),
      new StitchFailure(),
      new NormalizeError(),
    ];
    for (const error of errors) {
      const logs: string[] = [];
      let reason = "";
      await runOnce({
        claim: async () => claimedRun("typed", 1),
        download: async () => new Uint8Array([1]),
        process: () => Promise.reject(error),
        finish: async (_claimed, result) => {
          reason = result.pages[0]?.reason ?? "";
        },
        log: (line) => logs.push(line),
      });
      const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
      const line = `run typed failed process ${error.name}${code}`;
      expect(logs[0]).toBe(line);
      expect(reason).toBe(`process ${error.name}${code}`);
      expect(logs.join("\n")).not.toContain(error.message);
    }
  });

  it("logs a finish failure as the stage, name, and code", async () => {
    const secret = "finish-secret-message";
    const logs: string[] = [];
    const error = new Error(secret);
    error.name = "DatabaseError";
    Object.assign(error, { code: "28P01" });
    await runOnce({
      claim: async () => claimedRun("run-finish", 1),
      download: async () => new Uint8Array([1]),
      process: async () => ({
        finish: "ok",
        modelCalled: false,
        pages: [],
        modelVersion: null,
        promptVersion: null,
        schemaVersion: null,
      }),
      finish: () => Promise.reject(error),
      log: (line) => logs.push(line),
    });
    expect(logs).toEqual(["run run-finish failed finish DatabaseError 28P01"]);
    expect(logs.join("\n")).not.toContain(secret);
  });

  it("finishes a run on the third failure", async () => {
    let permanent = false;
    await runOnce({
      claim: async () => ({
        id: "run-3",
        customerId: "cust",
        documentId: "doc",
        attempts: 3,
        leaseToken: "token",
        storageKey: "documents/cust/file.pdf",
        sha256: "ab".repeat(32),
      }),
      download: async () => Promise.reject(new Error("down")),
      process: () => Promise.reject(new Error("no")),
      finish: async (_claimed, result) => {
        permanent = result.permanent;
      },
      log: () => undefined,
    });
    expect(permanent).toBe(true);
  });

  it("prefixes a document line with the processing run id", async () => {
    const logs: string[] = [];
    await runOnce({
      claim: async () => ({
        id: "run-9",
        customerId: "cust",
        documentId: "doc",
        attempts: 1,
        leaseToken: "token",
        storageKey: "documents/cust/file.pdf",
        sha256: "ab".repeat(32),
      }),
      download: async () => new Uint8Array([1]),
      process: async (_pdf, _hash, log) => {
        log("document read");
        return {
          finish: "ok",
          modelCalled: false,
          pages: [],
          modelVersion: null,
          promptVersion: null,
          schemaVersion: null,
        };
      },
      finish: async () => undefined,
      log: (line) => logs.push(line),
    });
    expect(logs).toEqual(["run run-9 document read", "run run-9 finished"]);
  });
});
