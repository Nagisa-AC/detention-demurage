import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rulesPackage } from "./core-link";

const appSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const webRoot = path.resolve(appSrc, "..");

describe("dd-web boundary", () => {
  it("depends on dd-core and does not import dd-extract or define runRules", () => {
    expect(rulesPackage).toBe("dd-core");
    const pkg = JSON.parse(fs.readFileSync(path.join(webRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["dd-core"]).toBeDefined();
    expect(pkg.dependencies?.["dd-extract"]).toBeUndefined();

    const sources = walk(appSrc).filter((file) => !file.endsWith(".test.ts"));
    const banned = sources.filter((file) => {
      const text = fs.readFileSync(file, "utf8");
      return (
        text.includes("dd-extract") ||
        text.includes("@anthropic-ai/sdk") ||
        text.includes("packages/extract") ||
        text.includes("runRules") ||
        text.includes("dangerouslySetInnerHTML")
      );
    });
    expect(banned).toEqual([]);
  });

  it("calls requireSession in every signed-in page, server action, and route handler", () => {
    const files = walk(path.join(appSrc, "app"));
    const rel = (file: string) => path.relative(path.join(appSrc, "app"), file).split(path.sep).join("/");
    const pages = files.filter((file) => file.endsWith("page.tsx") && file.includes(`${path.sep}(signed-in)${path.sep}`));
    expect(pages.map(rel).sort()).toEqual([
      "(signed-in)/cases/page.tsx",
      "(signed-in)/customers/page.tsx",
      "(signed-in)/page.tsx",
      "(signed-in)/review/page.tsx",
    ]);
    for (const file of pages) expect(fs.readFileSync(file, "utf8")).toContain("requireSession(");

    const layouts = files.filter((file) => file.endsWith("layout.tsx") && file.includes("(signed-in)"));
    expect(layouts.map(rel)).toEqual(["(signed-in)/layout.tsx"]);
    expect(fs.readFileSync(layouts[0] ?? "", "utf8")).toContain("requireSession(");

    const routes = files.filter((file) => file.endsWith("route.ts"));
    expect(routes.map(rel)).toEqual(["api/session/route.ts"]);
    for (const file of routes) expect(fs.readFileSync(file, "utf8")).toContain("requireSession(");

    const actions = files.filter((file) => {
      if (file.includes(`${path.sep}sign-in${path.sep}`)) return false;
      return fs.readFileSync(file, "utf8").includes('"use server"');
    });
    expect(actions.map(rel).sort()).toEqual(["(signed-in)/account.ts", "(signed-in)/sign-out.ts"]);
    for (const file of actions) expect(fs.readFileSync(file, "utf8")).toContain("requireSession(");

    const signIn = files.filter((file) => file.includes(`${path.sep}sign-in${path.sep}`));
    expect(signIn.some((file) => fs.readFileSync(file, "utf8").includes("requireSession("))).toBe(false);
    expect(files.some((file) => /sign-?up/i.test(path.basename(path.dirname(file))))).toBe(false);
  });

  it("pins functions to cle1", () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(webRoot, "vercel.json"), "utf8")) as { regions?: string[] };
    expect(vercel.regions).toEqual(["cle1"]);
    const layout = fs.readFileSync(path.join(appSrc, "app/(signed-in)/layout.tsx"), "utf8");
    expect(layout).toContain('runtime = "nodejs"');
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
