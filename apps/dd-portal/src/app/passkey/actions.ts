"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OFFER_PASSKEY_COOKIE, sessionCookieOptions } from "../../auth/cookies";

export async function skipPasskey(): Promise<void> {
  const jar = await cookies();
  jar.set(OFFER_PASSKEY_COOKIE, "", sessionCookieOptions(0));
  redirect("/");
}
