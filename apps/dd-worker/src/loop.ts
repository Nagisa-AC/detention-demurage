import type { ClaimedRun } from "./queue.js";
import type { ProcessResult, StoredPage } from "./process.js";

export async function runOnce(deps: {
  claim: () => Promise<ClaimedRun | null>;
  download: (key: string) => Promise<Uint8Array>;
  process: (pdf: Uint8Array, declaredHash: string) => Promise<ProcessResult>;
  finish: (claimed: ClaimedRun, result: ProcessResult & { permanent: boolean }) => Promise<void>;
  log: (line: string) => void;
}): Promise<"idle" | "finished"> {
  const claimed = await deps.claim();
  if (claimed === null) return "idle";
  let result: ProcessResult;
  try {
    const pdf = await deps.download(claimed.storageKey);
    result = await deps.process(pdf, claimed.sha256);
  } catch {
    deps.log("run failed");
    const page: StoredPage = { page: 1, status: "failed", reason: "worker_error", ungrounded: [] };
    result = {
      finish: "failed",
      modelCalled: false,
      pages: [page],
      modelVersion: null,
      promptVersion: null,
      schemaVersion: null,
    };
  }
  const permanent = result.finish === "ok" || claimed.attempts >= 3;
  await deps.finish(claimed, { ...result, permanent });
  deps.log(permanent ? "run finished" : "run retry");
  return "finished";
}
