import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolvePortalRequest, type PortalAccount } from "portal";
import type { CognitoTokens } from "./cognito";
import { ACCESS_COOKIE, ID_COOKIE, OFFER_PASSKEY_COOKIE, REFRESH_COOKIE, sessionCookieOptions } from "./cookies";

const MONTH = 60 * 60 * 24 * 30;

export async function writeSession(tokens: CognitoTokens): Promise<void> {
  const jar = await cookies();
  jar.set(ID_COOKIE, tokens.idToken, sessionCookieOptions(tokens.expiresIn));
  jar.set(ACCESS_COOKIE, tokens.accessToken, sessionCookieOptions(tokens.expiresIn));
  jar.set(REFRESH_COOKIE, tokens.refreshToken, sessionCookieOptions(MONTH));
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  const gone = sessionCookieOptions(0);
  jar.set(ID_COOKIE, "", gone);
  jar.set(ACCESS_COOKIE, "", gone);
  jar.set(REFRESH_COOKIE, "", gone);
  jar.set(OFFER_PASSKEY_COOKIE, "", gone);
}

/** A verified portal token whose sub maps to a customer. Otherwise the caller is sent to sign-out. */
export async function requireAccount(): Promise<PortalAccount> {
  const jar = await cookies();
  const account = await resolvePortalRequest(jar.get(ID_COOKIE)?.value ?? null);
  if (account === null) redirect("/sign-out");
  return account;
}
