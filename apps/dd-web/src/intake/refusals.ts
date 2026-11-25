import { Client } from "pg";
import { isUuid } from "./limits";
import { rejectionLabel } from "./reasons";

export type UploadRefusal = { id: string; at: string; label: string };

/** Latest upload refusals for the customer page. Empty when the database is not configured. */
export async function readUploadRefusals(customerId: string): Promise<UploadRefusal[]> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "" || !isUuid(customerId)) return [];
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query<{ id: string; at: Date; payload: unknown }>(
      `SELECT id, at, payload
       FROM "AuditEvent"
       WHERE customer_id = $1 AND action = 'upload_rejected'
       ORDER BY at DESC
       LIMIT 5`,
      [customerId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      at: row.at.toISOString(),
      label: rejectionLabel(reasonOf(row.payload)),
    }));
  } finally {
    await client.end();
  }
}

function reasonOf(payload: unknown): string {
  if (payload === null || typeof payload !== "object" || !("reason" in payload)) return "";
  const reason = (payload as { reason: unknown }).reason;
  return typeof reason === "string" ? reason : "";
}
