/** Display helpers the browser can import without pulling dd-core into the client bundle. */

export function formatAmount(amount: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (match === null) return amount;
  const sign = match[1] ?? "";
  const whole = match[2] ?? "0";
  const frac = (match[3] ?? "00").slice(0, 2).padEnd(2, "0");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${withCommas}.${frac}`;
}

export function sumAmounts(amounts: readonly string[]): string | null {
  let cents = 0;
  for (const amount of amounts) {
    const parsed = centsOf(amount);
    if (parsed === null) return null;
    cents += parsed;
  }
  return fromCents(cents);
}

/** Billed minus the stored per-invoice counted amount. */
export function minusAmount(billed: string, disputable: string): string | null {
  const left = centsOf(billed);
  const right = centsOf(disputable);
  if (left === null || right === null) return null;
  return fromCents(left - right);
}

function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return formatAmount(`${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`);
}

/** Indexes of text-layer items that contain the query, including a match split across items. */
export function matchingIndexes(parts: readonly string[], query: string): number[] {
  if (query === "") return [];
  const direct: number[] = [];
  parts.forEach((part, index) => {
    if (part.includes(query)) direct.push(index);
  });
  if (direct.length > 0) return direct;
  const starts: number[] = [];
  let offset = 0;
  for (const part of parts) {
    starts.push(offset);
    offset += part.length;
  }
  const joined = parts.join("");
  const hits = new Set<number>();
  let from = 0;
  for (;;) {
    const at = joined.indexOf(query, from);
    if (at < 0) break;
    const end = at + query.length;
    parts.forEach((part, index) => {
      const start = starts[index] ?? 0;
      if (start < end && start + part.length > at) hits.add(index);
    });
    from = at + 1;
  }
  return [...hits];
}

const STATE_LABELS = [
  ["present", "present"],
  ["suggested_absent", "suggested missing"],
  ["unreadable", "unreadable"],
  ["confirmed_absent", "confirmed missing"],
  ["not_applicable", "export only"],
] as const;

/**
 * Counts shown element states. not_applicable is "export only" and is never present.
 * A present value the model did not ground is still present; the header badge covers that.
 */
export function elementStateSummary(states: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const state of states) {
    const known = STATE_LABELS.some(([key]) => key === state);
    const key = known ? state : "present";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return STATE_LABELS.flatMap(([key, label]) => {
    const count = counts.get(key) ?? 0;
    return count === 0 ? [] : [`${count} ${label}`];
  }).join(" · ");
}

function centsOf(amount: string): number | null {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(amount.trim());
  if (match === null) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const whole = Number(match[2]);
  const frac = Number(match[3]);
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(frac)) return null;
  return sign * (whole * 100 + frac);
}
