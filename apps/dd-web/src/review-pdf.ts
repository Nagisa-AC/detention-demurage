import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { isUuid } from "./intake/limits";
import { uploadConfig, webS3 } from "./intake/aws";
import type { ReviewSql } from "./review-data";

export type PdfSource = {
  findKey(customerId: string, invoiceId: string): Promise<string | null>;
  open(key: string): Promise<ReadableStream<Uint8Array> | null>;
};

let source: PdfSource | null = null;

/** Test seam. Production reads Postgres and streams the object from S3. */
export function setPdfSource(next: PdfSource | null): void {
  source = next;
}

export async function openInvoicePdf(customerId: string, invoiceId: string): Promise<ReadableStream<Uint8Array> | null> {
  if (!isUuid(customerId) || !isUuid(invoiceId)) return null;
  const active = source ?? productionSource();
  const key = await active.findKey(customerId, invoiceId);
  if (key === null || !isDocumentKey(customerId, key)) return null;
  return active.open(key);
}

export async function findDocumentKey(sql: ReviewSql, customerId: string, invoiceId: string): Promise<string | null> {
  const result = await sql.query<{ storage_key: string | null }>(
    `SELECT d.storage_key
     FROM "Invoice" i
     JOIN "Document" d ON d.id = i.document_id
     WHERE i.id = $1 AND i.customer_id = $2 AND d.customer_id = $2`,
    [invoiceId, customerId],
  );
  return result.rows[0]?.storage_key ?? null;
}

export function isDocumentKey(customerId: string, key: string): boolean {
  const prefix = `documents/${customerId}/`;
  return key.startsWith(prefix) && !key.includes("..") && key.length > prefix.length;
}

function productionSource(): PdfSource {
  return {
    async findKey(customerId, invoiceId) {
      const { withReviewDb } = await import("./review-data");
      const key = await withReviewDb((sql) => findDocumentKey(sql, customerId, invoiceId));
      return key ?? null;
    },
    open: openStoredObject,
  };
}

async function openStoredObject(key: string): Promise<ReadableStream<Uint8Array> | null> {
  const config = uploadConfig();
  if (config === null) return null;
  const body = await getObject(webS3(), config.bucket, key);
  if (body === null || typeof body.transformToWebStream !== "function") return null;
  return body.transformToWebStream();
}

async function getObject(client: S3Client, bucket: string, key: string) {
  try {
    const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return out.Body ?? null;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return record.name === "NotFound" || record.name === "NoSuchKey" || record.$metadata?.httpStatusCode === 404;
}
