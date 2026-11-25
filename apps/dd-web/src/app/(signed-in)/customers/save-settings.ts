"use server";

import { revalidatePath } from "next/cache";
import { saveCustomerSettings, type SettingsProblem } from "../../../settings";
import { isSettingsDraft, settingsYaml } from "../../../settings-draft";
import { requireSession } from "../../../session";

export type SettingsFormState = { message: string; problems: SettingsProblem[] };

export async function saveSettings(_previous: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  const session = await requireSession({ path: "/customers" });
  const customerId = field(formData, "customerId");
  let draft: unknown;
  try {
    draft = JSON.parse(field(formData, "draft"));
  } catch {
    return { message: "", problems: [{ path: "document", message: "is not a valid form" }] };
  }
  if (!isSettingsDraft(draft)) {
    return { message: "", problems: [{ path: "document", message: "is not a valid form" }] };
  }
  try {
    const result = await saveCustomerSettings({
      customerId,
      yaml: settingsYaml(draft),
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
