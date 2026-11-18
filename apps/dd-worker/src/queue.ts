import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { StoredPage } from "./process.js";
import type { SavedRead } from "./read.js";

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
    finish?: "ok" | "failed";
    pages: StoredPage[];
    read?: SavedRead;
    modelVersion: string | null;
    promptVersion: string | null;
    schemaVersion: string | null;
  },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{ invoice_id: string | null }>(
      `SELECT invoice_id FROM "ProcessingRun" WHERE id = $1::uuid AND lease_token = $2::uuid FOR UPDATE`,
      [claimed.id, claimed.leaseToken],
    );
    const row = locked.rows[0];
    if (row === undefined) throw new Error("The run lease was lost.");
    let invoiceId = row.invoice_id;
    if (input.finish === "ok" && input.read !== undefined && invoiceId === null) {
      invoiceId = await insertRead(client, claimed, input.read);
    } else if (input.finish === "ok" && input.read !== undefined && invoiceId !== null) {
      await refreshRead(client, invoiceId, input.read);
    }
    const updated = await client.query(
      `UPDATE "ProcessingRun"
       SET finished_at = CASE WHEN $3::boolean THEN now() ELSE NULL END,
           lease_token = NULL,
           leased_at = NULL,
           page_records = $4::jsonb,
           model_version = $5,
           prompt_version = $6,
           schema_version = $7,
           invoice_id = $8::uuid
       WHERE id = $1::uuid AND lease_token = $2::uuid`,
      [
        claimed.id,
        claimed.leaseToken,
        input.permanent,
        JSON.stringify(input.pages),
        input.modelVersion,
        input.promptVersion,
        input.schemaVersion,
        invoiceId,
      ],
    );
    if ((updated.rowCount ?? 0) === 0) throw new Error("The run lease was lost.");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function insertRead(client: PoolClient, claimed: ClaimedRun, read: SavedRead): Promise<string> {
  const invoice = await client.query<{ id: string }>(
    `INSERT INTO "Invoice" (
       customer_id, document_id, invoice_number, billing_party, billed_party,
       currency, invoice_date, due_date, page_count, unresolved
     )
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::date, $8::date, $9, $10::jsonb)
     RETURNING id`,
    [
      claimed.customerId,
      claimed.documentId,
      read.invoiceNumber,
      read.billingParty,
      read.billedParty,
      read.currency,
      read.invoiceDate,
      read.dueDate,
      read.pageCount,
      JSON.stringify(read.unresolved),
    ],
  );
  const invoiceId = invoice.rows[0]?.id;
  if (invoiceId === undefined) throw new Error("The invoice was not saved.");
  for (const element of read.elements) {
    await client.query(
      `INSERT INTO "ElementValue" (
         customer_id, invoice_id, element_key, state, text, value, page,
         region_x, region_y, region_w, region_h, grounded
       )
       VALUES (
         $1::uuid, $2::uuid, $3, $4, $5, $6, $7,
         $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12
       )`,
      [
        claimed.customerId,
        invoiceId,
        element.key,
        element.state,
        element.text,
        element.value,
        element.page,
        element.region?.x ?? null,
        element.region?.y ?? null,
        element.region?.w ?? null,
        element.region?.h ?? null,
        element.grounded,
      ],
    );
  }
  for (const line of read.lines) {
    await client.query(
      `INSERT INTO "ChargeLine" (
         customer_id, invoice_id, line_id, container, charge,
         charged_from, charged_to, days, rate, amount, currency, grounded,
         container_page, from_page, to_page, days_page, rate_page, amount_page
       )
       VALUES (
         $1::uuid, $2::uuid, $3, $4, $5,
         $6::date, $7::date, $8, $9::numeric, $10::numeric, $11, $12,
         $13, $14, $15, $16, $17, $18
       )`,
      [
        claimed.customerId,
        invoiceId,
        line.lineId,
        line.container,
        line.charge,
        line.chargedFrom,
        line.chargedTo,
        line.days,
        line.rate,
        line.amount,
        line.currency,
        line.grounded,
        line.containerPage,
        line.fromPage,
        line.toPage,
        line.daysPage,
        line.ratePage,
        line.amountPage,
      ],
    );
  }
  return invoiceId;
}

/** A requeue keeps the invoice. It writes the pages and fragments the fresh read actually produced. */
async function refreshRead(client: PoolClient, invoiceId: string, read: SavedRead): Promise<void> {
  await client.query(`UPDATE "Invoice" SET unresolved = $2::jsonb WHERE id = $1::uuid`, [
    invoiceId,
    JSON.stringify(read.unresolved),
  ]);
  for (const line of read.lines) {
    await client.query(
      `UPDATE "ChargeLine"
       SET container_page = $3,
           from_page = $4,
           to_page = $5,
           days_page = $6,
           rate_page = $7,
           amount_page = $8
       WHERE invoice_id = $1::uuid AND line_id = $2`,
      [
        invoiceId,
        line.lineId,
        line.containerPage,
        line.fromPage,
        line.toPage,
        line.daysPage,
        line.ratePage,
        line.amountPage,
      ],
    );
  }
}
