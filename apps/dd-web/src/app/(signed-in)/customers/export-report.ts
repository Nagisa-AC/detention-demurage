"use server";

import { revalidatePath } from "next/cache";
import { enqueueReport } from "../../../report/export";
import { withReviewDb } from "../../../review-data";
import { requireSession } from "../../../session";

export type ExportFormState = { message: string; queued: boolean };

export async function exportReport(_previous: ExportFormState, formData: FormData): Promise<ExportFormState> {
  const session = await requireSession({ path: "/customers/export" });
  const customerId = text(formData, "customerId");
  const result = await withReviewDb((sql) => enqueueReport(sql, { customerId, actor: session.name }));
  if (result === null) return { message: "The database is not configured.", queued: false };
  if (!result.ok) return { message: result.reason, queued: false };
  revalidatePath(`/customers/${customerId}`);
  return { message: "", queued: true };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
