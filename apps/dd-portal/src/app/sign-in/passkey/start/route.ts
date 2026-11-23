import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { startPasskey } from "../../../../auth/cognito";
import { CHALLENGE_COOKIE, EMAIL_COOKIE, sessionCookieOptions } from "../../../../auth/cookies";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request): Promise<NextResponse> {
  const email = await readEmail(request);
  if (email === null) return NextResponse.json({ ok: false }, { status: 400 });
  const started = await startPasskey(email);
  if (started === null) return NextResponse.json({ ok: false }, { status: 400 });
  const jar = await cookies();
  const options = sessionCookieOptions(10 * 60);
  jar.set(EMAIL_COOKIE, email, options);
  jar.set(CHALLENGE_COOKIE, started.session, options);
  return NextResponse.json({ options: started.options });
}

async function readEmail(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("email" in body) || typeof body.email !== "string") return null;
    const email = body.email.trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) return null;
    return email;
  } catch {
    return null;
  }
}
