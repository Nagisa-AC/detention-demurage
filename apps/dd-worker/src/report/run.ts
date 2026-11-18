import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ClaimedReport } from "../queue.js";
import { renderReport, sha256 } from "./assemble.js";
import { nextSequence, parseReportRequest, prepareReport, reportObjectKey, REPORT_PDF_BYTE_CAP, type ReportRequest } from "./load.js";
import { buildReport, issuedYear, reportNumber } from "./model.js";
import { LeaseLost, REPORT_FAILURES, ReportJobError, type ReportFailure } from "./reasons.js";
import { REPORT_SERIES } from "./wording.js";

export async function runReport(input: {
  pool: Pool;
  claimed: ClaimedReport;
  download: (key: string) => Promise<Uint8Array>;
  put: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  maxPdfBytes?: number;
}): Promise<"finished" | "retry"> {
  try {
    await finishReport(input);
    return "finished";
  } catch (error) {
    if (error instanceof LeaseLost) return "finished";
    const reason = failureOf(error);
    const permanent = reason !== "store" || input.claimed.attempts >= 3;
    if (!permanent) {
      await releaseLease(input.pool, input.claimed);
      return "retry";
    }
    await failReport(input.pool, input.claimed, reason);
    return "finished";
  }
}

async function finishReport(input: {
  pool: Pool;
  claimed: ClaimedReport;
  download: (key: string) => Promise<Uint8Array>;
  put: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  maxPdfBytes?: number;
}): Promise<void> {
  const request = await readRequest(input.pool, input.claimed);
  const prepared = await prepareReport(
    input.pool,
    input.claimed.customerId,
    request,
    input.download,
    input.maxPdfBytes ?? REPORT_PDF_BYTE_CAP,
  );
  const client = await input.pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{ page_records: unknown }>(
      `SELECT page_records FROM "ProcessingRun"
       WHERE id = $1::uuid AND lease_token = $2::uuid AND kind = 'report' AND finished_at IS NULL
       FOR UPDATE`,
      [input.claimed.id, input.claimed.leaseToken],
    );
    const row = locked.rows[0];
    const current = row === undefined ? null : parseReportRequest(row.page_records);
    if (current === null || current.rulesRunId !== request.rulesRunId || current.firmVersion !== request.firmVersion || current.actor !== request.actor) {
      throw new LeaseLost();
    }
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`dd-report-${REPORT_SERIES}`]);
    const year = issuedYear(prepared.finishedAt);
    const sequence = await nextSequence(client, year);
    const number = reportNumber(year, sequence);
    const model = buildReport({ ...prepared.build, reportNumber: number });
    const pdf = await renderReport(model);
    const csv = new TextEncoder().encode(model.csv);
    const pdfSha = sha256(pdf);
    const csvSha = sha256(csv);
    const id = randomUUID();
    const pdfKey = reportObjectKey(input.claimed.customerId, id, "pdf");
    const csvKey = reportObjectKey(input.claimed.customerId, id, "csv");
    try {
      await input.put(pdfKey, pdf, "application/pdf");
      await input.put(csvKey, csv, "text/csv; charset=utf-8");
    } catch {
      throw new ReportJobError("store");
    }
    await client.query(
      `INSERT INTO "ReportExport" (
         id, customer_id, processing_run_id, firm_profile_id, report_number, series, year, sequence,
         settings_version, firm_version, convention, pdf_sha256, csv_sha256, pdf_key, csv_key, created_by
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::int, $8::int,
         $9::int, $10::int, $11, $12, $13, $14, $15, $16
       )`,
      [
        id,
        input.claimed.customerId,
        prepared.runId,
        prepared.firmId,
        number,
        REPORT_SERIES,
        year,
        sequence,
        prepared.settingsVersion,
        prepared.firmVersion,
        model.convention,
        pdfSha,
        csvSha,
        pdfKey,
        csvKey,
        request.actor,
      ],
    );
    await client.query(
      `INSERT INTO "AuditEvent" (customer_id, actor, action, payload)
       VALUES ($1::uuid, $2, 'report_exported', $3::jsonb)`,
      [
        input.claimed.customerId,
        request.actor,
        JSON.stringify({
          run_id: prepared.runId,
          settings_version: prepared.settingsVersion,
          firm_profile_version: prepared.firmVersion,
          convention: model.convention,
          pdf_sha256: pdfSha,
          csv_sha256: csvSha,
          report_number: number,
        }),
      ],
    );
    const finished = await client.query(
      `UPDATE "ProcessingRun"
       SET finished_at = now(),
           lease_token = NULL,
           leased_at = NULL,
           page_records = $3::jsonb
       WHERE id = $1::uuid AND lease_token = $2::uuid`,
      [
        input.claimed.id,
        input.claimed.leaseToken,
        JSON.stringify({
          rules_run_id: request.rulesRunId,
          firm_profile_version: request.firmVersion,
          actor: request.actor,
          failed: false,
          export_id: id,
        }),
      ],
    );
    if ((finished.rowCount ?? 0) === 0) throw new LeaseLost();
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function readRequest(pool: Pool, claimed: ClaimedReport): Promise<ReportRequest> {
  const result = await pool.query<{ page_records: unknown }>(
    `SELECT page_records FROM "ProcessingRun" WHERE id = $1::uuid AND lease_token = $2::uuid AND kind = 'report'`,
    [claimed.id, claimed.leaseToken],
  );
  const request = parseReportRequest(result.rows[0]?.page_records);
  if (request === null) throw new ReportJobError("build");
  return request;
}

async function releaseLease(pool: Pool, claimed: ClaimedReport): Promise<void> {
  await pool.query(
    `UPDATE "ProcessingRun"
     SET lease_token = NULL, leased_at = NULL
     WHERE id = $1::uuid AND lease_token = $2::uuid AND finished_at IS NULL`,
    [claimed.id, claimed.leaseToken],
  );
}

async function failReport(pool: Pool, claimed: ClaimedReport, reason: ReportFailure): Promise<void> {
  const current = await pool.query<{ page_records: unknown }>(
    `SELECT page_records FROM "ProcessingRun" WHERE id = $1::uuid AND lease_token = $2::uuid`,
    [claimed.id, claimed.leaseToken],
  );
  const request = parseReportRequest(current.rows[0]?.page_records);
  const record = {
    ...(request === null
      ? {}
      : { rules_run_id: request.rulesRunId, firm_profile_version: request.firmVersion, actor: request.actor }),
    failed: true,
    reason: REPORT_FAILURES[reason],
  };
  await pool.query(
    `UPDATE "ProcessingRun"
     SET finished_at = now(),
         lease_token = NULL,
         leased_at = NULL,
         page_records = $3::jsonb
     WHERE id = $1::uuid AND lease_token = $2::uuid AND finished_at IS NULL`,
    [claimed.id, claimed.leaseToken, JSON.stringify(record)],
  );
}

function failureOf(error: unknown): ReportFailure {
  if (error instanceof ReportJobError) return error.reason;
  const status = httpStatus(error);
  if (status !== undefined && (status >= 500 || status === 429)) return "store";
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "NetworkingError") return "store";
  return "build";
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) return undefined;
  const metadata = (error as { $metadata: unknown }).$metadata;
  if (typeof metadata !== "object" || metadata === null || !("httpStatusCode" in metadata)) return undefined;
  const status = (metadata as { httpStatusCode: unknown }).httpStatusCode;
  return typeof status === "number" ? status : undefined;
}
