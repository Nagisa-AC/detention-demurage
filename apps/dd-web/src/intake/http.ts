export function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function readBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false };
  }
}
