"use server";

import { revalidatePath } from "next/cache";
import { recordPublication } from "../../../publish";
import { withReviewDb } from "../../../review-data";
import { requireSession } from "../../../session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function publishResults(formData: FormData): Promise<void> {
  const session = await requireSession({ path: "/customers/publish" });
  const customerId = formData.get("customerId");
  if (typeof customerId !== "string" || !UUID.test(customerId)) return;
  await withReviewDb((sql) => recordPublication(sql, customerId, session.name));
  revalidatePath(`/customers/${customerId}`);
}
