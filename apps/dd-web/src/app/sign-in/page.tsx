import { signIn } from "./actions";

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
  const message = signInMessage(raw);
  return (
    <main className="signin">
      <div className="signin-mark">D&D Recovery</div>
      <form action={signIn}>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <label>
          Authenticator code
          <input name="code" inputMode="numeric" autoComplete="one-time-code" required />
        </label>
        {message === null ? null : <p className="signin-error">{message}</p>}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
