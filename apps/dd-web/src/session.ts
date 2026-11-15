import { createHmac, timingSafeEqual } from "node:crypto";
import { logRequest } from "./log";

export const SESSION_COOKIE = "dd_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export type Session = { name: string };

export class SessionRequired extends Error {
  constructor() {
    super("session required");
    this.name = "SessionRequired";
  }
}

export function isSessionRequired(error: unknown): error is SessionRequired {
  return error instanceof SessionRequired || (error instanceof Error && error.name === "SessionRequired");
}

type CookieReader = () => Promise<string | undefined>;

let cookieReader: CookieReader = async () => {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
};

/** Test seam. Pages and handlers read the cookie through this. */
export function setCookieReader(reader: CookieReader): void {
  cookieReader = reader;
}

export function sessionCookieOptions(secure: boolean): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export async function writeSessionCookie(token: string): Promise<void> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions(process.env.NODE_ENV === "production"));
}

const defaultClearCookie = async (): Promise<void> => {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { ...sessionCookieOptions(process.env.NODE_ENV === "production"), maxAge: 0 });
};

let clearCookie = defaultClearCookie;

/** Test seam. Sign-out clears the cookie through this. */
export function setCookieClearer(fn: () => Promise<void>): void {
  clearCookie = fn;
}

export function resetCookieClearer(): void {
  clearCookie = defaultClearCookie;
}

export async function clearSessionCookie(): Promise<void> {
  await clearCookie();
}

export function encodeSession(input: { name: string; exp: number; mfa: boolean }, secret: string): string {
  const body = Buffer.from(JSON.stringify({ name: input.name, exp: input.exp, mfa: input.mfa }), "utf8").toString(
    "base64url",
  );
  return `${body}.${sign(body, secret)}`;
}

export function openSession(raw: string, secret: string, now = Date.now()): Session | null {
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  if (!macMatches(mac, sign(body, secret))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (record.mfa !== true) return null;
  if (typeof record.name !== "string" || record.name.trim() === "" || record.name.length > 200) return null;
  if (typeof record.exp !== "number" || !Number.isFinite(record.exp) || record.exp * 1000 <= now) return null;
  return { name: record.name };
}

export async function readSession(now = Date.now()): Promise<Session | null> {
  const secret = process.env.DD_SESSION_SECRET;
  if (secret === undefined || secret === "") return null;
  const raw = await cookieReader();
  if (raw === undefined || raw === "") return null;
  return openSession(raw, secret, now);
}

/**
 * Session is valid only when the cookie checks out and MFA was completed.
 * Pages and server actions redirect. Route handlers pass kind "route" and
 * answer 401 themselves. The shared layout is an extra layer, not this check.
 */
export async function requireSession(options?: { kind?: "page" | "route"; path?: string }): Promise<Session> {
  const kind = options?.kind ?? "page";
  const path = options?.path ?? "unknown";
  const session = await readSession();
  if (session === null) {
    logRequest(path, false);
    if (kind === "route") throw new SessionRequired();
    const { redirect } = await import("next/navigation");
    redirect("/sign-in");
    throw new SessionRequired();
  }
  logRequest(path, true);
  return session;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function macMatches(mac: string, expected: string): boolean {
  const actual = Buffer.from(mac);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length) return false;
  return timingSafeEqual(actual, wanted);
}
