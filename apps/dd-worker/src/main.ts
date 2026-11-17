import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { fromInstanceMetadata } from "@aws-sdk/credential-providers";
import { extract } from "dd-extract";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import pg from "pg";
import { syntheticAllowlist } from "./allow.js";
import { diagnoseRun, formatFailure } from "./diagnose.js";
import { runOnce } from "./loop.js";
import { readModelPages } from "./model.js";
import { readPdfPages } from "./pdf-text.js";
import { processDocument, sha256Hex } from "./process.js";
import { claimNext, finishRun, loadRunDocument, requeueRun } from "./queue.js";
import { assertDatabaseTls, DATABASE_PARAMETER, readWorkerSecrets } from "./ssm.js";

const REGION = "us-east-2";

export async function main(): Promise<void> {
  // DynamicUser has no home directory. The AWS SDK calls os.homedir() while loading
  // shared config, and that throws ENOENT. /tmp is private to this service.
  ensureRuntimeEnv();
  const credentials = fromInstanceMetadata();
  const ssm = new SSMClient({ region: REGION, credentials });
  const secrets = await readWorkerSecrets(async (name) => {
    const out = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    const value = out.Parameter?.Value;
    if (value === undefined || value === "") throw new Error("A worker parameter is missing.");
    return value;
  });
  process.env.ANTHROPIC_API_KEY = secrets.anthropicKey;
  const bucket = process.env.DD_BUCKET;
  if (bucket === undefined || bucket === "") throw new Error("DD_BUCKET is not set.");
  const pool = new pg.Pool({ connectionString: secrets.databaseUrl, max: 2 });
  const s3 = new S3Client({ region: REGION, credentials });
  const allow = syntheticAllowlist();
  for (;;) {
    const outcome = await runOnce({
      claim: () => claimNext(pool, 900),
      download: async (key) => {
        const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const bytes = await out.Body?.transformToByteArray();
        if (bytes === undefined) throw new Error("The document object is empty.");
        return bytes;
      },
      process: (pdf, declaredHash, log) =>
        processDocument({
          pdf,
          declaredHash,
          allow,
          readPages: readPdfPages,
          extract: (file, pages) => readModelPages(file, pages),
          log,
        }),
      finish: (claimed, result) => finishRun(pool, claimed, result),
      log: (line) => console.info(line),
    });
    if (outcome === "idle") await delay(5000);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const entry = process.argv[1];
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === "--self-check") {
    // Importing the modules above evaluates them. Stop before SSM, S3, Postgres, or the model.
    if (
      typeof S3Client !== "function" ||
      typeof SSMClient !== "function" ||
      typeof pg.Pool !== "function" ||
      typeof getDocument !== "function" ||
      typeof extract !== "function"
    ) {
      console.error("The bundle self-check did not load S3, SSM, pg, pdfjs, and extract.");
      process.exit(1);
    }
    process.exit(0);
  }
  if (command === "--check-pdf") {
    void checkPdf(process.argv[3]).then((code) => process.exit(code));
  } else if (command === "--requeue") {
    void requeue(process.argv[3] ?? "");
  } else if (command === "--diagnose") {
    void diagnose(process.argv[3] ?? "");
  } else {
    void main();
  }
}

/** Read one synthetic PDF with the bundled worker and do not call the model. */
async function checkPdf(file: string | undefined): Promise<number> {
  if (file === undefined || file === "") {
    console.error("Pass the PDF path.");
    return 1;
  }
  const pdf = new Uint8Array(readFileSync(file));
  let sawText = false;
  const result = await processDocument({
    pdf,
    declaredHash: sha256Hex(pdf),
    allow: syntheticAllowlist(),
    readPages: readPdfPages,
    extract: async (_pdf, pages) => {
      sawText = pages.length > 0;
      return [];
    },
  });
  const reason = result.pages[0]?.reason;
  if (reason === "checksum" || reason === "not_synthetic") {
    console.error("The bundled reader did not accept the PDF.");
    return 1;
  }
  if (!sawText) {
    console.error("The bundled reader returned an empty text layer.");
    return 1;
  }
  return 0;
}

async function requeue(runId: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId)) {
    console.error("Run id must be a UUID.");
    process.exit(1);
  }
  ensureRuntimeEnv();
  const credentials = fromInstanceMetadata();
  const ssm = new SSMClient({ region: REGION, credentials });
  let databaseUrl = "";
  try {
    const out = await ssm.send(new GetParameterCommand({ Name: DATABASE_PARAMETER, WithDecryption: true }));
    databaseUrl = out.Parameter?.Value ?? "";
  } catch (error) {
    console.error(`The database parameter was not read. ${errorToken(error)}`);
    process.exit(1);
  }
  try {
    requireAppDatabase(databaseUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error(message === "The database URL must set sslmode=require or stricter." ? message : "The database URL must connect as dd_app.");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const updated = await requeueRun(pool, runId);
    if (!updated) {
      console.error("No run was requeued.");
      process.exit(1);
    }
    console.log(`requeued ${runId}`);
  } catch (error) {
    console.error(`The run was not requeued. ${errorToken(error)}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

function requireAppDatabase(databaseUrl: string): void {
  assertDatabaseTls(databaseUrl);
  let username: string;
  try {
    username = decodeURIComponent(new URL(databaseUrl).username);
  } catch {
    throw new Error("The database URL must connect as dd_app.");
  }
  if (username !== "dd_app") throw new Error("The database URL must connect as dd_app.");
}

async function diagnose(runId: string): Promise<void> {
  ensureRuntimeEnv();
  const credentials = fromInstanceMetadata();
  const ssm = new SSMClient({ region: REGION, credentials });
  let databaseUrl = "";
  let anthropicKey = "";
  try {
    const secrets = await readWorkerSecrets(async (name) => {
      const out = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
      const value = out.Parameter?.Value;
      if (value === undefined || value === "") throw new Error("A worker parameter is missing.");
      return value;
    });
    databaseUrl = secrets.databaseUrl;
    anthropicKey = secrets.anthropicKey;
    requireAppDatabase(databaseUrl);
  } catch (error) {
    console.log(formatFailure(error, [databaseUrl, anthropicKey]));
    process.exit(1);
  }
  process.env.ANTHROPIC_API_KEY = anthropicKey;
  const bucket = process.env.DD_BUCKET;
  if (bucket === undefined || bucket === "") {
    console.log("DD_BUCKET is not set.");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const s3 = new S3Client({ region: REGION, credentials });
  const hidden = [databaseUrl, anthropicKey];
  let code = 1;
  try {
    code = await diagnoseRun({
      runId,
      allow: syntheticAllowlist(),
      secrets: hidden,
      load: (id) => loadRunDocument(pool, id),
      download: async (key) => {
        const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const bytes = await out.Body?.transformToByteArray();
        if (bytes === undefined) throw new Error("The document object is empty.");
        return bytes;
      },
      process: (pdf, declaredHash) =>
        processDocument({
          pdf,
          declaredHash,
          allow: syntheticAllowlist(),
          readPages: readPdfPages,
          extract: (file, pages) => readModelPages(file, pages),
        }),
      write: (line) => console.log(line),
    });
  } catch (error) {
    console.log(formatFailure(error, hidden));
  } finally {
    await pool.end();
  }
  process.exit(code);
}

function ensureRuntimeEnv(): void {
  if (process.env.HOME === undefined || process.env.HOME === "") process.env.HOME = "/tmp";
  if (process.env.TMPDIR === undefined || process.env.TMPDIR === "") process.env.TMPDIR = "/tmp";
}

function errorToken(error: unknown): string {
  if (!(error instanceof Error) || !/^[A-Za-z0-9_.-]{1,64}$/.test(error.name)) return "Error";
  return error.name;
}
