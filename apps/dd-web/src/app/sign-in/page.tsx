import { SignInForm } from "./form";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function signInMessage(code: string | undefined): string | null {
  if (code === "config") return "Sign-in is not configured.";
  if (code === "failed") return "Sign-in failed.";
  return null;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.error) ? params.error[0] : params.error;
  return <SignInForm message={signInMessage(raw)} />;
}
