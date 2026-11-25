import type pg from "pg";

/** True only when the latest settings version turned real documents on. */
export async function acceptsRealDocuments(pool: pg.Pool, customerId: string): Promise<boolean> {
  const result = await pool.query<{ flag: string | null }>(
    `SELECT config->>'accepts_real_documents' AS flag
     FROM "CustomerConfigVersion"
     WHERE customer_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [customerId],
  );
  return result.rows[0]?.flag === "true";
}
