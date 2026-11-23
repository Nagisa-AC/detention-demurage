export const ID_COOKIE = "portal_id";
export const ACCESS_COOKIE = "portal_access";
export const REFRESH_COOKIE = "portal_refresh";
export const EMAIL_COOKIE = "portal_email";
export const CHALLENGE_COOKIE = "portal_challenge";
export const OFFER_PASSKEY_COOKIE = "portal_offer_passkey";
export const THEME_COOKIE = "portal_theme";

export function sessionCookieOptions(maxAge: number): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}
