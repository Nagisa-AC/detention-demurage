import { describe, expect, it } from "vitest";
import { createUserInput, runPortalUser, setPasswordInput, type PortalUserCognito, type PortalUserStore } from "./portal-user.js";

const customerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("portal-user add", () => {
  it("creates a suppressed Cognito user and prints nothing secret", async () => {
    const secret = "temporary-secret-value";
    const calls: { email: string; poolId: string }[] = [];
    const saved: { customerId: string; sub: string; email: string }[] = [];
    const cognito: PortalUserCognito = {
      async create(input) {
        calls.push(input);
        return { sub: "cognito-sub" };
      },
    };
    const store: PortalUserStore = {
      async customerExists(id) {
        return id === customerId;
      },
      async insert(row) {
        saved.push(row);
        return "ok";
      },
    };
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runPortalUser(
      {
        argv: ["add", "--customer", customerId, "--email", "Dana@Example.com"],
        env: { PORTAL_COGNITO_USER_POOL_ID: "us-east-2_portal", DATABASE_URL: `postgres://owner:${secret}@db/app` },
        stdout: { write: (chunk) => stdout.push(chunk) },
        stderr: { write: (chunk) => stderr.push(chunk) },
      },
      { cognito, store },
    );
    expect(code).toBe(0);
    expect(stdout.join("")).toBe("Portal user added.\n");
    expect(stderr.join("")).toBe("");
    expect(calls).toEqual([{ email: "dana@example.com", poolId: "us-east-2_portal" }]);
    expect(saved).toEqual([{ customerId, sub: "cognito-sub", email: "dana@example.com" }]);
    expect(stdout.join("")).not.toContain(secret);
    expect(stdout.join("")).not.toContain("cognito-sub");
  });

  it("suppresses the invitation and confirms the user without keeping the password", () => {
    const password = "Aa1!secret";
    const created = createUserInput("pool", "a@example.com", password);
    expect(created.MessageAction).toBe("SUPPRESS");
    const confirmed = setPasswordInput("pool", "a@example.com", password);
    expect(confirmed.Permanent).toBe(true);
    expect(confirmed.Password).toBe(password);
    const logged = JSON.stringify({
      MessageAction: created.MessageAction,
      UserPoolId: confirmed.UserPoolId,
      Username: confirmed.Username,
      Permanent: confirmed.Permanent,
    });
    expect(logged).not.toContain(password);
  });
});
