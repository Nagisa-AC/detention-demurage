import { NextResponse, type NextRequest } from "next/server";
import { verifyPortalIdToken } from "portal/verify";
import { refreshTokens, type CognitoTokens } from "./auth/cognito";
import { ID_COOKIE, ACCESS_COOKIE, REFRESH_COOKIE, sessionCookieOptions } from "./auth/cookies";
import { unsignedRedirect } from "./auth/gate";

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const idToken = request.cookies.get(ID_COOKIE)?.value ?? null;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value ?? null;
  const verified = idToken === null ? null : await verifyPortalIdToken(idToken);

  if (verified === null && refresh !== null && pathname !== "/sign-out") {
    const next = await refreshTokens(refresh);
    if (next) {
      const redirected = NextResponse.redirect(request.nextUrl);
      write(redirected, next);
      return redirected;
    }
  }

  const signedIn = verified !== null;
  const target = unsignedRedirect(pathname, signedIn);
  if (target !== null) {
    const redirected = NextResponse.redirect(new URL(target, request.url));
    if (!signedIn) clear(redirected);
    return redirected;
  }
  const response = NextResponse.next();
  if (!signedIn) clear(response);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

function write(response: NextResponse, tokens: CognitoTokens): void {
  response.cookies.set(ID_COOKIE, tokens.idToken, sessionCookieOptions(tokens.expiresIn));
  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, sessionCookieOptions(tokens.expiresIn));
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, sessionCookieOptions(60 * 60 * 24 * 30));
}

function clear(response: NextResponse): void {
  const gone = sessionCookieOptions(0);
  response.cookies.set(ID_COOKIE, "", gone);
  response.cookies.set(ACCESS_COOKIE, "", gone);
  response.cookies.set(REFRESH_COOKIE, "", gone);
}
