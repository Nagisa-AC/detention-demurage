import type { ReactNode } from "react";
import { signOut } from "./app/(signed-in)/sign-out";
import type { Session } from "./session";
import type { ThemeName } from "./theme";
import { ThemeToggle } from "./theme-toggle";

export type ShellTab = "customers" | "review" | "cases";

const TABS: { id: ShellTab; href: string; label: string }[] = [
  { id: "customers", href: "/customers", label: "Customers" },
  { id: "review", href: "/review", label: "Review queue" },
  { id: "cases", href: "/cases", label: "Cases" },
];

/** Header and page frame. The caller has already called requireSession. */
export function Shell({
  session,
  active,
  theme,
  waiting,
  children,
}: {
  session: Session;
  active: ShellTab;
  theme: ThemeName;
  waiting: number | null;
  children?: ReactNode;
}) {
  return (
    <div className="shell">
      <header>
        <div className="logo">D&D Recovery</div>
        <nav aria-label="Main">
          {TABS.map((tab) => (
            <a key={tab.id} href={tab.href} aria-current={tab.id === active ? "page" : undefined}>
              {tab.label}
              {tab.id === "review" && waiting !== null ? <span className="count">{waiting}</span> : null}
            </a>
          ))}
        </nav>
        <div className="user">
          <a href="/firm">Firm</a>
          <ThemeToggle theme={theme} />
          <span>
            {session.name} · MFA on
          </span>
          <span aria-hidden="true">·</span>
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
