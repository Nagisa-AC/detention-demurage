"use server";

import { revalidatePath } from "next/cache";
import { saveCustomerSettings, type SettingsProblem } from "../../../settings";
import { requireSession } from "../../../session";

export type SettingsFormState = { message: string; problems: SettingsProblem[] };

export async function saveSettings(_previous: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  const session = await requireSession({ path: "/customers" });
  try {
    const customerId = field(formData, "customerId");
    const result = await saveCustomerSettings({
      customerId,
      yaml: field(formData, "yaml"),
      actor: session.name,
    });
    if (result.ok) {
      revalidatePath("/customers");
      revalidatePath(`/customers/${customerId}`);
      revalidatePath(`/customers/${customerId}/settings`);
      return { message: `Settings saved as version ${result.version}.`, problems: [] };
    }
    return { message: "", problems: result.problems };
  } catch {
    return { message: "Settings could not be saved.", problems: [] };
  }
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
