import { NormalizeError, StitchFailure } from "./errors.js";
import type { ClaimedExtract, ClaimedReport, ClaimedRun } from "./queue.js";
import type { ProcessResult, StoredPage } from "./process.js";

type Stage = "download" | "process" | "finish";

export async function runOnce(deps: {
  claim: () => Promise<ClaimedRun | null>;
  download: (key: string) => Promise<Uint8Array>;
  process: (pdf: Uint8Array, declaredHash: string, log: (line: string) => void) => Promise<ProcessResult>;
  finish: (claimed: ClaimedExtract, result: ProcessResult & { permanent: boolean }) => Promise<void>;
  report: (claimed: ClaimedReport) => Promise<"finished" | "retry">;
  log: (line: string) => void;
}): Promise<"idle" | "finished"> {
  const claimed = await deps.claim();
  if (claimed === null) return "idle";
  const log = (line: string) => deps.log(`run ${claimed.id} ${line}`);
  if (claimed.kind === "report") {
    try {
      const outcome = await deps.report(claimed);
      log(outcome === "retry" ? "retry" : "finished");
    } catch (error) {
      log(`failed ${describeFailure("finish", error)}`);
    }
    return "finished";
  }
  let stage: Stage = "download";
  let result: ProcessResult;
  let terminal = false;
  try {
    const pdf = await deps.download(claimed.storageKey);
    stage = "process";
    result = await deps.process(pdf, claimed.sha256, log);
  } catch (error) {
    terminal = error instanceof StitchFailure || error instanceof NormalizeError;
    result = failedResult(stage, error, log);
  }
  const permanent = result.finish === "ok" || claimed.attempts >= 3 || terminal;
  try {
    await deps.finish(claimed, { ...result, permanent });
  } catch (error) {
    log(`failed ${describeFailure("finish", error)}`);
    return "finished";
  }
  log(permanent ? "finished" : "retry");
  return "finished";
}

function failedResult(stage: "download" | "process", error: unknown, log: (line: string) => void): ProcessResult {
  const detail = describeFailure(stage, error);
  log(`failed ${detail}`);
  const page: StoredPage = { page: 1, status: "failed", reason: detail, ungrounded: [] };
  return {
    finish: "failed",
    modelCalled: false,
    pages: [page],
    modelVersion: null,
    promptVersion: null,
    schemaVersion: null,
  };
}

/** Stage, error.name, and a short code. Never the message or the stack. */
function describeFailure(stage: Stage, error: unknown): string {
  const name = token(readField(error, "name")) ?? "Error";
  const code = token(readField(error, "code")) ?? token(readStatus(error));
  return code === undefined ? `${stage} ${name}` : `${stage} ${name} ${code}`;
}

function readField(error: unknown, field: "name" | "code"): string | undefined {
  if (typeof error !== "object" || error === null || !(field in error)) return undefined;
  const value = (error as Record<string, unknown>)[field];
  if (typeof value === "string" || typeof value === "number") return String(value);
  return undefined;
}

function readStatus(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) return undefined;
  const metadata = (error as { $metadata: unknown }).$metadata;
  if (typeof metadata !== "object" || metadata === null || !("httpStatusCode" in metadata)) return undefined;
  const status = (metadata as { httpStatusCode: unknown }).httpStatusCode;
  if (typeof status === "number") return String(status);
  return undefined;
}

function token(value: string | undefined): string | undefined {
  if (value === undefined || !/^[A-Za-z0-9_.-]{1,64}$/.test(value)) return undefined;
  return value;
}
