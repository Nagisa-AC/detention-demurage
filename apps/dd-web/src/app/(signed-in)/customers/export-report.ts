"use server";

import { revalidatePath } from "next/cache";
import { withReviewDb } from "../../../review-data";
import { createReportExport, s3ReportStore } from "../../../report/export";
import { requireSession } from "../../../session";

export type ExportFormState = { message: string; id: string; number: string };

export async function exportReport(_previous: ExportFormState, formData: FormData): Promise<ExportFormState> {
  const session = await requireSession({ path: "/customers/export" });
  const customerId = text(formData, "customerId");
  const store = s3ReportStore();
  if (store === null) return { message: "Report storage is not configured.", id: "", number: "" };
  const result = await withReviewDb((sql) => createReportExport(sql, store, { customerId, actor: session.name }));
  if (result === null) return { message: "The database is not configured.", id: "", number: "" };
  if (!result.ok) return { message: result.reason, id: "", number: "" };
  revalidatePath(`/customers/${customerId}`);
  return { message: "", id: result.id, number: result.number };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
