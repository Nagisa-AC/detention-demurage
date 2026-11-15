import { randomUUID } from "node:crypto";
import { checksumBase64, incomingKey } from "./limits";
import type { IntakeDb } from "./store";

export type SignRequest = {
  key: string;
  contentLength: number;
  checksumBase64: string;
};

export type IssueResult =
  | { kind: "missing-customer" }
  | { kind: "duplicate"; documentId: string }
  | { kind: "url"; uploadId: string; url: string; key: string };

export async function issueUpload(input: {
  customerId: string;
  sha256: string;
  byteSize: number;
  db: Pick<IntakeDb, "customerExists" | "findDocument">;
  sign: (request: SignRequest) => Promise<string>;
  uploadId?: string;
}): Promise<IssueResult> {
  const exists = await input.db.customerExists(input.customerId);
  if (!exists) return { kind: "missing-customer" };
  const existing = await input.db.findDocument(input.customerId, input.sha256);
  if (existing !== null) return { kind: "duplicate", documentId: existing.id };
  const uploadId = input.uploadId ?? randomUUID();
  const key = incomingKey(input.customerId, uploadId);
  const url = await input.sign({
    key,
    contentLength: input.byteSize,
    checksumBase64: checksumBase64(input.sha256),
  });
  return { kind: "url", uploadId, url, key };
}
