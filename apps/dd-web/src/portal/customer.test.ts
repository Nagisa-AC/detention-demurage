import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lookupPortalCustomer, resolvePortalCustomer } from "./customer";
import { withPortalQuery } from "./query";
import { verifyPortalIdToken } from "./verify";

const webSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("portal customer", () => {
  it("uses the verified sub and ignores a customer id on the request", async () => {
    const lookups: string[] = [];
    const customer = await resolvePortalCustomer(
      {
        url: "https://portal.example/invoices?customerId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        headers: {
          get(name: string) {
            if (name === "authorization") return "Bearer header.payload.sig";
            if (name === "x-customer-id") return "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
            return null;
          },
        },
      },
      {
        verify: async (token) => (token === "header.payload.sig" ? { sub: "sub-a" } : null),
        lookup: async (sub) => {
          lookups.push(sub);
          return sub === "sub-a" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        },
      },
    );
    expect(lookups).toEqual(["sub-a"]);
    expect(customer?.customerId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("looks up the sub and treats a disabled user as gone", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const customerId = await lookupPortalCustomer(
      {
        async query<T extends Record<string, unknown>>(text: string, values?: readonly unknown[]) {
          if (values === undefined) calls.push({ text });
          else calls.push({ text, values });
          return { rows: [{ customer_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }] as unknown as T[] };
        },
      },
      "sub-a",
    );
    expect(customerId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual(["sub-a"]);
    expect(calls[0]?.text).toContain("cognito_sub = $1");
    expect(calls[0]?.text).toContain("portal_user_disabled");
    expect(calls[0]?.text).not.toContain("bbbbbbbb");
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

  it("sets the customer only inside the portal query helper", () => {
    const sources = walk(webSrc).filter((file) => !file.endsWith(".test.ts"));
    const setters = sources.filter((file) => fs.readFileSync(file, "utf8").includes("set_config('app.customer_id'"));
    expect(setters.map((file) => path.relative(webSrc, file))).toEqual(["portal/query.ts"]);
    const urls = sources.filter((file) => fs.readFileSync(file, "utf8").includes("PORTAL_DATABASE_URL"));
    expect(urls.map((file) => path.relative(webSrc, file))).toEqual(["portal/query.ts"]);
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
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
