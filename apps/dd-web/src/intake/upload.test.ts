import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as confirmPost } from "../app/api/uploads/confirm/route";
import { confirmRouteRan, resetConfirmRoute } from "../app/api/uploads/confirm/work";
import { POST as uploadPost } from "../app/api/uploads/route";
import { resetUploadRoute, uploadRouteRan } from "../app/api/uploads/work";
import { setLog } from "../log";
import { encodeSession, setCookieReader } from "../session";
import { uploadConfig } from "./aws";
import { readUploadFields } from "./body";
import { confirmUpload } from "./confirm";
import { issueUpload } from "./issue";
import { checksumBase64, documentKey, EXPIRES_MESSAGE, incomingKey, MAX_PDF_BYTES } from "./limits";
import type { IntakeDb, ObjectStore, RejectReason } from "./store";

const SECRET = "test-session-secret";
const CUSTOMER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UPLOAD = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SYNTHETIC = "472d39b37c1e8c653c51c89c4281054839f12cd3c761ce48bac596107f71b678";
const OTHER = "ab".repeat(32);
const FILENAME = "marked-secret-filename.pdf";
const intakeDir = path.dirname(fileURLToPath(import.meta.url));

let logs: string[];
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  logs = [];
  resetUploadRoute();
  resetConfirmRoute();
  setLog((line) => {
    logs.push(line);
  });
  setCookieReader(async () => undefined);
  for (const key of [
    "DD_SESSION_SECRET",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_ROLE_ARN",
    "DD_BUCKET",
    "DATABASE_URL",
  ]) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.DD_SESSION_SECRET = SECRET;
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("upload request", () => {
  it("returns 401 and signs nothing without a session", async () => {
    const response = await uploadPost(new Request("http://localhost/api/uploads", { method: "POST", body: "{" }));
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(uploadRouteRan()).toBe(false);
    expect(logs).toEqual(["path /api/uploads session no"]);
  });

  it("does not log or echo a filename", async () => {
    setCookieReader(async () => cookie());
    const response = await uploadPost(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        body: JSON.stringify({ filename: FILENAME, customerId: CUSTOMER, sha256: "nope", byteSize: 10, contentType: "application/pdf" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(FILENAME);
    expect(logs.join("\n")).not.toContain(FILENAME);
    expect(uploadRouteRan()).toBe(true);
  });

  it("refuses a type or a size over 20 MiB before a URL exists", () => {
    expect(readUploadFields(fields({ contentType: "text/plain" })).ok).toBe(false);
    expect(readUploadFields(fields({ byteSize: MAX_PDF_BYTES + 1 })).ok).toBe(false);
    expect(readUploadFields(fields({ byteSize: MAX_PDF_BYTES })).ok).toBe(true);
    const refused = readUploadFields(fields({ byteSize: MAX_PDF_BYTES + 1 }));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(JSON.stringify(refused)).not.toContain("http");
  });

  it("returns 503 and no URL when upload is not configured", async () => {
    setCookieReader(async () => cookie());
    const response = await uploadPost(
      new Request("http://localhost/api/uploads", { method: "POST", body: JSON.stringify(fields({})) }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Upload is not configured." });
  });

  it("refuses when either access key is missing and does not log the other", async () => {
    setCookieReader(async () => cookie());
    process.env.DD_BUCKET = "dd-bucket";
    process.env.DATABASE_URL = "postgres://db.example/dd?sslmode=require";
    process.env.AWS_ACCESS_KEY_ID = "AKIA_TEST_KEY";
    delete process.env.AWS_SECRET_ACCESS_KEY;
    const missingSecret = await uploadPost(
      new Request("http://localhost/api/uploads", { method: "POST", body: JSON.stringify(fields({})) }),
    );
    expect(missingSecret.status).toBe(503);
    expect(JSON.stringify(await missingSecret.json())).not.toContain("AKIA_TEST_KEY");
    expect(logs.join("\n")).not.toContain("AKIA_TEST_KEY");

    delete process.env.AWS_ACCESS_KEY_ID;
    process.env.AWS_SECRET_ACCESS_KEY = "secret-marker-value";
    const missingId = await confirmPost(
      new Request("http://localhost/api/uploads/confirm", {
        method: "POST",
        body: JSON.stringify({ customerId: CUSTOMER, uploadId: UPLOAD, sha256: SYNTHETIC, byteSize: 128 }),
      }),
    );
    expect(missingId.status).toBe(503);
    expect(await missingId.json()).toEqual({ error: "Upload is not configured." });
    expect(JSON.stringify(logs)).not.toContain("secret-marker-value");
  });

  it("keeps the static keys out of the config object", () => {
    process.env.DD_BUCKET = "dd-bucket";
    process.env.DATABASE_URL = "postgres://db.example/dd?sslmode=require";
    process.env.AWS_ACCESS_KEY_ID = "AKIA_TEST_KEY";
    process.env.AWS_SECRET_ACCESS_KEY = "secret-marker-value";
    const config = uploadConfig();
    expect(config).toEqual({ bucket: "dd-bucket", databaseUrl: process.env.DATABASE_URL });
    const dumped = JSON.stringify(config);
    expect(dumped).not.toContain("AKIA_TEST_KEY");
    expect(dumped).not.toContain("secret-marker-value");
    const source = fs.readFileSync(path.join(intakeDir, "aws.ts"), "utf8");
    expect(source).not.toContain("AWS_ROLE_ARN");
    expect(source).not.toContain("oidc");
    expect(source).not.toContain("console.");
    expect(source).not.toContain("credentials:");
  });
});

describe("confirm request", () => {
  it("returns 401 and does no work without a session", async () => {
    const response = await confirmPost(new Request("http://localhost/api/uploads/confirm", { method: "POST", body: "{" }));
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(confirmRouteRan()).toBe(false);
  });
});

describe("issue", () => {
  it("returns the existing document and does not sign a duplicate", async () => {
    const db = memory({ documents: [{ id: "doc-1", sha256: SYNTHETIC }] });
    let signed = false;
    const result = await issueUpload({
      customerId: CUSTOMER,
      sha256: SYNTHETIC,
      byteSize: 100,
      db,
      sign: async () => {
        signed = true;
        return "https://example.invalid/put";
      },
    });
    expect(signed).toBe(false);
    expect(result).toEqual({ kind: "duplicate", documentId: "doc-1" });
    expect(db.documents).toHaveLength(1);
  });

  it("signs the server key for  a new hash", async () => {
    const db = memory();
    const result = await issueUpload({
      customerId: CUSTOMER,
      sha256: SYNTHETIC,
      byteSize: 100,
      uploadId: UPLOAD,
      db,
      sign: async (request) => `signed:${request.key}:${request.contentLength}:${request.checksumBase64}`,
    });
    expect(result.kind).toBe("url");
    if (result.kind !== "url") return;
    expect(result.key).toBe(incomingKey(CUSTOMER, UPLOAD));
    expect(result.url).toContain(checksumBase64(SYNTHETIC));
    expect(db.documents).toHaveLength(0);
  });
});

describe("confirm", () => {
  const allow = new Set([SYNTHETIC]);

  it("stores one document when the checksum matches a synthetic PDF", async () => {
    const db = memory();
    const remote = fakeObjects({ contentLength: 128, checksumSha256Base64: checksumBase64(SYNTHETIC) });
    const result = await confirmUpload({
      customerId: CUSTOMER,
      uploadId: UPLOAD,
      sha256: SYNTHETIC,
      byteSize: 128,
      actor: "Reviewer",
      allow,
      objects: remote.store,
      db,
    });
    expect(result).toEqual({ kind: "stored", documentId: "doc-1", duplicate: false });
    expect(remote.copy).toEqual([[incomingKey(CUSTOMER, UPLOAD), documentKey(CUSTOMER, SYNTHETIC)]]);
    expect(db.documents).toHaveLength(1);
    expect(db.runs).toEqual([{ documentId: "doc-1" }]);
    expect(db.audits).toEqual([{ action: "upload_received", payload: { document_id: "doc-1", sha256: SYNTHETIC } }]);
    expect(JSON.stringify(db.audits)).not.toContain(FILENAME);
  });

  it("returns the existing row and does not copy a duplicate", async () => {
    const db = memory({ documents: [{ id: "doc-9", sha256: SYNTHETIC }] });
    const remote = fakeObjects({ contentLength: 128, checksumSha256Base64: checksumBase64(SYNTHETIC) });
    const result = await confirmUpload({
      customerId: CUSTOMER,
      uploadId: UPLOAD,
      sha256: SYNTHETIC,
      byteSize: 128,
      actor: "Reviewer",
      allow,
      objects: remote.store,
      db,
    });
    expect(result).toEqual({ kind: "stored", documentId: "doc-9", duplicate: true });
    expect(remote.copy).toEqual([]);
    expect(db.documents).toHaveLength(1);
    expect(db.runs).toEqual([]);
  });

  it("expires a checksum mismatch and stores nothing", async () => {
    const db = memory();
    const remote = fakeObjects({ contentLength: 128, checksumSha256Base64: checksumBase64(OTHER) });
    const result = await confirmUpload({
      customerId: CUSTOMER,
      uploadId: UPLOAD,
      sha256: SYNTHETIC,
      byteSize: 128,
      actor: "Reviewer",
      allow,
      objects: remote.store,
      db,
    });
    expect(result).toEqual({ kind: "rejected", message: EXPIRES_MESSAGE });
    expect(remote.copy).toEqual([]);
    expect(db.documents).toEqual([]);
    expect(db.audits).toEqual([{ action: "upload_rejected", payload: { reason: "checksum" } }]);
    expect(EXPIRES_MESSAGE.toLowerCase()).not.toContain("delet");
  });

  it("expires a hash outside the eight synthetic PDFs", async () => {
    const db = memory();
    const remote = fakeObjects({ contentLength: 64, checksumSha256Base64: checksumBase64(OTHER) });
    const result = await confirmUpload({
      customerId: CUSTOMER,
      uploadId: UPLOAD,
      sha256: OTHER,
      byteSize: 64,
      actor: "Reviewer",
      allow,
      objects: remote.store,
      db,
    });
    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") expect(result.message).toBe(EXPIRES_MESSAGE);
    expect(remote.copy).toEqual([]);
    expect(db.documents).toEqual([]);
    expect(db.audits[0]?.payload).toEqual({ reason: "not_synthetic" });
  });

  it("does not remove an object that is already gone", async () => {
    const db = memory();
    const remote = fakeObjects(null);
    const result = await confirmUpload({
      customerId: CUSTOMER,
      uploadId: UPLOAD,
      sha256: SYNTHETIC,
      byteSize: 128,
      actor: "Reviewer",
      allow,
      objects: remote.store,
      db,
    });
    expect(result.kind).toBe("rejected");
    expect(db.audits[0]?.payload).toEqual({ reason: "missing" });
    expect("delete" in remote.store).toBe(false);
  });
});

describe("wording", () => {
  it("does not say deleted and does not grant a delete call", () => {
    for (const name of ["limits.ts", "confirm.ts", "s3.ts", "issue.ts", "presign.ts"]) {
      expect(fs.readFileSync(path.join(intakeDir, name), "utf8").toLowerCase(), name).not.toContain("delet");
    }
    const form = fs.readFileSync(path.join(intakeDir, "../app/(signed-in)/customers/upload-form.tsx"), "utf8");
    expect(form.toLowerCase()).not.toContain("delet");
    expect(form).not.toContain("filename");
  });
});

function cookie(): string {
  return encodeSession({ name: "Reviewer", exp: Math.floor(Date.now() / 1000) + 60, mfa: true }, SECRET);
}

function fields(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    customerId: CUSTOMER,
    sha256: SYNTHETIC,
    byteSize: 128,
    contentType: "application/pdf",
    ...overrides,
  };
}

function memory(seed?: { documents?: { id: string; sha256: string }[] }): IntakeDb & {
  documents: { id: string; sha256: string }[];
  runs: { documentId: string }[];
  audits: { action: string; payload: Record<string, unknown> }[];
} {
  const documents = [...(seed?.documents ?? [])];
  const runs: { documentId: string }[] = [];
  const audits: { action: string; payload: Record<string, unknown> }[] = [];
  return {
    documents,
    runs,
    audits,
    async customerExists() {
      return true;
    },
    async findDocument(_customerId, sha256) {
      return documents.find((document) => document.sha256 === sha256) ?? null;
    },
    async saveAccepted(row) {
      const existing = documents.find((document) => document.sha256 === row.sha256);
      if (existing !== undefined) return { id: existing.id, duplicate: true };
      const id = `doc-${documents.length + 1}`;
      documents.push({ id, sha256: row.sha256 });
      runs.push({ documentId: id });
      audits.push({ action: "upload_received", payload: { document_id: id, sha256: row.sha256 } });
      return { id, duplicate: false };
    },
    async reject(row: { reason: RejectReason }) {
      audits.push({ action: "upload_rejected", payload: { reason: row.reason } });
    },
  };
}

function fakeObjects(head: { contentLength: number; checksumSha256Base64: string } | null): {
  store: ObjectStore;
  copy: [string, string][];
} {
  const copy: [string, string][] = [];
  return {
    copy,
    store: {
      async head() {
        return head;
      },
      async copy(sourceKey, destKey) {
        copy.push([sourceKey, destKey]);
      },
    },
  };
}
