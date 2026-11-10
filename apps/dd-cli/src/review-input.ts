import fs from "node:fs";
import path from "node:path";
import type { CustomerConfig } from "dd-core";
import { CliError } from "./cli-error.js";

export type ReviewInput = {
  parties: Record<string, string>;
  reissues: { invoice_number: string; reissue_of: string }[];
};

export function readReviewInput(root: string): ReviewInput {
  const file = path.join(root, "review-input.json");
  if (!fs.existsSync(file)) throw new CliError("review-input.json was not found.");
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new CliError("review-input.json is not JSON.");
  }
  if (!isRecord(raw) || !isRecord(raw["parties"]) || !Array.isArray(raw["reissues"])) {
    throw new CliError("review-input.json is invalid.");
  }
  const parties: Record<string, string> = {};
  for (const [invoice, party] of Object.entries(raw["parties"])) {
    if (invoice === "" || typeof party !== "string" || party === "") throw new CliError("review-input.json parties is invalid.");
    parties[invoice] = party;
  }
  const reissues = raw["reissues"].map((entry) => {
    if (!isRecord(entry) || typeof entry["invoice_number"] !== "string" || typeof entry["reissue_of"] !== "string") {
      throw new CliError("review-input.json reissues is invalid.");
    }
    if (entry["invoice_number"] === "" || entry["reissue_of"] === "") throw new CliError("review-input.json reissues is invalid.");
    return { invoice_number: entry["invoice_number"], reissue_of: entry["reissue_of"] };
  });
  return { parties, reissues };
}

/**
 * A reissue is live when that invoice is not itself the original of another link.
 * Two live reissues of one original would both count in the total.
 */
export function validateReviewInput(input: ReviewInput, invoiceNumbers: readonly string[], config: CustomerConfig): void {
  const known = new Set(invoiceNumbers);
  const pursue = new Set(config.billing_parties.pursue);
  const refused = new Set(config.billing_parties.do_not_pursue);
  const problems: string[] = [];
  for (const number of [...invoiceNumbers].sort()) {
    const party = input.parties[number];
    if (party === undefined) problems.push(`${number} has no party id.`);
    else if (!pursue.has(party) && !refused.has(party)) problems.push(`${number} party ${party} is not in the config.`);
  }

  const superseded = new Set(input.reissues.map((link) => link.reissue_of));
  const live = new Map<string, string[]>();
  for (const link of input.reissues) {
    if (link.invoice_number === link.reissue_of) {
      problems.push(`${link.invoice_number} cannot reissue itself.`);
      continue;
    }
    if (!known.has(link.invoice_number)) problems.push(`reissue ${link.invoice_number} is not a reviewed invoice.`);
    if (!known.has(link.reissue_of)) {
      problems.push(`reissue ${link.invoice_number} names ${link.reissue_of}, which is not a reviewed invoice.`);
    }
    if (superseded.has(link.invoice_number)) continue;
    const list = live.get(link.reissue_of) ?? [];
    list.push(link.invoice_number);
    live.set(link.reissue_of, list);
  }
  for (const [original, reissues] of [...live.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1))) {
    if (reissues.length > 1) {
      problems.push(`${original} has ${reissues.length} live reissues: ${[...reissues].sort().join(", ")}.`);
    }
  }
  if (problems.length > 0) throw new CliError(problems.join("\n"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
