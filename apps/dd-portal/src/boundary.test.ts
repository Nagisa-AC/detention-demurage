import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { unsignedRedirect } from "./auth/gate";
import { middleware } from "./middleware";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("portal boundary", () => {
  it("does not import the staff app, the owner database, or the staff role", () => {
    const files = walk(path.join(appRoot, "src")).filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"));
    const packageJson = fs.readFileSync(path.join(appRoot, "package.json"), "utf8");
    expect(packageJson).not.toContain("dd-web");
    expect(packageJson).not.toContain("@aws-sdk");
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      const relative = path.relative(appRoot, file);
      expect(text, relative).not.toMatch(/from ["'][^"']*dd-web/);
      expect(text, relative).not.toContain("dd_app");
      expect(text.replaceAll("PORTAL_DATABASE_URL", ""), relative).not.toContain("DATABASE_URL");
      expect(text, relative).not.toContain("AWS_ACCESS_KEY");
      expect(text, relative).not.toContain("AWS_SECRET");
      expect(text, relative).not.toContain("@aws-sdk");
    }
  });

  it("sends every unsigned page to sign-in", async () => {
    for (const page of ["/", "/invoices", "/invoices/SYN-1003", "/passkey"]) {
      expect(unsignedRedirect(page, false), page).toBe("/sign-in");
      const response = await middleware(new NextRequest(`http://portal.test${page}`));
      expect(response.status, page).toBe(307);
      expect(response.headers.get("location"), page).toBe("http://portal.test/sign-in");
    }
    expect(unsignedRedirect("/sign-in", false)).toBeNull();
    expect(unsignedRedirect("/sign-in/code", false)).toBeNull();
    expect(unsignedRedirect("/", true)).toBeNull();
    const signIn = await middleware(new NextRequest("http://portal.test/sign-in"));
    expect(signIn.status).toBe(200);
  });

  it("keeps the error page free of internal details", () => {
    const errorPage = fs.readFileSync(path.join(appRoot, "src/app/error.tsx"), "utf8");
    const globalError = fs.readFileSync(path.join(appRoot, "src/app/global-error.tsx"), "utf8");
    for (const source of [errorPage, globalError]) {
      expect(source).not.toContain("error.message");
      expect(source).not.toContain("error.digest");
      expect(source).not.toContain("stack");
    }
  });
});

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
