import { requestCode } from "./actions";
import { PasskeyButton } from "./passkey-button";

const CONTACT = "mailto:disputes@tidemark.example";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const notice = (await searchParams).notice;
  return (
    <main className="center">
      <div className="auth">
        <div className="logo">
          <i />
          Tidemark Recovery
        </div>
        <h2>Sign in</h2>
        <p>Customer portal. Accounts are created by invitation.</p>
        {notice === "email" ? <p className="notice">Enter your work email.</p> : null}
        {notice === "refused" ? <p className="notice">We couldn&apos;t sign you in. Contact us.</p> : null}
        {notice === "passkey" ? <p className="notice">That passkey didn&apos;t work.</p> : null}
        <PasskeyButton />
        <div className="or">or</div>
        <form action={requestCode}>
          <div className="lbl">Work email</div>
          <input className="field" id="email" name="email" type="email" autoComplete="username" placeholder="you@company.com" required />
          <button className="btn full" type="submit">
            Email me a sign-in code
          </button>
        </form>
        <div className="small">
          No account? Accounts come with a Tidemark engagement.
          <br />
          <a href={CONTACT}>Contact us</a>
        </div>
      </div>
    </main>
  );
}
