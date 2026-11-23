import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolvePortalCustomer } from "./customer";
import { withPortalQuery } from "./query";
import { verifyPortalIdToken } from "./verify";

const packageSrc = path.dirname(fileURLToPath(import.meta.url));

describe("portal customer", () => {
  it("uses the verified sub and ignores any other customer id", async () => {
    const lookups: string[] = [];
    const account = await resolvePortalCustomer("header.payload.sig", {
      verify: async (token) => (token === "header.payload.sig" ? { sub: "sub-a", email: null } : null),
      lookup: async (sub) => {
        lookups.push(sub);
        return sub === "sub-a" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      },
    });
    expect(lookups).toEqual(["sub-a"]);
    expect(account?.customer.customerId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(account?.email).toBeNull();
  });

  it("rejects a customer id that did not come from the session", async () => {
    await expect(
      withPortalQuery({ customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } as never, async () => 1),
    ).rejects.toThrow(/verified portal session/);
  });

  it("does not accept the staff pool as the portal pool", async () => {
    const previous = {
      pool: process.env.PORTAL_COGNITO_USER_POOL_ID,
      client: process.env.PORTAL_COGNITO_CLIENT_ID,
      staffPool: process.env.COGNITO_USER_POOL_ID,
      staffClient: process.env.COGNITO_CLIENT_ID,
    };
    delete process.env.PORTAL_COGNITO_USER_POOL_ID;
    delete process.env.PORTAL_COGNITO_CLIENT_ID;
    process.env.COGNITO_USER_POOL_ID = "us-east-2_staff";
    process.env.COGNITO_CLIENT_ID = "staff-client";
    try {
      expect(await verifyPortalIdToken("not-a-portal-token")).toBeNull();
    } finally {
      restore("PORTAL_COGNITO_USER_POOL_ID", previous.pool);
      restore("PORTAL_COGNITO_CLIENT_ID", previous.client);
      restore("COGNITO_USER_POOL_ID", previous.staffPool);
      restore("COGNITO_CLIENT_ID", previous.staffClient);
    }
  });

  it("refuses a staff-pool token when the portal pool is configured", async () => {
    const previous = {
      pool: process.env.PORTAL_COGNITO_USER_POOL_ID,
      client: process.env.PORTAL_COGNITO_CLIENT_ID,
    };
    process.env.PORTAL_COGNITO_USER_POOL_ID = "us-east-2_portal";
    process.env.PORTAL_COGNITO_CLIENT_ID = "portal-client";
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const body = base64url(
      JSON.stringify({
        sub: "staff-user",
        token_use: "id",
        iss: "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_staff",
        aud: "staff-client",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    try {
      expect(await verifyPortalIdToken(`${header}.${body}.sig`)).toBeNull();
    } finally {
      restore("PORTAL_COGNITO_USER_POOL_ID", previous.pool);
      restore("PORTAL_COGNITO_CLIENT_ID", previous.client);
    }
  });

  it("connects as the portal role only from the query helper", () => {
    const sources = walk(packageSrc).filter((file) => !file.endsWith(".test.ts"));
    const setters = sources.filter((file) => fs.readFileSync(file, "utf8").includes("set_config('app.customer_id'"));
    expect(setters.map((file) => path.relative(packageSrc, file))).toEqual(["query.ts"]);
    const urls = sources.filter((file) => fs.readFileSync(file, "utf8").includes("PORTAL_DATABASE_URL"));
    expect(urls.map((file) => path.relative(packageSrc, file))).toEqual(["query.ts"]);
  });

  it("leaves the staff app off the portal database login", () => {
    const webSrc = path.resolve(packageSrc, "../../../apps/dd-web/src");
    const sources = walk(webSrc).filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"));
    const hits = sources.filter((file) => {
      const text = fs.readFileSync(file, "utf8");
      return text.includes("PORTAL_DATABASE_URL") || text.includes('from "portal"') || text.includes("from 'portal'");
    });
    expect(hits).toEqual([]);
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
  }
  return found;
}
