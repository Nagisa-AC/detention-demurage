import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import SignedInLayout from "./app/(signed-in)/layout";
import CasesPage from "./app/(signed-in)/cases/page";
import CustomersPage from "./app/(signed-in)/customers/page";
import HomePage from "./app/(signed-in)/page";
import ReviewPage from "./app/(signed-in)/review/page";
import SignInPage from "./app/sign-in/page";
import { setLog } from "./log";
import { encodeSession, setCookieReader } from "./session";

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
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
let logs: string[];

beforeEach(() => {
  logs = [];
  redirectCalls.urls.length = 0;
  process.env.DD_SESSION_SECRET = SECRET;
  setLog((line) => {
    logs.push(line);
  });
  setCookieReader(async () => undefined);
});

afterEach(() => {
  delete process.env.DD_SESSION_SECRET;
});

function useSession(name: string): void {
  const token = encodeSession({ name, exp: Math.floor(Date.now() / 1000) + 3600, mfa: true }, SECRET);
  setCookieReader(async () => token);
}

describe("shell", () => {
  it("redirects each signed-in page when there is no session, and the body is not the shell", async () => {
    const pages = [HomePage, CustomersPage, ReviewPage, CasesPage];
    for (const page of pages) {
      redirectCalls.urls.length = 0;
      await expect(page()).rejects.toMatchObject({ digest: expect.stringContaining("/sign-in") });
      expect(redirectCalls.urls).toEqual(["/sign-in"]);
    }
    await expect(SignedInLayout({ children: createElement("p", null, "shell-child") })).rejects.toMatchObject({
      digest: expect.stringContaining("/sign-in"),
    });
  });

  it("renders the header for a completed MFA session and marks the active tab", async () => {
    useSession("Ibrahim");
    const review = renderToStaticMarkup(await ReviewPage());
    expect(review).toContain("D&amp;D Recovery");
    expect(review).toContain("Ibrahim · MFA on");
    expect(review).toContain("Sign out");
    expect(review).toContain("Customers");
    expect(review).toContain("Review queue");
    expect(review).toContain("Cases");
    expect(review).toContain('aria-label="Main"');
    expect(review).toContain('href="/review" aria-current="page"');
    expect(review).not.toContain('href="/customers" aria-current');
    expect(review.split('aria-current="page"').length - 1).toBe(1);
    expect(logs).toEqual(["path /review session yes"]);
    expect(logs.join("\n")).not.toContain("Ibrahim");

    const customers = renderToStaticMarkup(await CustomersPage());
    expect(customers).toContain('href="/customers" aria-current="page"');
    const cases = renderToStaticMarkup(await CasesPage());
    expect(cases).toContain('href="/cases" aria-current="page"');
  });

  it("renders a display name that contains a tag as text", async () => {
    useSession("<img src=x onerror=alert(1)>");
    const html = renderToStaticMarkup(await ReviewPage());
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; · MFA on");
  });

  it("sends / to customers only after the session check", async () => {
    useSession("Ibrahim");
    await expect(HomePage()).rejects.toMatchObject({ digest: expect.stringContaining("/customers") });
    expect(redirectCalls.urls).toEqual(["/customers"]);
  });

  it("keeps the layout as an extra layer that still redirects", async () => {
    useSession("Ibrahim");
    const result = await SignedInLayout({ children: createElement("p", null, "shell-child") });
    expect(renderToStaticMarkup(createElement("div", null, result))).toContain("shell-child");
    expect(logs).toContain("path layout session yes");
  });

  it("uses the reference colors and self-hosts Inter", () => {
    const css = fs.readFileSync(path.join(appDir, "app/globals.css"), "utf8");
    for (const token of ["#F4F5F7", "#14181F", "#1F4FB8", "#163A8A", "#C9CED8", "#2A303B", "14px 32px", "24px 32px"]) {
      expect(css).toContain(token);
    }
    const layout = fs.readFileSync(path.join(appDir, "app/layout.tsx"), "utf8");
    expect(layout).toContain('next/font/google');
    expect(layout).toContain('"400"');
    expect(layout).toContain('"700"');
    expect(layout).not.toContain("fonts.googleapis.com");
    expect(layout).not.toContain("requireSession(");
  });
});

describe("sign-in page", () => {
  it("asks for email, password, and an authenticator code", async () => {
    const html = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Email");
    expect(html).toContain("Password");
    expect(html).toContain("Authenticator code");
    expect(html).not.toContain("MFA on");
    expect(html).not.toContain("Review queue");
  });

  it("shows a fixed error and ignores any other query value", async () => {
    const failed = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({ error: "failed" }) }));
    expect(failed).toContain("Sign-in failed.");
    const config = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({ error: "config" }) }));
    expect(config).toContain("Sign-in is not configured.");
    const injected = renderToStaticMarkup(
      await SignInPage({ searchParams: Promise.resolve({ error: "<script>marker-secret-value</script>" }) }),
    );
    expect(injected).not.toContain("marker-secret-value");
    expect(injected).not.toContain("Sign-in failed.");
  });
});
