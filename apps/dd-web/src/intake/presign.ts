import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PDF_CONTENT_TYPE } from "./limits";

const SIGNED = new Set(["content-type", "content-length", "x-amz-checksum-sha256"]);

/** Sign a 60-second PUT. The caller supplies the client; production uses the OIDC role. */
export async function presignPdfPut(input: {
  client: S3Client;
  bucket: string;
  key: string;
  contentLength: number;
  checksumBase64: string;
}): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.key,
    ContentType: PDF_CONTENT_TYPE,
    ContentLength: input.contentLength,
    ChecksumSHA256: input.checksumBase64,
  });
  return getSignedUrl(input.client, command, {
    expiresIn: 60,
    signableHeaders: SIGNED,
    unhoistableHeaders: SIGNED,
  });
}
