import { CopyObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ObjectHead, ObjectStore } from "./store";

export function s3ObjectStore(client: S3Client, bucket: string): ObjectStore {
  return {
    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: "ENABLED" }));
        const head: ObjectHead = {
          contentLength: out.ContentLength ?? 0,
          checksumSha256Base64: out.ChecksumSHA256 ?? null,
        };
        return head;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async copy(sourceKey, destKey) {
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: destKey,
          CopySource: copySource(bucket, sourceKey),
        }),
      );
    },
  };
}

function copySource(bucket: string, key: string): string {
  return `${bucket}/${key.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function isMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return record.name === "NotFound" || record.name === "NoSuchKey" || record.$metadata?.httpStatusCode === 404;
}
