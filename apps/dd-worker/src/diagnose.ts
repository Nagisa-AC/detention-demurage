import { sha256Hex, type ProcessResult } from "./process.js";

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type DiagnoseDocument = {
  storageKey: string;
  sha256: string;
  customerId?: string;
};

/**
 * Process one run and write the outcome to `write`.
 * A hash outside the synthetic allowlist is refused before download.
 * A thrown error's message and stack are written here, never to the journal by this function.
 */
export async function diagnoseRun(input: {
  runId: string;
  allow: ReadonlySet<string>;
  acceptsReal?: (customerId: string) => Promise<boolean>;
  load: (runId: string) => Promise<DiagnoseDocument | null>;
  download: (key: string) => Promise<Uint8Array>;
  process: (pdf: Uint8Array, declaredHash: string) => Promise<ProcessResult>;
  write: (line: string) => void;
  secrets?: readonly string[];
}): Promise<number> {
  if (!RUN_ID.test(input.runId)) {
    input.write("Run id must be a UUID.");
    return 1;
  }
  const secrets = input.secrets ?? [];
  let document: DiagnoseDocument | null;
  try {
    document = await input.load(input.runId);
  } catch (error) {
    input.write(formatFailure(error, secrets));
    return 1;
  }
  if (document === null) {
    input.write("No run was found.");
    return 1;
  }
  if (!input.allow.has(document.sha256)) {
    const accepts =
      document.customerId !== undefined && input.acceptsReal !== undefined
        ? await input.acceptsReal(document.customerId)
        : false;
    if (!accepts) {
      input.write("refused not_synthetic");
      return 1;
    }
  }
  let pdf: Uint8Array;
  try {
    pdf = await input.download(document.storageKey);
  } catch (error) {
    input.write(formatFailure(error, secrets));
    return 1;
  }
  if (sha256Hex(pdf) !== document.sha256) {
    input.write("refused checksum");
    return 1;
  }
  try {
    const result = await input.process(pdf, document.sha256);
    if (result.finish === "failed") {
      input.write("finish failed");
      for (const page of result.pages) {
        if (page.reason !== undefined) input.write(`page ${page.page} ${page.reason}`);
      }
      return 1;
    }
    input.write("diagnose ok");
    return 0;
  } catch (error) {
    input.write(formatFailure(error, secrets));
    return 1;
  }
}

/** Message and stack, with the supplied secret values removed. */
export function formatFailure(error: unknown, secrets: readonly string[]): string {
  const text = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : "Error";
  return redact(text, secrets);
}

function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret === "") continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}
