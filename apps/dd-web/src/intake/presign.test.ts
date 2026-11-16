import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { checksumBase64 } from "./limits";
import { presignPdfPut } from "./presign";

const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const client = new S3Client({
  region: "us-east-2",
  credentials: { accessKeyId: "testing", secretAccessKey: "testing" },
});

describe("presign", () => {
  it("binds a 60-second PDF PUT to the length and checksum", async () => {
    expect(checksumBase64(EMPTY_SHA)).toBe("47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
    const key = "incoming/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.pdf";
    const first = new URL(
      await presignPdfPut({
        client,
        bucket: "dd-recovery-plan-test",
        key,
        contentLength: 128,
        checksumBase64: checksumBase64(EMPTY_SHA),
      }),
    );
    const second = new URL(
      await presignPdfPut({
        client,
        bucket: "dd-recovery-plan-test",
        key,
        contentLength: 129,
        checksumBase64: checksumBase64("ab".repeat(32)),
      }),
    );
    expect(first.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(first.searchParams.get("X-Amz-Credential")).toContain("/us-east-2/");
    expect(first.pathname).toBe(`/${key}`);
    const signed = first.searchParams.get("X-Amz-SignedHeaders") ?? "";
    expect(signed.split(";")).toEqual(
      expect.arrayContaining(["content-type", "content-length", "x-amz-checksum-sha256"]),
    );
    expect(first.searchParams.get("X-Amz-Signature")).not.toBe(second.searchParams.get("X-Amz-Signature"));
  });
});
