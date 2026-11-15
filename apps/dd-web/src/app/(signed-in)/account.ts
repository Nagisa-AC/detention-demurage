"use server";

import { requireSession } from "../../session";
import { markAccountRead } from "./account-work";

export async function readAccountName(): Promise<string> {
  const session = await requireSession({ path: "/account" });
  markAccountRead();
  return session.name;
}
