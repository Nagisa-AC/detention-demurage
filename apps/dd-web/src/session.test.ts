import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAccountName } from "./app/(signed-in)/account";
import { signOut } from "./app/(signed-in)/sign-out";
import { accountWasRead, resetAccountRead } from "./app/(signed-in)/account-work";
import { GET } from "./app/api/session/route";
import { resetSessionRoute, sessionRouteRan } from "./app/api/session/work";
import { signIn } from "./app/sign-in/actions";
import {
  establishSession,
  exchangePasswordAndTotp,
  sessionFromClaims,
  verifyIdToken,
} from "./cognito";
import { setLog } from "./log";
import {
  encodeSession,
  openSession,
  readSession,
  requireSession,
  resetCookieClearer,
  sessionCookieOptions,
  setCookieClearer,
  setCookieReader,
} from "./session";

const redirectCalls = vi.hoisted(() => ({ urls: [] as string[] }));

vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    redirectCalls.urls.push(url);
    const error = new Error("NEXT_REDIRECT");
    (error as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${url};307`;
    throw error;
  },
}));

const SECRET = "test-session-secret";
const NOW = 1_700_000_000_000;
const ENV_KEYS = [
  "DD_SESSION_SECRET",
  "COGNITO_REGION",
  "COGNITO_USER_POOL_ID",
  "COGNITO_CLIENT_ID",
  "COGNITO_CLIENT_SECRET",
] as const;

let saved: Map<string, string | undefined>;
let logs: string[];

beforeEach(() => {
  saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  logs = [];
  redirectCalls.urls.length = 0;
  resetSessionRoute();
  resetAccountRead();
  resetCookieClearer();
  setLog((line) => {
    logs.push(line);
  });
  setCookieReader(async () => undefined);
  process.env.DD_SESSION_SECRET = SECRET;
  delete process.env.COGNITO_REGION;
  delete process.env.COGNITO_USER_POOL_ID;
  delete process.env.COGNITO_CLIENT_ID;
  delete process.env.COGNITO_CLIENT_SECRET;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function cookie(input: { name: string; exp: number; mfa: boolean }, secret = SECRET): string {
  return encodeSession(input, secret);
}

describe("session cookie", () => {
  it("returns null without a secret, a cookie, a good signature, a future exp, or completed MFA", async () => {
    delete process.env.DD_SESSION_SECRET;
    setCookieReader(async () => cookie({ name: "Ibrahim", exp: NOW / 1000 + 60, mfa: true }));
    await expect(readSession(NOW)).resolves.toBeNull();

    process.env.DD_SESSION_SECRET = SECRET;
    setCookieReader(async () => undefined);
    await expect(readSession(NOW)).resolves.toBeNull();

    const valid = cookie({ name: "Ibrahim", exp: NOW / 1000 + 60, mfa: true });
    expect(openSession(`${valid}x`, SECRET, NOW)).toBeNull();
    expect(openSession(cookie({ name: "Ibrahim", exp: NOW / 1000 + 60, mfa: true }, "other"), SECRET, NOW)).toBeNull();
    expect(openSession(cookie({ name: "Ibrahim", exp: NOW / 1000 - 60, mfa: true }), SECRET, NOW)).toBeNull();
    expect(openSession(cookie({ name: "Ibrahim", exp: NOW / 1000 + 60, mfa: false }), SECRET, NOW)).toBeNull();
    expect(openSession(valid, SECRET, NOW)).toEqual({ name: "Ibrahim" });
  });

  it("sets an httpOnly cookie", () => {
    expect(sessionCookieOptions(true)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 12 * 60 * 60,
    });
  });
});

describe("requireSession", () => {
  it("redirects a page when the session is missing, bad, expired, or missing MFA", async () => {
    const cases = [
      undefined,
      "not-a-cookie",
      cookie({ name: "Ibrahim", exp: NOW / 1000 - 60, mfa: true }),
      cookie({ name: "Ibrahim", exp: NOW / 1000 + 3600, mfa: false }),
    ];
    for (const raw of cases) {
      redirectCalls.urls.length = 0;
      logs.length = 0;
      setCookieReader(async () => raw);
      await expect(requireSession({ path: "/review" })).rejects.toMatchObject({
        digest: expect.stringContaining("/sign-in"),
      });
      expect(redirectCalls.urls).toEqual(["/sign-in"]);
      expect(logs).toEqual(["path /review session no"]);
      expect(logs.join("\n")).not.toContain("marker-secret-value");
    }
  });

  it("returns the name when MFA is complete", async () => {
    setCookieReader(async () => cookie({ name: "Ibrahim", exp: Math.floor(Date.now() / 1000) + 60, mfa: true }));
    await expect(requireSession({ path: "/review" })).resolves.toEqual({ name: "Ibrahim" });
    expect(redirectCalls.urls).toEqual([]);
    expect(logs).toEqual(["path /review session yes"]);
  });

  it("throws for a route handler and does not redirect", async () => {
    setCookieReader(async () => undefined);
    await expect(requireSession({ path: "/api/session", kind: "route" })).rejects.toMatchObject({
      name: "SessionRequired",
    });
    expect(redirectCalls.urls).toEqual([]);
  });
});

describe("route handler", () => {
  it("returns 401 and runs nothing without a session", async () => {
    setCookieReader(async () => "marker-secret-value");
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(sessionRouteRan()).toBe(false);
    expect(logs).toEqual(["path /api/session session no"]);
    expect(logs.join("\n")).not.toContain("marker-secret-value");
  });

  it("returns the name only after the session check", async () => {
    setCookieReader(async () =>
      cookie({ name: "marker-secret-value", exp: Math.floor(Date.now() / 1000) + 60, mfa: true }),
    );
    const response = await GET();
    expect(response.status).toBe(200);
    expect(sessionRouteRan()).toBe(true);
    await expect(response.json()).resolves.toEqual({ name: "marker-secret-value" });
    expect(logs).toEqual(["path /api/session session yes"]);
    expect(logs.join("\n")).not.toContain("marker-secret-value");
  });
});

describe("server action", () => {
  it("does not run its body without a session", async () => {
    setCookieReader(async () => undefined);
    await expect(readAccountName()).rejects.toMatchObject({ digest: expect.stringContaining("/sign-in") });
    expect(accountWasRead()).toBe(false);
  });

  it("returns the name when the session is valid", async () => {
    setCookieReader(async () => cookie({ name: "Ibrahim", exp: Math.floor(Date.now() / 1000) + 60, mfa: true }));
    await expect(readAccountName()).resolves.toBe("Ibrahim");
    expect(accountWasRead()).toBe(true);
  });
});

describe("sign-out", () => {
  it("clears the session cookie and redirects to sign-in", async () => {
    setCookieReader(async () => cookie({ name: "Ibrahim", exp: Math.floor(Date.now() / 1000) + 60, mfa: true }));
    let cleared = false;
    setCookieClearer(async () => {
      cleared = true;
    });
    await expect(signOut()).rejects.toMatchObject({ digest: expect.stringContaining("/sign-in") });
    expect(cleared).toBe(true);
    expect(redirectCalls.urls).toEqual(["/sign-in"]);
    expect(logs).toEqual(["path /sign-out session yes"]);
    expect(logs.join("\n")).not.toContain("Ibrahim");
    setCookieReader(async () => undefined);
    await expect(readSession()).resolves.toBeNull();
  });

  it("does not clear the cookie when there is no session", async () => {
    setCookieReader(async () => undefined);
    let cleared = false;
    setCookieClearer(async () => {
      cleared = true;
    });
    await expect(signOut()).rejects.toMatchObject({ digest: expect.stringContaining("/sign-in") });
    expect(cleared).toBe(false);
    expect(redirectCalls.urls).toEqual(["/sign-in"]);
  });
});

describe("sign-in", () => {
  it("does not call Cognito or set a cookie when sign-in is not configured", async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
    const form = new FormData();
    form.set("email", "ada@example.com");
    form.set("password", "marker-secret-value");
    form.set("code", "123456");
    await expect(signIn(form)).rejects.toMatchObject({ digest: expect.stringContaining("/sign-in?error=config") });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logs.join("\n")).not.toContain("marker-secret-value");
    expect(logs).toEqual(["path /sign-in session no"]);
  });

  it("does not set a cookie when the token has no MFA", async () => {
    process.env.COGNITO_USER_POOL_ID = "us-east-2_TestPool";
    process.env.COGNITO_CLIENT_ID = "client";
    const fetchSpy = vi.fn<typeof fetch>(async () => Response.json({ AuthenticationResult: { IdToken: "not-a-jwt" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const form = new FormData();
    form.set("email", "ada@example.com");
    form.set("password", "marker-secret-value");
    form.set("code", "123456");
    await expect(signIn(form)).rejects.toMatchObject({ digest: expect.stringContaining("/sign-in?error=failed") });
    expect(logs.join("\n")).not.toContain("marker-secret-value");
    expect(logs.join("\n")).not.toContain("ada@example.com");
  });
});

describe("Cognito claims", () => {
  const future = NOW / 1000 + 60;

  it("accepts an ID token only when amr includes MFA", () => {
    expect(sessionFromClaims({ token_use: "id", exp: future, amr: ["pwd"], name: "Ibrahim" }, NOW)).toBeNull();
    expect(sessionFromClaims({ token_use: "access", exp: future, amr: ["pwd", "mfa"], name: "Ibrahim" }, NOW)).toBeNull();
    expect(sessionFromClaims({ token_use: "id", exp: NOW / 1000 - 60, amr: ["pwd", "mfa"], name: "Ibrahim" }, NOW)).toBeNull();
    expect(sessionFromClaims({ token_use: "id", exp: future, amr: ["pwd", "mfa"], name: "Ibrahim" }, NOW)).toEqual({
      name: "Ibrahim",
    });
    expect(sessionFromClaims({ token_use: "id", exp: future, amr: ["software_token"], name: "Ibrahim" }, NOW)).toEqual({
      name: "Ibrahim",
    });
  });

  it("does not fetch JWKS when the pool is not configured", async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(verifyIdToken("not-a-jwt")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("talks to Cognito in us-east-2 and refuses a non-US region without calling it", async () => {
    process.env.COGNITO_USER_POOL_ID = "us-east-2_TestPool";
    process.env.COGNITO_CLIENT_ID = "client";
    const calls: { url: string; body: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
      if (calls.length === 1) {
        return Response.json({ ChallengeName: "SOFTWARE_TOKEN_MFA", Session: "challenge-session" });
      }
      return Response.json({ AuthenticationResult: { IdToken: "header.payload.sig" } });
    };
    const exchanged = await exchangePasswordAndTotp(
      { email: "ada@example.com", password: "marker-secret-value", code: "654321" },
      fetchImpl,
    );
    expect(exchanged).toEqual({ idToken: "header.payload.sig" });
    expect(calls.map((call) => call.url)).toEqual([
      "https://cognito-idp.us-east-2.amazonaws.com/",
      "https://cognito-idp.us-east-2.amazonaws.com/",
    ]);
    const second = calls[1];
    expect(second).toBeDefined();
    expect(second?.body).toContain("654321");
    expect(second?.body).toContain("SOFTWARE_TOKEN_MFA");

    calls.length = 0;
    process.env.COGNITO_REGION = "eu-west-1";
    const blocked = await exchangePasswordAndTotp(
      { email: "ada@example.com", password: "marker-secret-value", code: "654321" },
      fetchImpl,
    );
    expect(blocked).toEqual({ error: "config" });
    expect(calls).toEqual([]);
  });

  it("sends a secret hash and not the client secret", async () => {
    process.env.COGNITO_USER_POOL_ID = "us-east-2_TestPool";
    process.env.COGNITO_CLIENT_ID = "client";
    process.env.COGNITO_CLIENT_SECRET = "client-secret-marker";
    let body = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      body = typeof init?.body === "string" ? init.body : "";
      return Response.json({ ChallengeName: "SMS_MFA", Session: "nope" });
    };
    const result = await exchangePasswordAndTotp(
      { email: "ada@example.com", password: "marker-secret-value", code: "000000" },
      fetchImpl,
    );
    expect(result).toEqual({ error: "failed" });
    expect(body).toContain("SECRET_HASH");
    expect(body).not.toContain("client-secret-marker");
  });

  it("writes a cookie only when the verified token has MFA", async () => {
    const writes: string[] = [];
    const missing = await establishSession(
      { email: "ada@example.com", password: "marker-secret-value", code: "123456" },
      {
        exchange: async () => ({ idToken: "token" }),
        verify: async () => null,
        writeCookie: async (token) => {
          writes.push(token);
        },
        secret: SECRET,
        now: NOW,
      },
    );
    expect(missing).toEqual({ ok: false, reason: "failed" });
    expect(writes).toEqual([]);
    expect(logs.join("\n")).not.toContain("marker-secret-value");

    logs.length = 0;
    const ready = await establishSession(
      { email: "ada@example.com", password: "marker-secret-value", code: "123456" },
      {
        exchange: async () => ({ idToken: "token" }),
        verify: async () => ({ name: "Ibrahim" }),
        writeCookie: async (token) => {
          writes.push(token);
        },
        secret: SECRET,
        now: NOW,
      },
    );
    expect(ready).toEqual({ ok: true });
    const token = writes[0];
    expect(token).toBeDefined();
    if (token === undefined) return;
    expect(openSession(token, SECRET, NOW)).toEqual({ name: "Ibrahim" });
    expect(logs).toEqual(["path /sign-in session yes"]);
    expect(logs.join("\n")).not.toContain("marker-secret-value");
    expect(logs.join("\n")).not.toContain("ada@example.com");
  });
});
