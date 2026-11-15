import { isSessionRequired, requireSession } from "../../../session";
import { markSessionRoute } from "./work";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const session = await requireSession({ path: "/api/session", kind: "route" });
    markSessionRoute();
    return Response.json({ name: session.name }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (isSessionRequired(error)) {
      return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
    }
    throw error;
  }
}
