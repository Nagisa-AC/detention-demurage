import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMoney, type Money, type MoneyHint } from "./money.js";
import { unreadable, type Unreadable } from "./dates.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const floatMessage = "money.ts must not use a float.";

describe("parseMoney", () => {
  const accepted: { text: string; hint?: MoneyHint; amount: string; currency: string | null }[] = [
    { text: "$1,750.00", amount: "1750.00", currency: "USD" },
    { text: "$ 1,750.00", amount: "1750.00", currency: "USD" },
    { text: "USD 1,750.00", amount: "1750.00", currency: "USD" },
    { text: "1,750.00 USD", amount: "1750.00", currency: "USD" },
    { text: "usd 1750", amount: "1750", currency: "USD" },
    { text: "1750", amount: "1750", currency: null },
    { text: "1750.00", amount: "1750.00", currency: null },
    { text: "1,750", amount: "1750", currency: null },
    { text: "0.50", amount: "0.50", currency: null },
    { text: "1750.5", amount: "1750.5", currency: null },
    { text: "1,750,000.00", amount: "1750000.00", currency: null },
    { text: "1.750,00 USD", hint: "EU", amount: "1750.00", currency: "USD" },
    { text: "1.750", hint: "EU", amount: "1750", currency: null },
    { text: "1750", hint: "EU", amount: "1750", currency: null },
    { text: "1,75", hint: "EU", amount: "1.75", currency: null },
    { text: "-250.00", amount: "-250.00", currency: null },
    { text: "-$250.00", amount: "-250.00", currency: "USD" },
    { text: "$-250.00", amount: "-250.00", currency: "USD" },
    { text: "(250.00)", amount: "-250.00", currency: null },
    { text: "($250.00)", amount: "-250.00", currency: "USD" },
    { text: "-USD 250.00", amount: "-250.00", currency: "USD" },
    { text: "USD -250.00", amount: "-250.00", currency: "USD" },
    { text: "(1,750.00 USD)", amount: "-1750.00", currency: "USD" },
    { text: "-1.750,00", hint: "EU", amount: "-1750.00", currency: null },
  ];

  it("parses each accepted amount as an exact decimal", () => {
    for (const entry of accepted) {
      const result = read(entry.text, entry.hint);
      expect(result.amount.eq(entry.amount), entry.text).toBe(true);
      expect(result.amount.decimalPlaces(), entry.text).toBe(significantPlaces(entry.amount));
      expect(result.amount.isNegative(), entry.text).toBe(entry.amount.startsWith("-"));
      expect(result.currency, entry.text).toBe(entry.currency);
    }
  });

  it("returns unreadable for ambiguous, marked, or broken text", () => {
    const rejected = [
      "",
      "   ",
      "01750",
      "1.750",
      "1.750,00",
      "12.500",
      "+250.00",
      "250.00 CR",
      "250.00CR",
      "-(250.00)",
      "(-250.00)",
      "($-250.00)",
      "(-$250.00)",
      "$1,750.00 USD",
      "100.00 USD per day",
      "€250.00",
      "1 750.00",
      "1,75",
      "USD",
      "$",
      "--250",
      "250.00-",
      "(250.00",
      "$1,750.00",
    ];
    for (const text of rejected) {
      const hint = text === "$1,750.00" ? "EU" : undefined;
      const result = hint === undefined ? parseMoney(text) : parseMoney(text, hint);
      expect(result, text).toBe(unreadable);
    }
  });
});

function read(text: string, hint?: MoneyHint): Money {
  const result = hint === undefined ? parseMoney(text) : parseMoney(text, hint);
  expect(result, text).not.toBe(unreadable);
  if (isUnreadableResult(result)) throw new Error(text);
  return result;
}

function isUnreadableResult(value: Money | Unreadable): value is Unreadable {
  return !("currency" in value);
}

function significantPlaces(amount: string): number {
  const fraction = amount.replace("-", "").split(".")[1]?.replace(/0+$/, "") ?? "";
  return fraction.length;
}

describe("money float lint", () => {
  it("rejects a float in the money module", async () => {
    const eslint = new ESLint({ cwd: repoRoot, ignore: false });
    const results = await eslint.lintFiles(["packages/dd-core/eslint-fixtures/money-float.ts"]);
    const floats = results.flatMap((result) =>
      result.messages.filter((message) => message.ruleId === "no-restricted-syntax" && message.message === floatMessage),
    );

    expect(floats.length).toBeGreaterThanOrEqual(3);
    expect(floats.every((message) => message.severity === 2)).toBe(true);
  });

  it("leaves money.ts free of floats", async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintFiles(["packages/dd-core/src/normalize/money.ts"]);
    const floats = results.flatMap((result) =>
      result.messages.filter((message) => message.message === floatMessage),
    );

    expect(floats).toEqual([]);
    expect(results.every((result) => result.errorCount === 0)).toBe(true);
  });
});
