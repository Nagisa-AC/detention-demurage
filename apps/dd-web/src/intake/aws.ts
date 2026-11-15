import { S3Client } from "@aws-sdk/client-s3";
import { AWS_REGION } from "./limits";

export type UploadConfig = {
  bucket: string;
  roleArn: string;
  databaseUrl: string;
};

/** OIDC role, bucket, and database. No static access key. */
export function uploadConfig(): UploadConfig | null {
  const bucket = process.env.DD_BUCKET;
  const roleArn = process.env.AWS_ROLE_ARN;
  const databaseUrl = process.env.DATABASE_URL;
  if (bucket === undefined || bucket === "" || roleArn === undefined || roleArn === "") return null;
  if (databaseUrl === undefined || databaseUrl === "") return null;
  return { bucket, roleArn, databaseUrl };
}

export async function webS3(roleArn: string): Promise<S3Client> {
  const { awsCredentialsProvider } = await import("@vercel/functions/oidc");
  return new S3Client({
    region: AWS_REGION,
    credentials: awsCredentialsProvider({ roleArn }),
  });
}
