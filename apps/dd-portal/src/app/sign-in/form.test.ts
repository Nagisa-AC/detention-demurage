import fs from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PASSKEY_FAILED, PASSKEY_WAITING, signInStep, WORK_EMAIL_FIRST } from "./email";
import SignInPage from "./page";

describe("sign-in email gate", () => {
  it("stops both buttons when the email is empty or invalid", () => {
    for (const kind of ["passkey", "code"] as const) {
      expect(signInStep(kind, "")).toEqual({ type: "email", message: WORK_EMAIL_FIRST });
      expect(signInStep(kind, "   ")).toEqual({ type: "email", message: WORK_EMAIL_FIRST });
      expect(signInStep(kind, "not-an-email")).toEqual({ type: "email", message: WORK_EMAIL_FIRST });
      expect(signInStep(kind, `${"a".repeat(250)}@b.co`)).toEqual({ type: "email", message: WORK_EMAIL_FIRST });
    }
    expect(signInStep("passkey", "Person@Example.com")).toEqual({ type: "passkey", email: "person@example.com" });
    expect(signInStep("code", "Person@Example.com")).toEqual({ type: "code", email: "person@example.com" });
  });

  it("puts the work email ahead of both buttons and focuses it", async () => {
    const html = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({}) }));
    const emailAt = html.indexOf('name="email"');
    const passkeyAt = html.indexOf("Continue with passkey");
    const codeAt = html.indexOf("Email me a sign-in code");
    expect(emailAt).toBeGreaterThan(-1);
    expect(emailAt).toBeLessThan(passkeyAt);
    expect(passkeyAt).toBeLessThan(codeAt);
    expect(html).toContain("autofocus");
    expect(html).not.toContain("notice=");
  });

  it("shows the empty-email message under the field and does not echo the query", async () => {
    const html = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({ notice: "email" }) }));
    const field = html.indexOf('name="email"');
    const message = html.indexOf(WORK_EMAIL_FIRST);
    const passkey = html.indexOf("Continue with passkey");
    expect(field).toBeGreaterThan(-1);
    expect(field).toBeLessThan(message);
    expect(message).toBeLessThan(passkey);

    const passkeyNotice = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({ notice: "passkey" }) })).replaceAll(
      "&#x27;",
      "'",
    );
    expect(passkeyNotice).toContain(PASSKEY_FAILED);

    const injected = renderToStaticMarkup(
      await SignInPage({ searchParams: Promise.resolve({ notice: "<script>marker-secret-value</script>" }) }),
    );
    expect(injected).not.toContain("marker-secret-value");
    expect(injected).not.toContain(WORK_EMAIL_FIRST);
  });

  it("keeps an empty email on the page for both buttons", () => {
    const form = fs.readFileSync(new URL("./form.tsx", import.meta.url), "utf8");
    expect(form).toContain('signInStep("code"');
    expect(form).toContain('signInStep("passkey"');
    expect(form).toContain("event.preventDefault()");
    expect(form).toContain("PASSKEY_WAITING");
    expect(form).toContain("disabled={waiting}");
    const words = fs.readFileSync(new URL("./email.ts", import.meta.url), "utf8");
    expect(words).toContain(PASSKEY_WAITING);
    expect(words).toContain(WORK_EMAIL_FIRST);
    expect(form).not.toContain("notice=email");
    expect(form).not.toContain("notice=passkey");
    expect(form).not.toContain("console.");
  });
});

describe("email code lifetime", () => {
  it("says the code expires in three minutes, Cognito's default session", () => {
    const page = fs.readFileSync(new URL("./code/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("expires in 3");
    expect(page).toContain("minutes");
    expect(page).not.toContain("10 minutes");
  });
});
