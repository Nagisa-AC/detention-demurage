import type { ReactNode } from "react";
import { signOut } from "./app/(signed-in)/sign-out";
import type { Session } from "./session";

export type ShellTab = "customers" | "review" | "cases";

const TABS: { id: ShellTab; href: string; label: string }[] = [
  { id: "customers", href: "/customers", label: "Customers" },
  { id: "review", href: "/review", label: "Review queue" },
  { id: "cases", href: "/cases", label: "Cases" },
];

/** Header and page frame. The caller has already called requireSession. */
export function Shell({ session, active, children }: { session: Session; active: ShellTab; children?: ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="wordmark">D&D Recovery</div>
        <nav className="nav" aria-label="Main">
          {TABS.map((tab) =>
            tab.id === active ? (
              <a key={tab.id} href={tab.href} aria-current="page">
                {tab.label}
              </a>
            ) : (
              <a key={tab.id} href={tab.href}>
                {tab.label}
              </a>
            ),
          )}
        </nav>
        <div className="account">
          <span>
            {session.name} · MFA on
          </span>
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </header>
      <main className="frame">{children}</main>
    </div>
  );
}
