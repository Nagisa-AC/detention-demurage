/** Fixed sentences stored on a failed report run. The page shows one of these and nothing else. */
export const REPORT_FAILURES = {
  build: "The report could not be built.",
  store: "The report could not be stored.",
  large: "This report is too large to build at once.",
} as const;

export type ReportFailure = keyof typeof REPORT_FAILURES;

export class ReportJobError extends Error {
  readonly reason: ReportFailure;

  constructor(reason: ReportFailure) {
    super(REPORT_FAILURES[reason]);
    this.name = "ReportJobError";
    this.reason = reason;
  }
}

export class LeaseLost extends Error {
  constructor() {
    super("The run lease was lost.");
    this.name = "LeaseLost";
  }
}
