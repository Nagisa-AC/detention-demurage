import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { resolvePortalRequest } from "portal";
import { revokeRefreshToken, submitPasskey } from "../../../../auth/cognito";
import { CHALLENGE_COOKIE, EMAIL_COOKIE, sessionCookieOptions } from "../../../../auth/cookies";
import { writeSession } from "../../../../auth/session";

export async function POST(request: Request): Promise<NextResponse> {
  const jar = await cookies();
  const email = jar.get(EMAIL_COOKIE)?.value ?? "";
  const session = jar.get(CHALLENGE_COOKIE)?.value ?? "";
  let credential: unknown;
  try {
    credential = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const tokens = email === "" || session === "" ? null : await submitPasskey(email, session, credential);
  if (tokens === null) return NextResponse.json({ ok: false }, { status: 400 });
  const account = await resolvePortalRequest(tokens.idToken);
  if (account === null) {
    await revokeRefreshToken(tokens.refreshToken);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  await writeSession(tokens);
  jar.set(CHALLENGE_COOKIE, "", sessionCookieOptions(0));
  return NextResponse.json({ next: "/" });
}
