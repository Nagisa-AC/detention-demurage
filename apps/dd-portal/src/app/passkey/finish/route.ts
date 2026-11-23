import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { resolvePortalRequest } from "portal";
import { finishPasskeyRegistration } from "../../../auth/cognito";
import { ACCESS_COOKIE, ID_COOKIE, OFFER_PASSKEY_COOKIE, sessionCookieOptions } from "../../../auth/cookies";

export async function POST(request: Request): Promise<NextResponse> {
  const jar = await cookies();
  const account = await resolvePortalRequest(jar.get(ID_COOKIE)?.value ?? null);
  const access = jar.get(ACCESS_COOKIE)?.value ?? "";
  if (account === null || access === "") return NextResponse.json({ ok: false }, { status: 401 });
  let credential: unknown;
  try {
    credential = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const saved = await finishPasskeyRegistration(access, credential);
  if (!saved) return NextResponse.json({ ok: false }, { status: 400 });
  jar.set(OFFER_PASSKEY_COOKIE, "", sessionCookieOptions(0));
  return NextResponse.json({ ok: true });
}
