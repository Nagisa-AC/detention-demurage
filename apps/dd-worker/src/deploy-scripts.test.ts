import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("worker scripts", () => {
  it("sends the remote files and reads the sha from dist", () => {
    const dir = path.join(repoRoot, "scripts");
    for (const name of ["worker-install.sh", "worker-rollback.sh", "worker-journal.sh"]) {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      expect(text.startsWith("#!/bin/bash\nset -euo pipefail\n"), name).toBe(true);
    }
    const deploy = fs.readFileSync(path.join(dir, "deploy-worker.sh"), "utf8");
    expect(deploy).toContain("scripts/worker-install.sh");
    expect(deploy).toContain("dist/dd-worker.sha256");
    expect(deploy).toContain("git status --porcelain");
    expect(deploy).toContain("require_aws");
    expect(deploy).not.toContain("sha256sum");
    expect(deploy.toLowerCase()).not.toContain("immutable");
    const logs = fs.readFileSync(path.join(dir, "worker-logs.sh"), "utf8");
    expect(logs).toContain("scripts/worker-journal.sh");
    expect(logs).not.toContain("journalctl");
    const install = fs.readFileSync(path.join(dir, "worker-install.sh"), "utf8");
    const missing = install.indexOf("The dd-worker unit is missing; check /var/log/cloud-init-output.log");
    expect(missing).toBeGreaterThan(-1);
    expect(missing).toBeLessThan(install.indexOf("tar -C /opt/dd-worker"));
    const rollback = fs.readFileSync(path.join(dir, "rollback-worker.sh"), "utf8");
    expect(rollback).toContain("scripts/worker-rollback.sh");
    expect(rollback).not.toContain("systemctl");
    const readme = fs.readFileSync(path.join(repoRoot, "infra/README.md"), "utf8");
    expect(readme).toContain("checks the sha256");
    expect(readme).toContain("account admin can overwrite");
    expect(readme.toLowerCase()).not.toContain("immutable");
  });
});

describe("worker bundle", () => {
  it("writes a tarball of main.mjs and pdf.worker.mjs and records its sha256", () => {
    execFileSync(process.execPath, ["apps/dd-worker/bundle.mjs"], { cwd: repoRoot, stdio: "inherit" });
    const tarPath = path.join(repoRoot, "dist/dd-worker.tar");
    const tar = fs.readFileSync(tarPath);
    const sha = fs.readFileSync(path.join(repoRoot, "dist/dd-worker.sha256"), "utf8").trim();
    expect(sha).toBe(createHash("sha256").update(tar).digest("hex"));
    const names = execFileSync("tar", ["-tf", tarPath], { encoding: "utf8" }).trim().split("\n").sort();
    expect(names).toEqual(["main.mjs", "pdf.worker.mjs"]);
  }, 60_000);
});
