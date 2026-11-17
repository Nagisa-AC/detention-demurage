"use server";

import { revalidatePath } from "next/cache";
import { addCustomer } from "../../../customers";
import { requireSession } from "../../../session";

export type CustomerFormState = { message: string };

export async function createCustomer(_previous: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const session = await requireSession({ path: "/customers" });
  try {
    const result = await addCustomer({
      displayName: field(formData, "displayName"),
      configId: field(formData, "configId"),
      actor: session.name,
    });
    if (result.ok) {
      revalidatePath("/customers");
      return { message: "Customer added." };
    }
    return { message: result.message };
  } catch {
    return { message: "The customer could not be saved." };
  }
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
