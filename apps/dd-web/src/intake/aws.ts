import { S3Client } from "@aws-sdk/client-s3";
import { AWS_REGION } from "./limits";

export type UploadConfig = {
  bucket: string;
  databaseUrl: string;
};

/** Bucket and database. The S3 client reads AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from the environment. */
export function uploadConfig(): UploadConfig | null {
  const bucket = process.env.DD_BUCKET;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (bucket === undefined || bucket === "" || databaseUrl === undefined || databaseUrl === "") return null;
  if (accessKeyId === undefined || accessKeyId === "" || secretAccessKey === undefined || secretAccessKey === "") return null;
  return { bucket, databaseUrl };
}

/** Uses the SDK default provider, which reads the static keys from the environment. */
export function webS3(): S3Client {
  return new S3Client({ region: AWS_REGION });
}
