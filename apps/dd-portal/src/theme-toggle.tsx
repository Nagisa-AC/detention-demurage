"use client";

import { useState } from "react";
import { THEME_COOKIE, type ThemeName } from "./theme";

const YEAR = 60 * 60 * 24 * 365;

export function ThemeToggle({ theme }: { theme: ThemeName }) {
  const [current, setCurrent] = useState(theme);

  function choose(next: ThemeName): void {
    setCurrent(next);
    document.documentElement.dataset.theme = next;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=${YEAR}; SameSite=Lax${secure}`;
  }

  return (
    <div className="theme" role="group" aria-label="Theme">
      <button type="button" aria-pressed={current === "light"} onClick={() => choose("light")}>
        Light
      </button>
      <button type="button" aria-pressed={current === "dark"} onClick={() => choose("dark")}>
        Dark
      </button>
    </div>
  );
}
