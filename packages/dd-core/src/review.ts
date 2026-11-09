import type { Region } from "./schema.js";

/**
 * Only this file can set the brand. A ConfirmedAbsent value requires it,
 * so an object literal in any other module does not typecheck.
 */
const confirmedAbsentBrand: unique symbol = Symbol("confirmedAbsent");

export type ConfirmedAbsent = {
  readonly [confirmedAbsentBrand]: true;
  state: "confirmed_absent";
  page: null;
  text?: string;
  value?: string;
  region?: Region;
  decided_by?: string;
  decided_at?: string;
};

/** The review flow in M1.12 is what calls this. The brand never leaves this file. */
function confirmAbsent(input: { decided_by: string; decided_at: string }): ConfirmedAbsent {
  return {
    [confirmedAbsentBrand]: true,
    state: "confirmed_absent",
    page: null,
    decided_by: input.decided_by,
    decided_at: input.decided_at,
  };
}

// Kept here until M1.12 calls it. Another file cannot set the brand.
void confirmAbsent;

export function isConfirmedAbsent(value: unknown): value is ConfirmedAbsent {
  return typeof value === "object" && value !== null && confirmedAbsentBrand in value;
}
