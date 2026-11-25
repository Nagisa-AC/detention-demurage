import { SignInForm } from "./form";

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
        {notice === "refused" ? <p className="notice">We couldn&apos;t sign you in. Contact us.</p> : null}
        <SignInForm emailNotice={notice === "email"} passkeyNotice={notice === "passkey"} />
        <div className="small">
          No account? Accounts come with a Tidemark engagement.
          <br />
          <a href="mailto:disputes@tidemark.example">Contact us</a>
        </div>
      </div>
    </main>
  );
}
