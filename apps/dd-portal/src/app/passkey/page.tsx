import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withPortalQuery } from "portal";
import { EMAIL_COOKIE, OFFER_PASSKEY_COOKIE } from "../../auth/cookies";
import { requireAccount } from "../../auth/session";
import { skipPasskey } from "./actions";
import { CreatePasskey } from "./create-passkey";

export default async function PasskeyPage({
  searchParams,
}: {
  searchParams: Promise<{ ready?: string }>;
}) {
  const account = await requireAccount();
  const ready = (await searchParams).ready === "1";
  if (!ready && (await cookies()).get(OFFER_PASSKEY_COOKIE)?.value !== "1") redirect("/");
  const email = account.email ?? (await cookies()).get(EMAIL_COOKIE)?.value ?? "your email";
  let company = "";
  try {
    const profile = await withPortalQuery(account.customer, (views) => views.profile());
    if (profile !== null && profile.display_name !== "") company = profile.display_name;
  } catch {
    company = "";
  }
  const who = company === "" ? email : `${company} · ${email}`;
  if (ready) {
    return (
      <main className="center">
        <div className="auth" style={{ textAlign: "center" }}>
          <div className="logo" style={{ justifyContent: "center" }}>
            <i />
            Tidemark Recovery
          </div>
          <div className="ok" style={{ margin: "20px auto 0" }}>
            ✓
          </div>
          <h2>You&apos;re all set</h2>
          <p>Next time, just choose “Sign in with passkey.”</p>
          <a className="btn primary full" href="/">
            Go to your portal →
          </a>
        </div>
      </main>
    );
  }
  return (
    <main className="center">
      <div className="auth">
        <div className="logo">
          <i />
          Tidemark Recovery
        </div>
        <h2>Set up sign-in</h2>
        <p>{who}</p>
        <div className="row" style={{ marginBottom: 18, alignItems: "center" }}>
          <div className="key">⚿</div>
          <div>
            <b>Use a passkey</b>
            <div className="s">Sign in with Face ID, Touch ID, or Windows Hello. No password to remember.</div>
          </div>
        </div>
        <CreatePasskey />
        <div className="or">or</div>
        <form action={skipPasskey}>
          <button className="btn full" type="submit">
            Use a code sent to my email instead
          </button>
        </form>
        <div className="small">You can add more passkeys later under Account.</div>
      </div>
    </main>
  );
}
