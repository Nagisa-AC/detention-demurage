import { stringify } from "yaml";

/**
 * YAML for one customer config document.
 * The core schema matches parseCustomerConfig, so dates and decimal strings stay strings.
 * This file does not read the filesystem. The settings form imports it in the browser.
 */
export function stringifyCustomerConfig(document: unknown): string {
  return stringify(document, { schema: "core" });
}
