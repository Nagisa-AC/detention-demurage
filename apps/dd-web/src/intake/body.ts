import { isSha256, isUuid, MAX_PDF_BYTES, PDF_CONTENT_TYPE } from "./limits";

export type UploadFields = {
  customerId: string;
  sha256: string;
  byteSize: number;
  contentType: string;
};

export type ConfirmFields = {
  customerId: string;
  uploadId: string;
  sha256: string;
  byteSize: number;
};

export function readUploadFields(body: unknown): { ok: true; value: UploadFields } | { ok: false; error: string } {
  const record = recordOf(body);
  if (record === null) return { ok: false, error: "The request is not valid." };
  const customerId = stringField(record, "customerId");
  const sha256 = stringField(record, "sha256");
  const contentType = stringField(record, "contentType");
  const byteSize = numberField(record, "byteSize");
  if (customerId === null || !isUuid(customerId)) return { ok: false, error: "The request is not valid." };
  if (sha256 === null || !isSha256(sha256)) return { ok: false, error: "The hash is not valid." };
  if (byteSize === null) return { ok: false, error: "The request is not valid." };
  if (contentType !== PDF_CONTENT_TYPE) return { ok: false, error: "Only a PDF can be uploaded." };
  if (byteSize > MAX_PDF_BYTES) return { ok: false, error: "This PDF is over 20 MiB." };
  if (byteSize < 1) return { ok: false, error: "The request is not valid." };
  return { ok: true, value: { customerId, sha256, byteSize, contentType } };
}

export function readConfirmFields(body: unknown): { ok: true; value: ConfirmFields } | { ok: false; error: string } {
  const record = recordOf(body);
  if (record === null) return { ok: false, error: "The request is not valid." };
  const customerId = stringField(record, "customerId");
  const uploadId = stringField(record, "uploadId");
  const sha256 = stringField(record, "sha256");
  const byteSize = numberField(record, "byteSize");
  if (customerId === null || !isUuid(customerId) || uploadId === null || !isUuid(uploadId)) {
    return { ok: false, error: "The request is not valid." };
  }
  if (sha256 === null || !isSha256(sha256)) return { ok: false, error: "The hash is not valid." };
  if (byteSize === null || byteSize < 1 || byteSize > MAX_PDF_BYTES) {
    return { ok: false, error: "The request is not valid." };
  }
  return { ok: true, value: { customerId, uploadId, sha256, byteSize } };
}

function recordOf(body: unknown): Record<string, unknown> | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  return value;
}
