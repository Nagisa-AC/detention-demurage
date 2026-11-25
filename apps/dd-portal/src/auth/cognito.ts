import { portalRegion } from "portal/verify";

export type CognitoTokens = {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

type AuthFetch = typeof fetch;

let authFetch: AuthFetch = globalThis.fetch.bind(globalThis);

/** Test seam. Production uses fetch with no AWS signature. */
export function setAuthFetch(next: AuthFetch): void {
  authFetch = next;
}

export async function startEmailCode(email: string): Promise<{ session: string } | null> {
  const step = await prefer(email, "EMAIL_OTP");
  if (step === null || step.kind !== "challenge" || step.name !== "EMAIL_OTP" || step.session === "") return null;
  return { session: step.session };
}

export async function submitEmailCode(email: string, session: string, code: string): Promise<CognitoTokens | null> {
  if (!/^\d{8}$/.test(code)) return null;
  const step = await respond(email, session, "EMAIL_OTP", { EMAIL_OTP_CODE: code });
  if (step === null || step.kind !== "tokens") return null;
  return step.tokens;
}

export async function startPasskey(email: string): Promise<{ session: string; options: unknown } | null> {
  const step = await prefer(email, "WEB_AUTHN");
  if (step === null || step.kind !== "challenge" || step.name !== "WEB_AUTHN") return null;
  const options = jsonField(step.parameters.CREDENTIAL_REQUEST_OPTIONS);
  if (options === null || step.session === "") return null;
  return { session: step.session, options };
}

export async function submitPasskey(email: string, session: string, credential: unknown): Promise<CognitoTokens | null> {
  const step = await respond(email, session, "WEB_AUTHN", { CREDENTIAL: JSON.stringify(credential) });
  if (step === null || step.kind !== "tokens") return null;
  return step.tokens;
}

export async function refreshTokens(refreshToken: string): Promise<CognitoTokens | null> {
  const clientId = client();
  if (clientId === null || refreshToken === "") return null;
  const body = await call("InitiateAuth", {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: clientId,
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });
  return body === null ? null : readTokens(body, refreshToken);
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const clientId = client();
  if (clientId === null || refreshToken === "") return;
  await call("RevokeToken", { Token: refreshToken, ClientId: clientId });
}

export async function startPasskeyRegistration(accessToken: string): Promise<unknown | null> {
  const body = await call("StartWebAuthnRegistration", { AccessToken: accessToken });
  if (body === null) return null;
  const options = body.CredentialCreationOptions;
  return options === undefined ? null : options;
}

export async function finishPasskeyRegistration(accessToken: string, credential: unknown): Promise<boolean> {
  const body = await call("CompleteWebAuthnRegistration", { AccessToken: accessToken, Credential: credential });
  return body !== null;
}

/** True when the user has a passkey, false when the list is empty, null when the check failed. */
export async function hasPasskey(accessToken: string): Promise<boolean | null> {
  const body = await call("ListWebAuthnCredentials", { AccessToken: accessToken, MaxResults: 20 });
  if (body === null) return null;
  const credentials = body.Credentials;
  if (!Array.isArray(credentials)) return null;
  return credentials.length > 0;
}

type Step =
  | { kind: "tokens"; tokens: CognitoTokens }
  | { kind: "challenge"; name: string; session: string; parameters: Record<string, string> };

async function prefer(email: string, preferred: "EMAIL_OTP" | "WEB_AUTHN"): Promise<Step | null> {
  const clientId = client();
  if (clientId === null) return null;
  const body = await call("InitiateAuth", {
    AuthFlow: "USER_AUTH",
    ClientId: clientId,
    AuthParameters: { USERNAME: email, PREFERRED_CHALLENGE: preferred },
  });
  const step = body === null ? null : readStep(body);
  if (step === null || step.kind === "tokens") return step;
  if (step.name !== "SELECT_CHALLENGE") return step;
  return respond(email, step.session, "SELECT_CHALLENGE", { ANSWER: preferred });
}

async function respond(
  email: string,
  session: string,
  name: string,
  responses: Record<string, string>,
): Promise<Step | null> {
  const clientId = client();
  if (clientId === null || session === "") return null;
  const body = await call("RespondToAuthChallenge", {
    ChallengeName: name,
    ClientId: clientId,
    Session: session,
    ChallengeResponses: { USERNAME: email, ...responses },
  });
  return body === null ? null : readStep(body);
}

function readStep(body: Record<string, unknown>): Step | null {
  const tokens = readTokens(body);
  if (tokens) return { kind: "tokens", tokens };
  const name = stringField(body.ChallengeName);
  const session = stringField(body.Session);
  if (name === null || session === null) return null;
  return { kind: "challenge", name, session, parameters: stringMap(body.ChallengeParameters) };
}

function readTokens(body: Record<string, unknown>, previousRefresh = ""): CognitoTokens | null {
  const result = body.AuthenticationResult;
  if (typeof result !== "object" || result === null) return null;
  const record = result as Record<string, unknown>;
  const idToken = stringField(record.IdToken);
  const accessToken = stringField(record.AccessToken);
  const refreshToken = stringField(record.RefreshToken) ?? (previousRefresh === "" ? null : previousRefresh);
  const expiresIn = typeof record.ExpiresIn === "number" && record.ExpiresIn > 0 ? record.ExpiresIn : 3600;
  if (idToken === null || accessToken === null || refreshToken === null) return null;
  return { idToken, accessToken, refreshToken, expiresIn };
}

async function call(action: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const region = portalRegion();
  if (region === null) return null;
  try {
    const response = await authFetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

function client(): string | null {
  const value = process.env.PORTAL_COGNITO_CLIENT_ID;
  if (value === undefined || value === "") return null;
  return value;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function stringMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

function jsonField(value: string | undefined): unknown | null {
  if (value === undefined || value === "") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
