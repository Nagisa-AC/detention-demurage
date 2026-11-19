/** Lowercase, with runs of other characters turned into underscores. At most 64 characters. */
export function suggestConfigId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export const CONFIG_ID = /^[a-z][a-z0-9_]{0,63}$/;
