"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addCustomer } from "../../../customers";
import { requireSession } from "../../../session";
import { readCustomerSettings } from "../../../settings";

export type CustomerFormState = { message: string };

export async function createCustomer(_previous: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const session = await requireSession({ path: "/customers" });
  const configId = field(formData, "configId").trim();
  let destination: string | null;
  try {
    const result = await addCustomer({
      displayName: field(formData, "displayName"),
      configId,
      actor: session.name,
    });
    if (!result.ok) return { message: result.message };
    revalidatePath("/customers");
    const created = (await readCustomerSettings()).find((customer) => customer.configId === configId);
    destination = created === undefined ? null : `/customers/${created.id}`;
  } catch {
    return { message: "The customer could not be saved." };
  }
  if (destination !== null) redirect(destination);
  return { message: "Customer added." };
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
