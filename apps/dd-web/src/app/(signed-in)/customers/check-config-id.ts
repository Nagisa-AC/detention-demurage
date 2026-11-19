"use server";

import { readCustomerSettings } from "../../../settings";
import { requireSession } from "../../../session";
import { CONFIG_ID } from "./config-id";

export type ConfigIdStatus = "available" | "taken" | "invalid";

/** Whether this customer id is free. The create action still rejects a duplicate. */
export async function checkConfigId(configId: string): Promise<ConfigIdStatus> {
  await requireSession({ path: "/customers" });
  const id = configId.trim();
  if (!CONFIG_ID.test(id)) return "invalid";
  const customers = await readCustomerSettings();
  return customers.some((customer) => customer.configId === id) ? "taken" : "available";
}
