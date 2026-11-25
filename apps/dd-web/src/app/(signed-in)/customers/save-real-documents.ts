"use server";

import { revalidatePath } from "next/cache";
import { setAcceptsRealDocuments, type SettingsProblem } from "../../../settings";
import { requireSession } from "../../../session";

export type RealDocumentsState = { message: string; problems: SettingsProblem[] };

export async function saveRealDocuments(
  _previous: RealDocumentsState,
  formData: FormData,
): Promise<RealDocumentsState> {
  const session = await requireSession({ path: "/customers" });
  const customerId = field(formData, "customerId");
  const accepts = field(formData, "accepts");
  if (field(formData, "confirm") !== "yes" || (accepts !== "true" && accepts !== "false")) {
    return { message: "Confirm the change before saving it.", problems: [] };
  }
  try {
    const result = await setAcceptsRealDocuments({
      customerId,
      accepts: accepts === "true",
      actor: session.name,
    });
    if (result.ok) {
      revalidatePath("/customers");
      revalidatePath(`/customers/${customerId}`);
      revalidatePath(`/customers/${customerId}/settings`);
      const state = accepts === "true" ? "on" : "off";
      return { message: `Real documents are ${state}. Settings version ${result.version}.`, problems: [] };
    }
    return { message: "", problems: result.problems };
  } catch {
    return { message: "The change could not be saved.", problems: [] };
  }
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
