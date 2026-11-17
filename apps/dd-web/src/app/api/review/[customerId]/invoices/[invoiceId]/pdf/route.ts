import { isSessionRequired, requireSession } from "../../../../../../../session";
import { openInvoicePdf } from "../../../../../../../review-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE = { "cache-control": "private, no-store" };

export async function GET(
  _request: Request,
  context: { params: Promise<{ customerId: string; invoiceId: string }> },
): Promise<Response> {
  try {
    await requireSession({ path: "/api/review/pdf", kind: "route" });
  } catch (error) {
    if (isSessionRequired(error)) return new Response(null, { status: 401, headers: PRIVATE });
    throw error;
  }
  const { customerId, invoiceId } = await context.params;
  const stream = await openInvoicePdf(customerId, invoiceId);
  if (stream === null) return new Response(null, { status: 404, headers: PRIVATE });
  return new Response(stream, {
    status: 200,
    headers: {
      ...PRIVATE,
      "content-type": "application/pdf",
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
    },
  });
}
