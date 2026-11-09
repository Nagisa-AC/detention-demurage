import { ELEMENT_KEYS, ELEMENTS } from "dd-core";

/** Bump this when the instruction text changes. M1.21 compares runs by it. */
export const PROMPT_VERSION = "1";

/** The instruction sent with every page. It names no customer and no other page. */
export function systemPrompt(): string {
  const fields = ELEMENT_KEYS.map((key) => `${key}: ${ELEMENTS[key].label}`).join("\n");
  return [
    "You read one page of a demurrage or detention invoice.",
    "Copy the text as printed. Do not normalize a date, an amount, or a container number. Do not calculate.",
    "Use an empty string when a header is not on this page.",
    "Include an element only when its text is on this page. Do not say that a field is absent.",
    "A charge line includes only the fragments printed on this page. Use an empty string for a fragment that is not on this page.",
    "",
    fields,
  ].join("\n");
}

export function pageLine(pageNumber: number, retry: { previous: string; errors: string } | null): string {
  const line = `This is page ${pageNumber}.`;
  if (retry === null) return line;
  return `${line}\n\nThe previous response failed validation:\n${retry.errors}\n\nPrevious response:\n${retry.previous}`;
}
