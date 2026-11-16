import { Client } from "pg";
import type { IntakeDb, RejectReason, SavedDocument } from "./store";

type QueryClient = Pick<Client, "query">;

export function pgIntake(client: QueryClient): IntakeDb {
  return {
    async customerExists(customerId) {
      const result = await client.query(`SELECT 1 FROM "Customer" WHERE id = $1`, [customerId]);
      return (result.rowCount ?? 0) > 0;
    },
    async findDocument(customerId, sha256) {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM "Document" WHERE customer_id = $1 AND sha256 = $2`,
        [customerId, sha256],
      );
      return result.rows[0] ?? null;
    },
    async saveAccepted(row) {
      try {
        await client.query("BEGIN");
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO "Document" (customer_id, sha256, byte_size, storage_key)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [row.customerId, row.sha256, row.byteSize, row.storageKey],
        );
        const id = inserted.rows[0]?.id;
        if (id === undefined) throw new Error("The document was not stored.");
        await client.query(
          `INSERT INTO "ProcessingRun" (customer_id, document_id, kind) VALUES ($1, $2, 'extract')`,
          [row.customerId, id],
        );
        await client.query(
          `INSERT INTO "AuditEvent" (customer_id, actor, action, payload)
           VALUES ($1, $2, 'upload_received', $3::jsonb)`,
          [row.customerId, row.actor, JSON.stringify({ document_id: id, sha256: row.sha256 })],
        );
        await client.query("COMMIT");
        return { id, duplicate: false } satisfies SavedDocument;
      } catch (error) {
        await client.query("ROLLBACK");
        if (!isUniqueViolation(error)) throw error;
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM "Document" WHERE customer_id = $1 AND sha256 = $2`,
          [row.customerId, row.sha256],
        );
        const id = existing.rows[0]?.id;
        if (id === undefined) throw error;
        return { id, duplicate: true };
      }
    },
    async reject(row) {
      await client.query(
        `INSERT INTO "AuditEvent" (customer_id, actor, action, payload)
         VALUES ($1, $2, 'upload_rejected', $3::jsonb)`,
        [row.customerId, row.actor, JSON.stringify({ reason: row.reason satisfies RejectReason })],
      );
    },
  };
}

export async function withIntake<T>(databaseUrl: string, run: (db: IntakeDb) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await run(pgIntake(client));
  } finally {
    await client.end();
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
