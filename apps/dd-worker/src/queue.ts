import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { StoredPage } from "./process.js";

export type ClaimedRun = {
  id: string;
  customerId: string;
  documentId: string;
  attempts: number;
  leaseToken: string;
  storageKey: string;
  sha256: string;
};

export async function claimNext(pool: Pool, leaseSeconds: number): Promise<ClaimedRun | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const token = randomUUID();
    const updated = await client.query<{
      id: string;
      customer_id: string;
      document_id: string;
      attempts: number;
      lease_token: string;
    }>(
      `UPDATE "ProcessingRun" AS run
       SET attempts = run.attempts + 1,
           lease_token = $1::uuid,
           leased_at = now()
       WHERE run.id = (
         SELECT r.id
         FROM "ProcessingRun" r
         JOIN "Document" d ON d.id = r.document_id
         WHERE r.kind = 'extract'
           AND r.finished_at IS NULL
           AND r.attempts < 3
           AND d.storage_key IS NOT NULL
           AND (r.lease_token IS NULL OR r.leased_at < now() - make_interval(secs => $2::double precision))
         ORDER BY r.started_at
         FOR UPDATE OF r SKIP LOCKED
         LIMIT 1
       )
       RETURNING run.id, run.customer_id, run.document_id, run.attempts, run.lease_token`,
      [token, leaseSeconds],
    );
    const row = updated.rows[0];
    if (row === undefined) {
      await client.query("COMMIT");
      return null;
    }
    const document = await client.query<{ storage_key: string | null; sha256: string }>(
      `SELECT storage_key, sha256 FROM "Document" WHERE id = $1`,
      [row.document_id],
    );
    const stored = document.rows[0];
    if (stored === undefined || stored.storage_key === null) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("COMMIT");
    return {
      id: row.id,
      customerId: row.customer_id,
      documentId: row.document_id,
      attempts: row.attempts,
      leaseToken: row.lease_token,
      storageKey: stored.storage_key,
      sha256: stored.sha256,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function loadRunDocument(
  pool: Pool,
  runId: string,
): Promise<{ storageKey: string; sha256: string } | null> {
  const result = await pool.query<{ storage_key: string | null; sha256: string }>(
    `SELECT d.storage_key, d.sha256
     FROM "ProcessingRun" r
     JOIN "Document" d ON d.id = r.document_id
     WHERE r.id = $1::uuid`,
    [runId],
  );
  const row = result.rows[0];
  if (row === undefined || row.storage_key === null) return null;
  return { storageKey: row.storage_key, sha256: row.sha256 };
}

export async function requeueRun(pool: Pool, runId: string): Promise<boolean> {
  const updated = await pool.query(
    `UPDATE "ProcessingRun"
     SET finished_at = NULL,
         attempts = 0,
         lease_token = NULL,
         leased_at = NULL,
         page_records = NULL
     WHERE id = $1::uuid`,
    [runId],
  );
  return (updated.rowCount ?? 0) === 1;
}

export async function finishRun(
  pool: Pool,
  claimed: ClaimedRun,
  input: {
    permanent: boolean;
    pages: StoredPage[];
    modelVersion: string | null;
    promptVersion: string | null;
    schemaVersion: string | null;
  },
): Promise<void> {
  const updated = await pool.query(
    `UPDATE "ProcessingRun"
     SET finished_at = CASE WHEN $3::boolean THEN now() ELSE NULL END,
         lease_token = NULL,
         leased_at = NULL,
         page_records = $4::jsonb,
         model_version = $5,
         prompt_version = $6,
         schema_version = $7
     WHERE id = $1::uuid AND lease_token = $2::uuid`,
    [
      claimed.id,
      claimed.leaseToken,
      input.permanent,
      JSON.stringify(input.pages),
      input.modelVersion,
      input.promptVersion,
      input.schemaVersion,
    ],
  );
  if ((updated.rowCount ?? 0) === 0) throw new Error("The run lease was lost.");
}
