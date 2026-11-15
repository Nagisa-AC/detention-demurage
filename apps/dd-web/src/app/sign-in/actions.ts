"use server";

import { redirect } from "next/navigation";
import { establishSession } from "../../cognito";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function signIn(formData: FormData): Promise<void> {
  const result = await establishSession({
    email: field(formData, "email"),
    password: field(formData, "password"),
    code: field(formData, "code"),
  });
  if (!result.ok) redirect(`/sign-in?error=${result.reason}`);
  redirect("/customers");
}
