"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revokeRefreshToken } from "../auth/cognito";
import { REFRESH_COOKIE } from "../auth/cookies";
import { clearSession } from "../auth/session";

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const refresh = jar.get(REFRESH_COOKIE)?.value;
  if (refresh !== undefined && refresh !== "") await revokeRefreshToken(refresh);
  await clearSession();
  redirect("/sign-in");
}
