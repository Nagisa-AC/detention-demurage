import { checksumBase64, documentKey, EXPIRES_MESSAGE, incomingKey } from "./limits";
import type { IntakeDb, ObjectStore } from "./store";

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
    await input.db.reject({ customerId: input.customerId, actor: input.actor, reason: "not_synthetic" });
    return { kind: "rejected", message: EXPIRES_MESSAGE };
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

function sameChecksum(actual: string | null, expected: string): boolean {
  if (actual === null || actual === "") return false;
  const left = Buffer.from(actual, "base64");
  const right = Buffer.from(expected, "base64");
  return left.length > 0 && left.length === right.length && left.equals(right);
}
