"use client";

import { usePathname } from "next/navigation";
import { signOut } from "./app/sign-out-action";
import { ThemeToggle } from "./theme-toggle";
import type { ThemeName } from "./theme";

export function Shell({
  company,
  email,
  theme,
}: {
  company: string;
  email: string | null;
  theme: ThemeName;
}) {
  const path = usePathname();
  const invoices = path.startsWith("/invoices");
  return (
    <header className="bar">
      <div className="logo">
        <i />
        Tidemark Recovery
      </div>
      <nav>
        <a className={path === "/" ? "on" : ""} href="/">
          Home
        </a>
        <a className={invoices ? "on" : ""} href="/invoices">
          Invoices
        </a>
      </nav>
      <div className="user">
        <span className="co">{company}</span>
        {email === null ? null : <span className="email">{email}</span>}
        <form action={signOut}>
          <button className="linkish" type="submit">
            Sign out
          </button>
        </form>
        <ThemeToggle theme={theme} />
      </div>
    </header>
  );
}
