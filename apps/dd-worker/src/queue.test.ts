import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimNext, finishRun } from "./queue.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const webRoot = path.join(repoRoot, "apps/dd-web");
const ownerUrl = workerDatabaseUrl();
const appUrl = appDatabaseUrl(ownerUrl);
const hash = "a".repeat(64);

let owner: Client;
let pool: Pool;

beforeAll(async () => {
  await ensureDatabase(ownerUrl);
  await ensureAppRole(ownerUrl);
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: ownerUrl },
    stdio: "inherit",
  });
  owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  await owner.query("ALTER ROLE dd_app WITH LOGIN PASSWORD 'dd_app_test'");
  pool = new Pool({ connectionString: appUrl, max: 4 });
  const app = await pool.connect();
  try {
    await app.query(`DELETE FROM "ProcessingRun"`);
    await app.query(`DELETE FROM "Document"`);
    await app.query(`DELETE FROM "Customer"`);
  } finally {
    app.release();
  }
}, 60_000);

afterAll(async () => {
  await pool?.end();
  await owner?.end();
});

describe("extract queue", () => {
  it("lets one worker take a run, picks a crashed run up again, and finishes the third failure", async () => {
    const sql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "queue.ts"), "utf8");
    expect(sql).toContain("FOR UPDATE OF r SKIP LOCKED");
    const customer = await pool.query<{ id: string }>(
      `INSERT INTO "Customer" (config_id, display_name) VALUES ('worker_queue', 'Sample') RETURNING id`,
    );
    const customerId = customer.rows[0]?.id;
    if (customerId === undefined) throw new Error("missing customer");
    const document = await pool.query<{ id: string }>(
      `INSERT INTO "Document" (customer_id, sha256, byte_size, storage_key)
       VALUES ($1, $2, 10, $3)
       RETURNING id`,
      [customerId, hash, `documents/${customerId}/${hash}.pdf`],
    );
    const documentId = document.rows[0]?.id;
    if (documentId === undefined) throw new Error("missing document");
    await pool.query(
      `INSERT INTO "ProcessingRun" (customer_id, document_id, kind) VALUES ($1, $2, 'extract')`,
      [customerId, documentId],
    );

    const [first, second] = await Promise.all([claimNext(pool, 3600), claimNext(pool, 3600)]);
    const claimed = [first, second].filter((row) => row !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.attempts).toBe(1);

    const crashed = await claimNext(pool, 0);
    expect(crashed?.id).toBe(claimed[0]?.id);
    expect(crashed?.attempts).toBe(2);
    if (crashed === null) throw new Error("missing reclaim");
    await finishRun(pool, crashed, {
      permanent: false,
      pages: [{ page: 1, status: "failed", reason: "checksum", ungrounded: [] }],
      modelVersion: null,
      promptVersion: null,
      schemaVersion: null,
    });

    const third = await claimNext(pool, 3600);
    expect(third?.attempts).toBe(3);
    if (third === null) throw new Error("missing third claim");
    await finishRun(pool, third, {
      permanent: true,
      pages: [{ page: 1, status: "failed", reason: "checksum", ungrounded: [] }],
      modelVersion: "fake",
      promptVersion: "1",
      schemaVersion: "1",
    });
    expect(await claimNext(pool, 3600)).toBeNull();

    const stored = await pool.query<{ finished_at: Date | null; page_records: unknown; attempts: number }>(
      `SELECT finished_at, page_records, attempts FROM "ProcessingRun" WHERE id = $1`,
      [third.id],
    );
    expect(stored.rows[0]?.attempts).toBe(3);
    expect(stored.rows[0]?.finished_at).not.toBeNull();
    const recorded = JSON.stringify(stored.rows[0]?.page_records);
    expect(recorded).toContain("checksum");
    expect(recorded).not.toContain("marked-secret-filename");
  });
});

function workerDatabaseUrl(): string {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/dd_test");
  if (url.hostname === "neon.tech" || url.hostname.endsWith(".neon.tech")) throw new Error("Tests refuse a Neon host.");
  url.pathname = "/dd_worker_test";
  return url.toString();
}

function appDatabaseUrl(owner: string): string {
  const url = new URL(owner);
  url.username = "dd_app";
  url.password = "dd_app_test";
  return url.toString();
}

async function ensureAppRole(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const existing = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'dd_app'");
    if ((existing.rowCount ?? 0) > 0) return;
    const sql = fs.readFileSync(path.join(webRoot, "prisma/create-app-role.sql"), "utf8");
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function ensureDatabase(url: string): Promise<void> {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error("Test database name is not a simple identifier.");
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (existing.rowCount === 0) await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
}
