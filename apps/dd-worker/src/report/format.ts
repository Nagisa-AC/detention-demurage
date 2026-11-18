/** Amount display for the report. The same shapes the web uses on the findings page. */

const RULE_LABELS: Record<string, string> = {
  R1: "Missing info",
  R2: "Late invoice",
  R3: "Free time",
  R4: "Arithmetic",
  R5: "Duplicate",
  manual: "Manual",
};

export function ruleLabel(rule: string): string {
  return RULE_LABELS[rule] ?? rule;
}

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

function centsOf(amount: string): number | null {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(amount.trim());
  if (match === null) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const whole = Number(match[2]);
  const frac = Number(match[3]);
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(frac)) return null;
  return sign * (whole * 100 + frac);
}
