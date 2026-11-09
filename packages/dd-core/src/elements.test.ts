import { describe, expect, it } from "vitest";
import { ELEMENT_KEYS, ELEMENTS, type ElementKey } from "./elements.js";

const expected: Record<ElementKey, { citation: string; applicability: "import" | "export" | "both"; label: string }> = {
  bl_number: { citation: "46 CFR 541.6(a)(1)", applicability: "both", label: "Bill of lading number" },
  container_number: { citation: "46 CFR 541.6(a)(2)", applicability: "both", label: "Container number" },
  port_of_discharge: { citation: "46 CFR 541.6(a)(3)", applicability: "import", label: "Port of discharge" },
  billed_party_basis: { citation: "46 CFR 541.6(a)(4)", applicability: "both", label: "Billed party basis" },
  invoice_date: { citation: "46 CFR 541.6(b)(1)", applicability: "both", label: "Invoice date" },
  invoice_due_date: { citation: "46 CFR 541.6(b)(2)", applicability: "both", label: "Invoice due date" },
  free_time_days: { citation: "46 CFR 541.6(b)(3)", applicability: "both", label: "Free time" },
  free_time_start: { citation: "46 CFR 541.6(b)(4)", applicability: "both", label: "Free time start" },
  free_time_end: { citation: "46 CFR 541.6(b)(5)", applicability: "both", label: "Free time end" },
  container_availability_date: {
    citation: "46 CFR 541.6(b)(6)",
    applicability: "import",
    label: "Container availability date",
  },
  earliest_return_date: { citation: "46 CFR 541.6(b)(7)", applicability: "export", label: "Earliest return date" },
  charged_dates: { citation: "46 CFR 541.6(b)(8)", applicability: "both", label: "Dates charged" },
  total_due: { citation: "46 CFR 541.6(c)(1)", applicability: "both", label: "Total amount due" },
  applicable_rule: { citation: "46 CFR 541.6(c)(2)", applicability: "both", label: "Applicable rule" },
  rates: { citation: "46 CFR 541.6(c)(3)", applicability: "both", label: "Rates" },
  dispute_contact: { citation: "46 CFR 541.6(d)(1)", applicability: "both", label: "Dispute contact" },
  dispute_info_link: { citation: "46 CFR 541.6(d)(2)", applicability: "both", label: "Dispute information link" },
  dispute_timeframes: { citation: "46 CFR 541.6(d)(3)", applicability: "both", label: "Dispute timeframes" },
  cert_rules_compliance: { citation: "46 CFR 541.6(e)(1)", applicability: "both", label: "Rules certification" },
  cert_no_contribution: { citation: "46 CFR 541.6(e)(2)", applicability: "both", label: "No-contribution certification" },
};

describe("elements", () => {
  it("lists the twenty 541.6 elements in paragraph order", () => {
    expect(ELEMENT_KEYS).toHaveLength(20);
    expect(Object.keys(ELEMENTS)).toEqual([...ELEMENT_KEYS]);
    for (const key of ELEMENT_KEYS) {
      expect(ELEMENTS[key]).toEqual(expected[key]);
    }
  });

  it("applies nineteen elements to imports and keeps earliest return export-only", () => {
    const importKeys = ELEMENT_KEYS.filter((key) => ELEMENTS[key].applicability !== "export");
    expect(importKeys).toHaveLength(19);
    expect(ELEMENTS.earliest_return_date.applicability).toBe("export");
    expect(ELEMENTS.port_of_discharge.applicability).toBe("import");
    expect(ELEMENTS.container_availability_date.applicability).toBe("import");
  });
});
