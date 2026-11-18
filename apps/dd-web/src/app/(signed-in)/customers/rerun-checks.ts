"use server";

import { revalidatePath } from "next/cache";
import { withReviewDb } from "../../../review-data";
import { runCustomerChecks } from "../../../rules-run";
import { requireSession } from "../../../session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function rerunChecks(formData: FormData): Promise<void> {
  await requireSession({ path: "/customers/checks" });
  const customerId = formData.get("customerId");
  if (typeof customerId !== "string" || !UUID.test(customerId)) return;
  await withReviewDb((sql) => runCustomerChecks(sql, customerId));
  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
}
