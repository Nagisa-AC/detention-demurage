export const THEME_COOKIE = "dd_theme";

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

/** Test seam. The layout and the header read the theme through this. */
export function setThemeReader(reader: ThemeReader): void {
  readThemeCookie = reader;
}

/** Light unless the cookie is exactly "dark". The operating system preference is not consulted. */
export async function readTheme(): Promise<ThemeName> {
  const value = await readThemeCookie();
  return value === "dark" ? "dark" : "light";
}
