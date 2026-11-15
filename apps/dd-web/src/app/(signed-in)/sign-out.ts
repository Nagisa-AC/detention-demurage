"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie, requireSession } from "../../session";

export async function signOut(): Promise<void> {
  await requireSession({ path: "/sign-out" });
  await clearSessionCookie();
  redirect("/sign-in");
}
