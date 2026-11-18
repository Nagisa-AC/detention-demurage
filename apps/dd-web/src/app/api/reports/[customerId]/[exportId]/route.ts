import { isSessionRequired, requireSession } from "../../../../../session";
import { openReport, s3ReportStore } from "../../../../../report/export";
import { withReviewDb } from "../../../../../review-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE = { "cache-control": "private, no-store" };

export async function GET(
  request: Request,
  context: { params: Promise<{ customerId: string; exportId: string }> },
): Promise<Response> {
  try {
    await requireSession({ path: "/api/reports", kind: "route" });
  } catch (error) {
    if (isSessionRequired(error)) return new Response(null, { status: 401, headers: PRIVATE });
    throw error;
  }
  const format = new URL(request.url).searchParams.get("format");
  if (format !== "pdf" && format !== "csv") return new Response(null, { status: 404, headers: PRIVATE });
  const store = s3ReportStore();
  if (store === null) return new Response(null, { status: 404, headers: PRIVATE });
  const { customerId, exportId } = await context.params;
  const file = await withReviewDb((sql) => openReport(sql, store, customerId, exportId, format));
  if (file === null) return new Response(null, { status: 404, headers: PRIVATE });
  return new Response(Buffer.from(file.bytes), {
    status: 200,
    headers: {
      ...PRIVATE,
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="${file.filename}"`,
      "x-content-type-options": "nosniff",
    },
  });
}
