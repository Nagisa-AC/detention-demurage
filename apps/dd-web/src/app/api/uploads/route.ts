import { uploadConfig, webS3 } from "../../../intake/aws";
import { readUploadFields } from "../../../intake/body";
import { withIntake } from "../../../intake/db";
import { json, readBody } from "../../../intake/http";
import { issueUpload } from "../../../intake/issue";
import { presignPdfPut } from "../../../intake/presign";
import { isSessionRequired, requireSession } from "../../../session";
import { markUploadRoute } from "./work";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession({ path: "/api/uploads", kind: "route" });
  } catch (error) {
    if (isSessionRequired(error)) {
      return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
    }
    throw error;
  }
  markUploadRoute();
  const body = await readBody(request);
  if (!body.ok) return json(400, { error: "The request is not valid." });
  const fields = readUploadFields(body.value);
  if (!fields.ok) return json(400, { error: fields.error });
  const config = uploadConfig();
  if (config === null) return json(503, { error: "Upload is not configured." });

  const client = webS3();
  const bucket = config.bucket;
  return withIntake(config.databaseUrl, async (db) => {
    const result = await issueUpload({
      customerId: fields.value.customerId,
      sha256: fields.value.sha256,
      byteSize: fields.value.byteSize,
      db,
      sign: (signed) =>
        presignPdfPut({
          client,
          bucket,
          key: signed.key,
          contentLength: signed.contentLength,
          checksumBase64: signed.checksumBase64,
        }),
    });
    if (result.kind === "missing-customer") return json(404, { error: "That customer was not found." });
    if (result.kind === "duplicate") return json(200, { documentId: result.documentId, duplicate: true });
    return json(201, { uploadId: result.uploadId, url: result.url });
  });
}
