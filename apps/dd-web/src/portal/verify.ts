import { createRemoteJWKSet, jwtVerify } from "jose";

export function portalRegion(): string | null {
  const value = process.env.PORTAL_COGNITO_REGION ?? "us-east-2";
  if (!/^us-[a-z0-9-]+$/.test(value)) return null;
  return value;
}

/** A portal ID token. The staff pool and a customer id claim are not accepted. */
export async function verifyPortalIdToken(token: string, now = Date.now()): Promise<{ sub: string } | null> {
  const region = portalRegion();
  const pool = process.env.PORTAL_COGNITO_USER_POOL_ID;
  const clientId = process.env.PORTAL_COGNITO_CLIENT_ID;
  if (region === null || pool === undefined || pool === "" || clientId === undefined || clientId === "") return null;
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${pool}`;
  try {
    const { payload } = await jwtVerify(token, createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)), {
      issuer,
      audience: clientId,
    });
    if (payload.token_use !== undefined && payload.token_use !== "id") return null;
    const exp = payload.exp;
    if (typeof exp !== "number" || !Number.isFinite(exp) || exp * 1000 <= now) return null;
    if (typeof payload.sub !== "string" || payload.sub.trim() === "") return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}
