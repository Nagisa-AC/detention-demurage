/** Pages that do not need a portal session. */
const OPEN = new Set(["/sign-in", "/sign-in/code", "/sign-out"]);

/** Where to send a request that has no verified portal ID token. */
export function unsignedRedirect(pathname: string, hasIdToken: boolean): string | null {
  if (OPEN.has(pathname) || pathname.startsWith("/sign-in/")) return null;
  if (!hasIdToken) return "/sign-in";
  return null;
}
