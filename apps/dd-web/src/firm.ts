import { Client } from "pg";
import type { ReviewSql } from "./review-data";

export type FirmProfile = {
  id: string;
  version: number;
  firmName: string;
  cityState: string;
  replyTo: string;
  signerName: string;
  signerTitle: string;
  createdBy: string;
  createdAt: string;
};

export type FirmWrite =
  | { ok: true; version: number; unchanged: boolean }
  | { ok: false; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function readFirmProfile(): Promise<FirmProfile | null> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") return null;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await readLatestFirm({
      query: (text, values) => client.query(text, values === undefined ? undefined : [...values]),
    });
  } finally {
    await client.end();
  }
}

export async function readLatestFirm(sql: ReviewSql): Promise<FirmProfile | null> {
  const result = await sql.query<{
    id: string;
    version: number;
    firm_name: string;
    city_state: string;
    reply_to: string;
    signer_name: string;
    signer_title: string;
    created_by: string;
    created_at: Date;
  }>(
    `SELECT id, version, firm_name, city_state, reply_to, signer_name, signer_title, created_by, created_at
     FROM "FirmProfileVersion"
     ORDER BY version DESC
     LIMIT 1`,
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    version: row.version,
    firmName: row.firm_name,
    cityState: row.city_state,
    replyTo: row.reply_to,
    signerName: row.signer_name,
    signerTitle: row.signer_title,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

export async function saveFirmProfile(sql: ReviewSql, input: {
  firmName: string;
  cityState: string;
  replyTo: string;
  signerName: string;
  signerTitle: string;
  actor: string;
}): Promise<FirmWrite> {
  const firmName = clean(input.firmName);
  const cityState = clean(input.cityState);
  const replyTo = clean(input.replyTo);
  const signerName = clean(input.signerName);
  const signerTitle = clean(input.signerTitle);
  if (firmName === "" || cityState === "" || signerName === "" || signerTitle === "") {
    return { ok: false, message: "Fill in the firm name, city, signer, and title." };
  }
  if (firmName.length > 80 || cityState.length > 80 || signerName.length > 80 || signerTitle.length > 80) {
    return { ok: false, message: "Keep each field to 80 characters." };
  }
  if (!EMAIL.test(replyTo) || replyTo.length > 120) return { ok: false, message: "Enter a reply-to email address." };

  await sql.query("BEGIN");
  try {
    await sql.query(`SELECT pg_advisory_xact_lock(hashtext('dd-firm-profile'))`);
    const current = await readLatestFirm(sql);
    if (
      current !== null
      && current.firmName === firmName
      && current.cityState === cityState
      && current.replyTo === replyTo
      && current.signerName === signerName
      && current.signerTitle === signerTitle
    ) {
      await sql.query("COMMIT");
      return { ok: true, version: current.version, unchanged: true };
    }
    const version = (current?.version ?? 0) + 1;
    await sql.query(
      `INSERT INTO "FirmProfileVersion" (version, firm_name, city_state, reply_to, signer_name, signer_title, created_by)
       VALUES ($1::int, $2, $3, $4, $5, $6, $7)`,
      [version, firmName, cityState, replyTo, signerName, signerTitle, input.actor],
    );
    await sql.query("COMMIT");
    return { ok: true, version, unchanged: false };
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  }
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
