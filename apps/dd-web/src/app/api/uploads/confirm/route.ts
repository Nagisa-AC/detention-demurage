import { realPdfLimits } from "dd-core";
import { uploadConfig, webS3 } from "../../../../intake/aws";
import { syntheticAllowlist } from "../../../../intake/allow";
import { readConfirmFields } from "../../../../intake/body";
import { confirmUpload } from "../../../../intake/confirm";
import { withIntake } from "../../../../intake/db";
import { json, readBody } from "../../../../intake/http";
import { MAX_PDF_BYTES } from "../../../../intake/limits";
import { inspectPdf } from "../../../../intake/pdf-file";
import { s3ObjectStore } from "../../../../intake/s3";
import { isSessionRequired, requireSession } from "../../../../session";
import { markConfirmRoute } from "./work";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let actor = "";
  try {
    const session = await requireSession({ path: "/api/uploads/confirm", kind: "route" });
    actor = session.name;
  } catch (error) {
    if (isSessionRequired(error)) {
      return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
    }
    throw error;
  }
  markConfirmRoute();
  const body = await readBody(request);
  if (!body.ok) return json(400, { error: "The request is not valid." });
  const limits = realPdfLimits();
  const fields = readConfirmFields(body.value, limits.maxBytes);
  if (!fields.ok) return json(400, { error: fields.error });
  const config = uploadConfig();
  if (config === null) return json(503, { error: "Upload is not configured." });

  const client = webS3();
  const objects = s3ObjectStore(client, config.bucket);
  return withIntake(config.databaseUrl, async (db) => {
    if (fields.value.byteSize > MAX_PDF_BYTES) {
      const accepts = await db.acceptsRealDocuments(fields.value.customerId);
      if (!accepts) return json(400, { error: "The request is not valid." });
    }
    const result = await confirmUpload({
      customerId: fields.value.customerId,
      uploadId: fields.value.uploadId,
      sha256: fields.value.sha256,
      byteSize: fields.value.byteSize,
      actor,
      allow: syntheticAllowlist(),
      limits,
      inspect: inspectPdf,
      objects,
      db,
    });
    if (result.kind === "missing-customer") return json(404, { error: "That customer was not found." });
    if (result.kind === "rejected") return json(422, { accepted: false, message: result.message });
    return json(200, { accepted: true, documentId: result.documentId, duplicate: result.duplicate });
  });
}
