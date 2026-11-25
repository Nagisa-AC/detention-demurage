import { describe, expect, it } from "vitest";
import { diagnoseRun } from "./diagnose.js";
import { ModelOutputError } from "./errors.js";
import { sha256Hex, type ProcessResult } from "./process.js";

const runId = "1d40be78-2a12-46e9-8848-ec420a49e446";

describe("diagnoseRun", () => {
  it("refuses a hash outside the synthetic allowlist before download", async () => {
    const lines: string[] = [];
    let downloaded = false;
    const code = await diagnoseRun({
      runId,
      allow: new Set(),
      load: async () => ({ storageKey: "documents/cust/secret-file.pdf", sha256: "ab".repeat(32) }),
      download: async () => {
        downloaded = true;
        return new Uint8Array();
      },
      process: () => Promise.reject(new Error("should not process")),
      write: (line) => lines.push(line),
    });
    expect(code).toBe(1);
    expect(downloaded).toBe(false);
    expect(lines).toEqual(["refused not_synthetic"]);
    expect(lines.join("\n")).not.toContain("secret-file");
    expect(lines.join("\n")).not.toContain("cust");
  });

  it("downloads a real PDF when the customer accepts real documents", async () => {
    const pdf = new Uint8Array([1, 2, 3]);
    const lines: string[] = [];
    let downloaded = false;
    const code = await diagnoseRun({
      runId,
      allow: new Set(),
      acceptsReal: async () => true,
      load: async () => ({ storageKey: "documents/cust/file.pdf", sha256: sha256Hex(pdf), customerId: "cust" }),
      download: async () => {
        downloaded = true;
        return pdf;
      },
      process: async () => okResult(),
      write: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    expect(downloaded).toBe(true);
    expect(lines).toEqual(["diagnose ok"]);
  });

  it("refuses bytes that do not match the declared synthetic hash", async () => {
    const pdf = new Uint8Array([1, 2, 3]);
    const lines: string[] = [];
    let processed = false;
    const code = await diagnoseRun({
      runId,
      allow: new Set([sha256Hex(pdf)]),
      load: async () => ({ storageKey: "documents/cust/file.pdf", sha256: sha256Hex(pdf) }),
      download: async () => new Uint8Array([9]),
      process: async () => {
        processed = true;
        return okResult();
      },
      write: (line) => lines.push(line),
    });
    expect(code).toBe(1);
    expect(processed).toBe(false);
    expect(lines).toEqual(["refused checksum"]);
  });

  it("prints the error message and stack and redacts secrets", async () => {
    const secret = "sk-ant-diagnose-secret";
    const pdf = new Uint8Array([4, 5, 6]);
    const lines: string[] = [];
    const code = await diagnoseRun({
      runId,
      allow: new Set([sha256Hex(pdf)]),
      secrets: [secret, "postgres://dd_app:secret@db/neondb"],
      load: async () => ({ storageKey: "documents/cust/file.pdf", sha256: sha256Hex(pdf) }),
      download: async () => pdf,
      process: () => Promise.reject(new ModelOutputError()),
      write: (line) => lines.push(line),
    });
    expect(code).toBe(1);
    const text = lines.join("\n");
    expect(text).toContain("ModelOutputError");
    expect(text).toContain("The model output is invalid.");
    expect(text).toContain("diagnose.test.ts");
    expect(text).not.toContain(secret);
  });

  it("redacts a secret that the thrown message carries", async () => {
    const secret = "postgres://dd_app:secret@db/neondb";
    const pdf = new Uint8Array([7]);
    const lines: string[] = [];
    const failure = new Error(`connect ${secret}`);
    await diagnoseRun({
      runId,
      allow: new Set([sha256Hex(pdf)]),
      secrets: [secret],
      load: async () => ({ storageKey: "k", sha256: sha256Hex(pdf) }),
      download: async () => pdf,
      process: () => Promise.reject(failure),
      write: (line) => lines.push(line),
    });
    const text = lines.join("\n");
    expect(text).toContain("connect [redacted]");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("dd_app:secret");
  });

  it("prints diagnose ok and no page text when processing succeeds", async () => {
    const pdf = new Uint8Array([8]);
    const lines: string[] = [];
    const code = await diagnoseRun({
      runId,
      allow: new Set([sha256Hex(pdf)]),
      load: async () => ({ storageKey: "k", sha256: sha256Hex(pdf) }),
      download: async () => pdf,
      process: async () => okResult(),
      write: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    expect(lines).toEqual(["diagnose ok"]);
  });

  it("rejects an id that is not a UUID", async () => {
    const lines: string[] = [];
    let loaded = false;
    const code = await diagnoseRun({
      runId: "not-a-run",
      allow: new Set(),
      load: async () => {
        loaded = true;
        return null;
      },
      download: async () => new Uint8Array(),
      process: async () => okResult(),
      write: (line) => lines.push(line),
    });
    expect(code).toBe(1);
    expect(loaded).toBe(false);
    expect(lines).toEqual(["Run id must be a UUID."]);
  });
});

function okResult(): ProcessResult {
  return { finish: "ok", modelCalled: false, pages: [], modelVersion: null, promptVersion: null, schemaVersion: null };
}
