import { ELEMENT_KEYS, pageExtractionSchema, type PageExtraction } from "dd-core";

const HEADERS = ["invoice_number", "billing_party", "billed_party", "currency"] as const;
const CHARGE_FIELDS = ["container", "charge", "charged_from", "charged_to", "days", "rate", "amount"] as const;
const TOP_LEVEL = new Set<string>([...HEADERS, "elements", "charge_lines"]);
const ELEMENT_KEY_SET = new Set<string>(ELEMENT_KEYS);

export function mapModelText(text: string, page: number): { ok: true; extraction: PageExtraction } | { ok: false; errors: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: "Response is not JSON." };
  }
  const structural = readModel(parsed, page);
  if (!structural.ok) return structural;
  const checked = pageExtractionSchema.safeParse(structural.value);
  if (!checked.success) {
    const errors = checked.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
    return { ok: false, errors: errors === "" ? "The page did not match the schema." : errors };
  }
  return { ok: true, extraction: checked.data };
}

function readModel(parsed: unknown, page: number): { ok: true; value: unknown } | { ok: false; errors: string } {
  if (!isRecord(parsed)) return { ok: false, errors: "Response is not an object." };
  const errors: string[] = [];
  for (const key of Object.keys(parsed)) {
    if (!TOP_LEVEL.has(key)) errors.push(`Unknown field ${key}.`);
  }
  for (const key of TOP_LEVEL) {
    if (!(key in parsed)) errors.push(`Missing field ${key}.`);
  }
  if (errors.length > 0) return { ok: false, errors: errors.join("\n") };

  const value: Record<string, unknown> = { page, elements: {}, charge_lines: [] };
  for (const field of HEADERS) {
    const text = readString(parsed[field], field, errors);
    if (text !== "" && text !== undefined) value[field] = text;
  }

  const elements = readElements(parsed["elements"], page, errors);
  const chargeLines = readChargeLines(parsed["charge_lines"], page, errors);
  if (errors.length > 0) return { ok: false, errors: errors.join("\n") };
  value["elements"] = elements;
  value["charge_lines"] = chargeLines;
  return { ok: true, value };
}

function readElements(value: unknown, page: number, errors: string[]): Record<string, { text: string; page: number }> {
  if (!Array.isArray(value)) {
    errors.push("elements is not an array.");
    return {};
  }
  const elements: Record<string, { text: string; page: number }> = {};
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry)) {
      errors.push("An element is not an object.");
      continue;
    }
    const key = entry["key"];
    const text = entry["text"];
    if (typeof key !== "string" || !ELEMENT_KEY_SET.has(key)) {
      errors.push(`Unknown element key ${String(key)}.`);
      continue;
    }
    if (typeof text !== "string" || text === "") {
      errors.push(`${key} has no text.`);
      continue;
    }
    if (seen.has(key)) {
      errors.push(`${key} appears more than once.`);
      continue;
    }
    seen.add(key);
    elements[key] = { text, page };
  }
  return elements;
}

function readChargeLines(value: unknown, page: number, errors: string[]): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    errors.push("charge_lines is not an array.");
    return [];
  }
  const lines: Record<string, unknown>[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`charge_lines.${index} is not an object.`);
      return;
    }
    const line: Record<string, unknown> = { page };
    let any = false;
    for (const field of CHARGE_FIELDS) {
      const text = readString(entry[field], `charge_lines.${index}.${field}`, errors);
      if (text !== undefined && text !== "") {
        line[field] = text;
        any = true;
      }
    }
    if (any) lines.push(line);
  });
  return lines;
}

function readString(value: unknown, field: string, errors: string[]): string | undefined {
  if (typeof value !== "string") {
    errors.push(`${field} is not a string.`);
    return undefined;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
