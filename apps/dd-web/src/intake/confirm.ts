import { realPdfLimits, realPdfMessage, trailerEncrypts, type RealPdfLimits } from "dd-core";
import { checksumBase64, documentKey, EXPIRES_MESSAGE, incomingKey } from "./limits";
import type { IntakeDb, ObjectStore, RejectReason } from "./store";

export type ConfirmResult =
  | { kind: "missing-customer" }
  | { kind: "rejected"; message: string }
  | { kind: "stored"; documentId: string; duplicate: boolean };

export async function confirmUpload(input: {
  customerId: string;
  uploadId: string;
  sha256: string;
  byteSize: number;
  actor: string;
  allow: ReadonlySet<string>;
  objects: ObjectStore;
  db: IntakeDb;
  limits?: RealPdfLimits;
}): Promise<ConfirmResult> {
  const exists = await input.db.customerExists(input.customerId);
  if (!exists) return { kind: "missing-customer" };

  const source = incomingKey(input.customerId, input.uploadId);
  const head = await input.objects.head(source);
  if (head === null) {
    await input.db.reject({ customerId: input.customerId, actor: input.actor, reason: "missing" });
    return { kind: "rejected", message: EXPIRES_MESSAGE };
  }
  const checksumMatches = sameChecksum(head.checksumSha256Base64, checksumBase64(input.sha256));
  if (!checksumMatches || head.contentLength !== input.byteSize) {
    await input.db.reject({ customerId: input.customerId, actor: input.actor, reason: "checksum" });
    return { kind: "rejected", message: EXPIRES_MESSAGE };
  }
  if (!input.allow.has(input.sha256)) {
    const refused = await refuseReal(input);
    if (refused !== null) return refused;
  }

  const existing = await input.db.findDocument(input.customerId, input.sha256);
  if (existing !== null) return { kind: "stored", documentId: existing.id, duplicate: true };

  const storageKey = documentKey(input.customerId, input.sha256);
  try {
    await input.objects.copy(source, storageKey);
  } catch {
    await input.db.reject({ customerId: input.customerId, actor: input.actor, reason: "copy" });
    return { kind: "rejected", message: EXPIRES_MESSAGE };
  }
  const saved = await input.db.saveAccepted({
    customerId: input.customerId,
    sha256: input.sha256,
    byteSize: input.byteSize,
    storageKey,
    actor: input.actor,
  });
  return { kind: "stored", documentId: saved.id, duplicate: saved.duplicate };
}

async function refuseReal(input: {
  customerId: string;
  uploadId: string;
  sha256: string;
  byteSize: number;
  actor: string;
  objects: ObjectStore;
  db: IntakeDb;
  limits?: RealPdfLimits;
}): Promise<ConfirmResult | null> {
  const accepts = await input.db.acceptsRealDocuments(input.customerId);
  if (!accepts) {
    await input.db.reject({ customerId: input.customerId, actor: input.actor, reason: "not_synthetic" });
    return { kind: "rejected", message: EXPIRES_MESSAGE };
  }
  const limits = input.limits ?? realPdfLimits();
  if (input.byteSize > limits.maxBytes) {
    return await rejectReal(input, "too_large", limits);
  }
  const bytes = await input.objects.get(incomingKey(input.customerId, input.uploadId));
  if (bytes === null) {
    await input.db.reject({ customerId: input.customerId, actor: input.actor, reason: "missing" });
    return { kind: "rejected", message: EXPIRES_MESSAGE };
  }
  if (bytes.byteLength !== input.byteSize) {
    await input.db.reject({ customerId: input.customerId, actor: input.actor, reason: "checksum" });
    return { kind: "rejected", message: EXPIRES_MESSAGE };
  }
  if (!pdfHeader(bytes)) return await rejectReal(input, "malformed", limits);
  if (trailerEncrypts(bytes)) return await rejectReal(input, "encrypted", limits);
  return null;
}

/** A PDF starts with this header. Page count and a full read happen in the worker. */
function pdfHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 5) return false;
  return Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";
}

async function rejectReal(
  input: { customerId: string; actor: string; db: IntakeDb },
  reason: RejectReason,
  limits: RealPdfLimits,
): Promise<ConfirmResult> {
  await input.db.reject({ customerId: input.customerId, actor: input.actor, reason });
  const message =
    reason === "too_large" || reason === "too_many_pages" || reason === "encrypted" || reason === "malformed"
      ? realPdfMessage(reason, limits)
      : EXPIRES_MESSAGE;
  return { kind: "rejected", message };
}

function sameChecksum(actual: string | null, expected: string): boolean {
  if (actual === null || actual === "") return false;
  const left = Buffer.from(actual, "base64");
  const right = Buffer.from(expected, "base64");
  return left.length > 0 && left.length === right.length && left.equals(right);
}
