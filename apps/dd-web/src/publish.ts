import { withReviewDb, type ReviewSql } from "./review-data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LATEST_RUN = `SELECT id
     FROM "ProcessingRun"
     WHERE customer_id = $1::uuid
       AND kind = 'rules'
       AND finished_at IS NOT NULL
       AND COALESCE(page_records->>'failed', 'false') <> 'true'
     ORDER BY started_at DESC, id DESC
     LIMIT 1`;

/** Staff publish the latest successful rules run. The run id is not taken from the browser. */
export async function recordPublication(sql: ReviewSql, customerId: string, actor: string): Promise<boolean> {
  if (!UUID.test(customerId) || actor.trim() === "" || actor.length > 200) return false;
  const latest = await sql.query<{ id: string }>(LATEST_RUN, [customerId]);
  const runId = latest.rows[0]?.id;
  if (runId === undefined) return false;
  const existing = await sql.query<{ id: string }>(
    `SELECT id FROM "AuditEvent"
     WHERE customer_id = $1::uuid
       AND action = 'results_published'
       AND payload->>'processing_run_id' = $2
     LIMIT 1`,
    [customerId, runId],
  );
  if (existing.rows[0] !== undefined) return false;
  await sql.query(
    `INSERT INTO "AuditEvent" (customer_id, actor, action, payload)
     VALUES ($1::uuid, $2, 'results_published', $3::jsonb)`,
    [customerId, actor, JSON.stringify({ processing_run_id: runId })],
  );
  return true;
}

export async function readPublishState(customerId: string): Promise<"none" | "ready" | "published"> {
  if (!UUID.test(customerId)) return "none";
  const state = await withReviewDb(async (sql) => {
    const latest = await sql.query<{ id: string }>(LATEST_RUN, [customerId]);
    const runId = latest.rows[0]?.id;
    if (runId === undefined) return "none" as const;
    const existing = await sql.query<{ id: string }>(
      `SELECT id FROM "AuditEvent"
       WHERE customer_id = $1::uuid
         AND action = 'results_published'
         AND payload->>'processing_run_id' = $2
       LIMIT 1`,
      [customerId, runId],
    );
    return existing.rows[0] === undefined ? ("ready" as const) : ("published" as const);
  });
  return state ?? "none";
}
