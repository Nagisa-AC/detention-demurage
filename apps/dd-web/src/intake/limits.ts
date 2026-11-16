export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const PDF_CONTENT_TYPE = "application/pdf";
export const AWS_REGION = "us-east-2";

/** A rejected upload stays in incoming/ until the lifecycle expires it. */
export const EXPIRES_MESSAGE =
  "This upload was not accepted. The incoming object expires within a day.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function isSha256(value: string): boolean {
  return SHA256.test(value);
}

export function checksumBase64(hexSha256: string): string {
  return Buffer.from(hexSha256, "hex").toString("base64");
}

export function incomingKey(customerId: string, uploadId: string): string {
  return `incoming/${customerId}/${uploadId}.pdf`;
}

export function documentKey(customerId: string, sha256: string): string {
  return `documents/${customerId}/${sha256}.pdf`;
}
