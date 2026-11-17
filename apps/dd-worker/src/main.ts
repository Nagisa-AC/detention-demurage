import path from "node:path";
import { fileURLToPath } from "node:url";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { extract } from "dd-extract";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import pg from "pg";
import { syntheticAllowlist } from "./allow.js";
import { runOnce } from "./loop.js";
import { readModelPages } from "./model.js";
import { readPdfPages } from "./pdf-text.js";
import { processDocument } from "./process.js";
import { claimNext, finishRun } from "./queue.js";
import { readWorkerSecrets } from "./ssm.js";

const REGION = "us-east-2";

export async function main(): Promise<void> {
  const ssm = new SSMClient({ region: REGION });
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
  const s3 = new S3Client({ region: REGION });
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
  if (process.argv.includes("--self-check")) {
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
  void main();
}
