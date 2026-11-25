import { cookies } from "next/headers";
import { EMAIL_COOKIE } from "../../../auth/cookies";
import { submitCode } from "../actions";

export default async function CodePage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const notice = (await searchParams).notice;
  const email = (await cookies()).get(EMAIL_COOKIE)?.value;
  const who = email === undefined || email === "" ? "that address" : email;
  return (
    <main className="center">
      <div className="auth">
        <div className="logo">
          <i />
          Tidemark Recovery
        </div>
        <h2>Check your email</h2>
        <p>
          If <b style={{ color: "var(--ink)" }}>{who}</b> has a Tidemark account, we&apos;ve sent an 8-digit code. It expires in 10
          minutes.
        </p>
        {notice === "code" ? <p className="notice">That code didn&apos;t work.</p> : null}
        <form action={submitCode}>
          <div className="lbl">Code</div>
          <input
            className="field"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{8}"
            maxLength={8}
            required
            aria-label="Code"
          />
          <button className="btn primary full" type="submit">
            Sign in
          </button>
        </form>
        <div className="small">
          <a href="/sign-in">Use a different email</a>
        </div>
      </div>
    </main>
  );
}
