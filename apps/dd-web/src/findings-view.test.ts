import { describe, expect, it } from "vitest";
import { minusAmount } from "./review-format";
import { amountsDiffer, checkCells, findingReason, leadFinding, ruleLabel, type StoredFindingView } from "./findings-view";

describe("finding display", () => {
  it("builds a reason from expected and actual, and otherwise uses the rule name", () => {
    expect(findingReason(finding({ actual: "issued 2026-04-08", expected: "issued by 2026-04-01" }))).toBe("issued 2026-04-08");
    expect(findingReason(finding({ actual: "confirmed absent", expected: "Free time start; Free time end" }))).toBe(
      "Free time start; Free time end",
    );
    expect(findingReason(finding({ rule: "R4", actual: "  ", expected: "" }))).toBe("R4");
  });

  it("names the check from the rule and counts findings or citations", () => {
    expect(ruleLabel("R2")).toBe("Late invoice");
    expect(ruleLabel("R9")).toBe("R9");
    expect(checkCells([finding({ rule: "R2", citations: ["46 CFR 541.7(a)"] })])).toEqual([
      { label: "Late invoice", reason: "issued 2026-04-08" },
    ]);
    expect(
      checkCells([
        finding({ id: "a", rule: "R1", citations: ["a", "b", "c", "d"], actual: "confirmed absent", expected: "Free time start" }),
      ]),
    ).toEqual([{ label: "Missing info · 4", reason: "Free time start" }]);
    expect(
      checkCells([
        finding({ id: "line", rule: "R4", actual: "printed 6 days, 1750.00 USD", amount: "250.00" }),
        finding({ id: "total", rule: "R4", actual: "3450.00 USD", amount: "250.00" }),
      ]),
    ).toEqual([{ label: "Arithmetic · 2", reason: "printed 6 days, 1750.00 USD · 3450.00 USD" }]);
  });

  it("treats one stored amount as the invoice dispute and does not add findings together", () => {
    expect(minusAmount("1100.00", "1100.00")).toBe("0.00");
    expect(minusAmount("1600.00", "500.00")).toBe("1,100.00");
    expect(amountsDiffer(["500.00"], ["750.00"])).toBe(true);
    expect(amountsDiffer(["250.00", "250.00"], ["250.00", "250.00"])).toBe(false);
    expect(leadFinding([finding({ id: "small", amount: "250.00" }), finding({ id: "big", amount: "1100.00" })])?.id).toBe("big");
  });
});

function finding(overrides: Partial<StoredFindingView> = {}): StoredFindingView {
  return {
    id: "finding",
    invoiceId: "invoice",
    rule: "R2",
    ruleVersion: 1,
    citations: ["46 CFR 541.7(a)"],
    lineIds: ["ln_1"],
    expected: "issued by 2026-04-01",
    actual: "issued 2026-04-08",
    amount: "1100.00",
    currency: "USD",
    explain: "Charges were last incurred on 2026-03-02.",
    convention: "day1",
    evidence: [{ page: 1, field: "invoice_date" }],
    ...overrides,
  };
}
