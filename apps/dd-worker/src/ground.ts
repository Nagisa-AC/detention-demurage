import { isUnreadable, parseContainer, parseDate, parseMoney, type Money, type Unreadable } from "dd-core";

export type GroundHit = "verbatim" | "normalized" | "miss";

/** Same fold as fixtures/synthetic/extract-text.mjs. Pdf text items are joined without reliable spaces. */
export function foldText(value: string): string {
  return value.replace(/\s+/g, "");
}

/**
 * A value is found only in this page's text.
 * Callers pass one page. This function never sees another page.
 */
export function groundValue(pageText: string, modelText: string): GroundHit {
  if (modelText.trim() === "") return "miss";
  if (foldText(pageText).includes(foldText(modelText))) return "verbatim";
  if (normalizedOnPage(modelText, pageText)) return "normalized";
  return "miss";
}

function normalizedOnPage(model: string, pageText: string): boolean {
  const date = parseDate(model);
  const money = parseMoney(model);
  const container = parseContainer(model);
  if (isUnreadable(date) && isUnreadMoney(money) && isUnreadable(container)) return false;
  const tokens = pageText.split(/\s+/).filter((token) => token.length > 0);
  for (let start = 0; start < tokens.length; start += 1) {
    for (let size = 1; size <= 12 && start + size <= tokens.length; size += 1) {
      const window = tokens.slice(start, start + size).join(" ");
      if (!isUnreadable(date) && parseDate(window) === date) return true;
      if (sameMoney(money, parseMoney(window))) return true;
      const parsed = parseContainer(window);
      if (!isUnreadable(container) && !isUnreadable(parsed) && parsed === container) return true;
    }
  }
  return false;
}

function sameMoney(left: Money | Unreadable, right: Money | Unreadable): boolean {
  if (isUnreadMoney(left) || isUnreadMoney(right)) return false;
  return left.amount.eq(right.amount) && left.currency === right.currency;
}

function isUnreadMoney(value: Money | Unreadable): value is Unreadable {
  return "status" in value;
}
