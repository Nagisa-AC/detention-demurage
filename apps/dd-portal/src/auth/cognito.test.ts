import { afterEach, describe, expect, it } from "vitest";
import { setAuthFetch, startEmailCode, submitEmailCode } from "./cognito";

afterEach(() => {
  setAuthFetch(globalThis.fetch.bind(globalThis));
  delete process.env.PORTAL_COGNITO_CLIENT_ID;
  delete process.env.PORTAL_COGNITO_REGION;
});

describe("portal cognito", () => {
  it("asks for an email code without an AWS signature and hides a missing account", async () => {
    process.env.PORTAL_COGNITO_CLIENT_ID = "portal-client";
    process.env.PORTAL_COGNITO_REGION = "us-east-2";
    const calls: { url: string; headers: Headers; body: string }[] = [];
    setAuthFetch(async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), headers, body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ __type: "UserNotFoundException", message: "User does not exist." }), { status: 400 });
    });
    expect(await startEmailCode("person@example.com")).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get("authorization")).toBeNull();
    expect(calls[0]?.headers.get("x-amz-target")).toBe("AWSCognitoIdentityProviderService.InitiateAuth");
    const body = JSON.parse(calls[0]?.body ?? "{}") as { AuthFlow?: string; AuthParameters?: { PREFERRED_CHALLENGE?: string } };
    expect(body.AuthFlow).toBe("USER_AUTH");
    expect(body.AuthParameters?.PREFERRED_CHALLENGE).toBe("EMAIL_OTP");
  });

  it("returns tokens from a code and nothing when the code is refused", async () => {
    process.env.PORTAL_COGNITO_CLIENT_ID = "portal-client";
    setAuthFetch(async () => new Response(JSON.stringify({
      AuthenticationResult: { IdToken: "id", AccessToken: "access", RefreshToken: "refresh", ExpiresIn: 3600 },
    }), { status: 200 }));
    expect(await submitEmailCode("person@example.com", "session", "12345678")).toEqual({
      idToken: "id",
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 3600,
    });
    setAuthFetch(async () => new Response("no", { status: 400 }));
    expect(await submitEmailCode("person@example.com", "session", "00000000")).toBeNull();
  });

  it("accepts an 8-digit email code and refuses a 6-digit one", async () => {
    process.env.PORTAL_COGNITO_CLIENT_ID = "portal-client";
    const sent: string[] = [];
    setAuthFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { ChallengeResponses?: { EMAIL_OTP_CODE?: string } };
      sent.push(body.ChallengeResponses?.EMAIL_OTP_CODE ?? "");
      return new Response(JSON.stringify({
        AuthenticationResult: { IdToken: "id", AccessToken: "access", RefreshToken: "refresh", ExpiresIn: 3600 },
      }), { status: 200 });
    });
    expect(await submitEmailCode("person@example.com", "session", "123456")).toBeNull();
    expect(await submitEmailCode("person@example.com", "session", "87654321")).toMatchObject({ idToken: "id" });
    expect(sent).toEqual(["87654321"]);
  });
});
