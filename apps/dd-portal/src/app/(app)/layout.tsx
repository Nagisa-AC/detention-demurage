import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withPortalQuery } from "portal";
import { OFFER_PASSKEY_COOKIE } from "../../auth/cookies";
import { requireAccount } from "../../auth/session";
import { Shell } from "../../shell";
import { readTheme } from "../../theme";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const account = await requireAccount();
  if ((await cookies()).get(OFFER_PASSKEY_COOKIE)?.value === "1") redirect("/passkey");
  let company = "Your account";
  try {
    const profile = await withPortalQuery(account.customer, (views) => views.profile());
    if (profile !== null && profile.display_name !== "") company = profile.display_name;
  } catch {
    company = "Your account";
  }
  const theme = await readTheme();
  return (
    <>
      <Shell company={company} email={account.email} theme={theme} />
      <div className="wrap">{children}</div>
    </>
  );
}
