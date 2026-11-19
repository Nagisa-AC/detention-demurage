"use server";

import { revalidatePath } from "next/cache";
import { saveFirmProfile } from "../../../firm";
import { withReviewDb } from "../../../review-data";
import { requireSession } from "../../../session";

export type FirmFormState = { message: string };

export async function saveFirm(_previous: FirmFormState, formData: FormData): Promise<FirmFormState> {
  const session = await requireSession({ path: "/firm/save" });
  const saved = await withReviewDb((sql) =>
    saveFirmProfile(sql, {
      firmName: text(formData, "firmName"),
      cityState: text(formData, "cityState"),
      replyTo: text(formData, "replyTo"),
      signerName: text(formData, "signerName"),
      signerTitle: text(formData, "signerTitle"),
      actor: session.name,
    }),
  );
  if (saved === null) return { message: "The database is not configured." };
  if (!saved.ok) return { message: saved.message };
  revalidatePath("/firm");
  return { message: saved.unchanged ? "No change to save." : `Saved version ${saved.version}.` };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
