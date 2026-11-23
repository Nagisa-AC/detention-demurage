import { THEME_COOKIE } from "./auth/cookies";

export { THEME_COOKIE };
export type ThemeName = "light" | "dark";

type ThemeReader = () => Promise<string | undefined>;

let readThemeCookie: ThemeReader = async () => {
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    return jar.get(THEME_COOKIE)?.value;
  } catch {
    return undefined;
  }
};

export function setThemeReader(reader: ThemeReader): void {
  readThemeCookie = reader;
}

/** Light unless the cookie is exactly "dark". */
export async function readTheme(): Promise<ThemeName> {
  const value = await readThemeCookie();
  return value === "dark" ? "dark" : "light";
}
