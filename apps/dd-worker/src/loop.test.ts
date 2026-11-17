import { describe, expect, it } from "vitest";
import { runOnce } from "./loop.js";
import type { ClaimedRun } from "./queue.js";
import type { ProcessResult } from "./process.js";

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
    const outcome = await runOnce({
      claim: async () => claimed,
      download: async () => Promise.reject(new Error(secret)),
      process: () => Promise.reject(new Error("should not process")),
      finish: async (_claimed, result) => {
        finished = result;
      },
      log: (line) => logs.push(line),
    });
    expect(outcome).toBe("finished");
    expect(logs).toEqual(["run run-1 failed", "run run-1 retry"]);
    expect(logs.join("\n")).not.toContain(secret);
    expect(logs.join("\n")).not.toContain(claimed.customerId);
    expect(logs.join("\n")).not.toContain(claimed.storageKey);
    expect(JSON.stringify(finished)).not.toContain(secret);
    expect(finished?.pages[0]?.reason).toBe("worker_error");
    expect(finished?.permanent).toBe(false);
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
