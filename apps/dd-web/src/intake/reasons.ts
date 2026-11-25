import { realPdfLimits, realPdfMessage, type RealPdfReason } from "dd-core";

const REAL: readonly RealPdfReason[] = ["too_large", "too_many_pages", "encrypted", "malformed"];

/** Staff-facing sentence for a stored rejection code. */
export function rejectionLabel(reason: string): string {
  if (isReal(reason)) return realPdfMessage(reason, realPdfLimits());
  if (reason === "not_synthetic") return "Only a synthetic sample is accepted.";
  if (reason === "checksum") return "The file did not match its checksum.";
  if (reason === "missing") return "The upload was not there to confirm.";
  if (reason === "copy") return "The file could not be stored.";
  return "This upload was not accepted.";
}

function isReal(reason: string): reason is RealPdfReason {
  return (REAL as readonly string[]).includes(reason);
}
