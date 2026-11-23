"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolvePortalRequest } from "portal";
import { hasPasskey, revokeRefreshToken, startEmailCode, submitEmailCode } from "../../auth/cognito";
import { CHALLENGE_COOKIE, EMAIL_COOKIE, OFFER_PASSKEY_COOKIE, sessionCookieOptions } from "../../auth/cookies";
import { writeSession } from "../../auth/session";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEN_MINUTES = 10 * 60;

export async function requestCode(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) redirect("/sign-in?notice=email");
  const started = await startEmailCode(email);
  const jar = await cookies();
  const options = sessionCookieOptions(TEN_MINUTES);
  jar.set(EMAIL_COOKIE, email, options);
  if (started === null) jar.set(CHALLENGE_COOKIE, "", sessionCookieOptions(0));
  else jar.set(CHALLENGE_COOKIE, started.session, options);
  redirect("/sign-in/code");
}

export async function submitCode(formData: FormData): Promise<void> {
  const jar = await cookies();
  const email = jar.get(EMAIL_COOKIE)?.value ?? "";
  const session = jar.get(CHALLENGE_COOKIE)?.value ?? "";
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  const tokens = email === "" || session === "" ? null : await submitEmailCode(email, session, code);
  if (tokens === null) redirect("/sign-in/code?notice=code");
  const account = await resolvePortalRequest(tokens.idToken);
  if (account === null) {
    await revokeRefreshToken(tokens.refreshToken);
    redirect("/sign-in?notice=refused");
  }
  await writeSession(tokens);
  jar.set(CHALLENGE_COOKIE, "", sessionCookieOptions(0));
  const passkeys = await hasPasskey(tokens.accessToken);
  if (passkeys !== true) {
    jar.set(OFFER_PASSKEY_COOKIE, "1", sessionCookieOptions(60 * 60));
    redirect("/passkey");
  }
  redirect("/");
}
