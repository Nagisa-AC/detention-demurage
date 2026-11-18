"use server";

import { revalidatePath } from "next/cache";
import { ELEMENT_KEYS, type ElementKey } from "dd-core";
import { recordApproval, recordBillingParty, recordDecision, withReviewDb } from "../../../review-data";
import { runChecksForInvoice } from "../../../rules-run";
import type { DecisionCommand } from "../../../review-view";
import { requireSession } from "../../../session";

export type ReviewActionState = { message: string };

const NOT_CONFIGURED = "The database is not configured.";
const NOT_SAVED = "The decision could not be saved.";

export async function decideElement(
  _previous: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const session = await requireSession({ path: "/review/decision" });
  const invoiceId = text(formData, "invoiceId");
  const command = commandOf(formData);
  if (command === null) return { message: "That element is not on the invoice." };
  const at = new Date().toISOString();
  try {
    const result = await withReviewDb((sql) =>
      recordDecision(sql, { invoiceId, actor: session.name, at, command }),
    );
    if (result === null) return { message: NOT_CONFIGURED };
    if (!result.ok) return { message: result.message };
  } catch {
    return { message: NOT_SAVED };
  }
  revalidatePath("/review");
  revalidatePath(`/review/${invoiceId}`);
  return { message: "" };
}

export async function approveInvoice(
  invoiceId: string,
  acknowledgedPages: readonly number[],
): Promise<ReviewActionState> {
  const session = await requireSession({ path: "/review/approve" });
  const at = new Date().toISOString();
  try {
    const result = await withReviewDb((sql) =>
      recordApproval(sql, { invoiceId, actor: session.name, at, acknowledgedPages }),
    );
    if (result === null) return { message: NOT_CONFIGURED };
    if (!result.ok) return { message: result.message };
  } catch {
    return { message: NOT_SAVED };
  }
  try {
    await withReviewDb((sql) => runChecksForInvoice(sql, invoiceId));
  } catch {
    // The approval is already committed. The customer page shows the failed run.
  }
  revalidatePath("/review");
  revalidatePath(`/review/${invoiceId}`);
  revalidatePath("/customers");
  return { message: "" };
}

export async function setBillingParty(
  invoiceId: string,
  partyId: string,
  backfill: boolean,
): Promise<ReviewActionState> {
  const session = await requireSession({ path: "/review/billing-party" });
  const at = new Date().toISOString();
  try {
    const result = await withReviewDb((sql) =>
      recordBillingParty(sql, { invoiceId, partyId, actor: session.name, at, backfill }),
    );
    if (result === null) return { message: NOT_CONFIGURED };
    if (!result.ok) return { message: result.message };
  } catch {
    return { message: NOT_SAVED };
  }
  revalidatePath("/review");
  revalidatePath(`/review/${invoiceId}`);
  return { message: "" };
}

function commandOf(formData: FormData): DecisionCommand | null {
  const key = text(formData, "elementKey");
  if (!isElementKey(key)) return null;
  const kind = text(formData, "command");
  if (kind === "confirm_missing") return { kind, key };
  if (kind === "keep") return { kind, key };
  if (kind === "mark_present") {
    const page = Number(text(formData, "page"));
    return { kind, key, page, text: text(formData, "text") };
  }
  if (kind === "correct") return { kind, key, text: text(formData, "text") };
  return null;
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function isElementKey(value: string): value is ElementKey {
  return (ELEMENT_KEYS as readonly string[]).includes(value);
}
