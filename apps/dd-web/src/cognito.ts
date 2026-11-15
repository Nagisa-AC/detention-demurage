import { createHmac } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { logRequest } from "./log";
import { encodeSession, SESSION_TTL_SECONDS, writeSessionCookie } from "./session";

const MFA_METHODS = new Set(["mfa", "software_token", "otp", "sms", "totp"]);

export function cognitoRegion(): string | null {
  const value = process.env.COGNITO_REGION ?? "us-east-2";
  if (!/^us-[a-z0-9-]+$/.test(value)) return null;
  return value;
}

/** A Cognito ID token counts only when its amr claim shows MFA. */
export function sessionFromClaims(payload: { [key: string]: unknown }, now = Date.now()): { name: string } | null {
  if (payload.token_use !== undefined && payload.token_use !== "id") return null;
  const exp = payload.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp * 1000 <= now) return null;
  const amr = payload.amr;
  if (!Array.isArray(amr) || !amr.some((item) => typeof item === "string" && MFA_METHODS.has(item))) return null;
  const name = displayName(payload);
  if (name === null) return null;
  return { name };
}

export async function verifyIdToken(token: string, now = Date.now()): Promise<{ name: string } | null> {
  const region = cognitoRegion();
  const pool = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (region === null || pool === undefined || pool === "" || clientId === undefined || clientId === "") return null;
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${pool}`;
  try {
    const { payload } = await jwtVerify(token, createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)), {
      issuer,
      audience: clientId,
    });
    return sessionFromClaims(payload, now);
  } catch {
    return null;
  }
}

type ExchangeResult = { idToken: string } | { error: "config" | "failed" };

export async function exchangePasswordAndTotp(
  input: { email: string; password: string; code: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeResult> {
  const region = cognitoRegion();
  const clientId = process.env.COGNITO_CLIENT_ID;
  const pool = process.env.COGNITO_USER_POOL_ID;
  if (region === null || clientId === undefined || clientId === "" || pool === undefined || pool === "") {
    return { error: "config" };
  }
  const secret = process.env.COGNITO_CLIENT_SECRET;
  const authParameters: Record<string, string> = {
    USERNAME: input.email,
    PASSWORD: input.password,
  };
  if (secret !== undefined && secret !== "") {
    authParameters.SECRET_HASH = secretHash(input.email, clientId, secret);
  }
  const started = await cognito(fetchImpl, region, "InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: clientId,
    AuthParameters: authParameters,
  });
  if (started === null) return { error: "failed" };
  const direct = tokenOf(started);
  if (direct !== null) return { idToken: direct };
  if (started.ChallengeName !== "SOFTWARE_TOKEN_MFA" || typeof started.Session !== "string") return { error: "failed" };
  const responses: Record<string, string> = {
    USERNAME: input.email,
    SOFTWARE_TOKEN_MFA_CODE: input.code,
  };
  if (secret !== undefined && secret !== "") responses.SECRET_HASH = secretHash(input.email, clientId, secret);
  const responded = await cognito(fetchImpl, region, "RespondToAuthChallenge", {
    ChallengeName: "SOFTWARE_TOKEN_MFA",
    ClientId: clientId,
    Session: started.Session,
    ChallengeResponses: responses,
  });
  if (responded === null) return { error: "failed" };
  const token = tokenOf(responded);
  if (token === null) return { error: "failed" };
  return { idToken: token };
}

export type EstablishDeps = {
  exchange?: typeof exchangePasswordAndTotp;
  verify?: (token: string) => Promise<{ name: string } | null>;
  writeCookie?: (token: string) => Promise<void>;
  now?: number;
  secret?: string;
};

/** Sets a session cookie only after the ID token shows MFA. Does not log the form. */
export async function establishSession(
  input: { email: string; password: string; code: string },
  deps: EstablishDeps = {},
): Promise<{ ok: true } | { ok: false; reason: "config" | "failed" }> {
  const exchange = deps.exchange ?? exchangePasswordAndTotp;
  const verify = deps.verify ?? verifyIdToken;
  const writeCookie = deps.writeCookie ?? writeSessionCookie;
  let exchanged: ExchangeResult;
  try {
    exchanged = await exchange(input);
  } catch {
    logRequest("/sign-in", false);
    return { ok: false, reason: "failed" };
  }
  if ("error" in exchanged) {
    logRequest("/sign-in", false);
    return { ok: false, reason: exchanged.error };
  }
  const claims = await verify(exchanged.idToken);
  if (claims === null) {
    logRequest("/sign-in", false);
    return { ok: false, reason: "failed" };
  }
  const secret = deps.secret ?? process.env.DD_SESSION_SECRET;
  if (secret === undefined || secret === "") {
    logRequest("/sign-in", false);
    return { ok: false, reason: "config" };
  }
  const now = deps.now ?? Date.now();
  const token = encodeSession(
    { name: claims.name, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS, mfa: true },
    secret,
  );
  await writeCookie(token);
  logRequest("/sign-in", true);
  return { ok: true };
}

type CognitoBody = {
  AuthenticationResult?: { IdToken?: string };
  ChallengeName?: string;
  Session?: string;
};

async function cognito(
  fetchImpl: typeof fetch,
  region: string,
  action: "InitiateAuth" | "RespondToAuthChallenge",
  payload: Record<string, unknown>,
): Promise<CognitoBody | null> {
  try {
    const response = await fetchImpl(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const parsed: unknown = await response.json();
    if (parsed === null || typeof parsed !== "object") return null;
    return parsed as CognitoBody;
  } catch {
    return null;
  }
}

function tokenOf(body: CognitoBody): string | null {
  const token = body.AuthenticationResult?.IdToken;
  return typeof token === "string" && token !== "" ? token : null;
}

function secretHash(username: string, clientId: string, secret: string): string {
  return createHmac("sha256", secret).update(username + clientId).digest("base64");
}

function displayName(payload: { [key: string]: unknown }): string | null {
  for (const key of ["name", "given_name", "cognito:username"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim() !== "" && value.length <= 200) return value.trim();
  }
  const email = payload.email;
  if (typeof email === "string" && email.includes("@")) {
    const local = email.split("@")[0];
    if (local !== undefined && local.trim() !== "") return local.trim();
  }
  return null;
}
