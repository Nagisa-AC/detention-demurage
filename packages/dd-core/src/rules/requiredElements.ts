import { Decimal } from "decimal.js";
import { ELEMENT_KEYS, ELEMENTS, type ElementKey } from "../elements.js";
import { parseMoney } from "../normalize/money.js";
import { forRules } from "../presence.js";
import { isConfirmedAbsent, type ConfirmedAbsent } from "../review.js";
import { findingSchema, type ElementValue, type Finding } from "../schema.js";

export type RuleInvoice = {
  invoice_number: string;
  currency: string;
  lines: readonly { id: string; amount: string }[];
  elements: Record<ElementKey, ElementValue | ConfirmedAbsent>;
};

export type RequiredElementsResult =
  | { outcome: "finding"; finding: Finding }
  | { outcome: "not_evaluable" }
  | { outcome: "none" };

const notEvaluable = { outcome: "not_evaluable" } as const;
const moneyText = /^\d+\.\d{2}$/;

/**
 * R1. One finding lists every confirmed absence.
 * A suggested absence or an unreadable element blocks the rule.
 * The amount is the printed total, or the sum of the charge lines when that total is confirmed absent.
 */
export function requiredElements(invoice: RuleInvoice): RequiredElementsResult {
  const absent: ElementKey[] = [];
  let totalValue: string | undefined;
  let totalAbsent = false;

  for (const key of ELEMENT_KEYS) {
    const view = forRules(invoice.elements[key]);
    if (view.state === "suggested_absent" || view.state === "unreadable") return notEvaluable;
    if (isConfirmedAbsent(view)) {
      absent.push(key);
      if (key === "total_due") totalAbsent = true;
      continue;
    }
    if (view.state === "present") {
      if (key === "total_due") totalValue = view.value;
      continue;
    }
    if (view.state === "not_applicable") continue;
    throw new Error("That element is not a rule input.");
  }

  if (absent.length === 0) return { outcome: "none" };
  if (!/^[A-Z]{3}$/.test(invoice.currency) || invoice.invoice_number.trim() === "") return notEvaluable;
  if (invoice.lines.some((line) => line.id.trim() === "")) return notEvaluable;

  const amount = totalAbsent ? sumLines(invoice.lines, invoice.currency) : printedTotal(totalValue);
  if (amount === null) return notEvaluable;

  const labels = absent.map((key) => ELEMENTS[key].label).join("; ");
  const ending = totalAbsent
    ? `Invoice total not printed; charge lines sum to ${amount} ${invoice.currency}.`
    : `Invoice total ${amount} ${invoice.currency}.`;
  return {
    outcome: "finding",
    finding: findingSchema.parse({
      rule: "R1",
      rule_version: 1,
      ground: "missing_information",
      citations: absent.map((key) => ELEMENTS[key].citation),
      invoice_id: invoice.invoice_number,
      line_ids: invoice.lines.map((line) => line.id),
      expected: labels,
      actual: "confirmed absent",
      disputable_amount: amount,
      currency: invoice.currency,
      evidence: absent.map((key) => ({ page: null, field: key })),
      explain: `Confirmed absent: ${labels}. ${ending}`,
    }),
  };
}

function printedTotal(value: string | undefined): string | null {
  if (value === undefined || !moneyText.test(value)) return null;
  return value;
}

function sumLines(lines: readonly { amount: string }[], currency: string): string | null {
  let sum = new Decimal("0");
  for (const line of lines) {
    const parsed = parseMoney(line.amount);
    if ("status" in parsed) return null;
    if (parsed.currency !== null && parsed.currency !== currency) return null;
    sum = sum.plus(parsed.amount);
  }
  const amount = sum.toFixed(2);
  if (!moneyText.test(amount)) return null;
  return amount;
}
