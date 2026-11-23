import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { resolvePortalRequest } from "portal";
import { startPasskeyRegistration } from "../../../auth/cognito";
import { ACCESS_COOKIE, ID_COOKIE } from "../../../auth/cookies";

export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  const account = await resolvePortalRequest(jar.get(ID_COOKIE)?.value ?? null);
  const access = jar.get(ACCESS_COOKIE)?.value ?? "";
  if (account === null || access === "") return NextResponse.json({ ok: false }, { status: 401 });
  const options = await startPasskeyRegistration(access);
  if (options === null) return NextResponse.json({ ok: false }, { status: 400 });
  return NextResponse.json({ options });
}
