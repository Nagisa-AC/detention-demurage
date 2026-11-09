export const ELEMENT_KEYS = [
  "bl_number",
  "container_number",
  "port_of_discharge",
  "billed_party_basis",
  "invoice_date",
  "invoice_due_date",
  "free_time_days",
  "free_time_start",
  "free_time_end",
  "container_availability_date",
  "earliest_return_date",
  "charged_dates",
  "total_due",
  "applicable_rule",
  "rates",
  "dispute_contact",
  "dispute_info_link",
  "dispute_timeframes",
  "cert_rules_compliance",
  "cert_no_contribution",
] as const;

export type ElementKey = (typeof ELEMENT_KEYS)[number];

export type Applicability = "import" | "export" | "both";

export type ElementEntry = {
  citation: string;
  applicability: Applicability;
  label: string;
};

export const ELEMENTS: Record<ElementKey, ElementEntry> = {
  bl_number: {
    citation: "46 CFR 541.6(a)(1)",
    applicability: "both",
    label: "Bill of lading number",
  },
  container_number: {
    citation: "46 CFR 541.6(a)(2)",
    applicability: "both",
    label: "Container number",
  },
  port_of_discharge: {
    citation: "46 CFR 541.6(a)(3)",
    applicability: "import",
    label: "Port of discharge",
  },
  billed_party_basis: {
    citation: "46 CFR 541.6(a)(4)",
    applicability: "both",
    label: "Billed party basis",
  },
  invoice_date: {
    citation: "46 CFR 541.6(b)(1)",
    applicability: "both",
    label: "Invoice date",
  },
  invoice_due_date: {
    citation: "46 CFR 541.6(b)(2)",
    applicability: "both",
    label: "Invoice due date",
  },
  free_time_days: {
    citation: "46 CFR 541.6(b)(3)",
    applicability: "both",
    label: "Free time",
  },
  free_time_start: {
    citation: "46 CFR 541.6(b)(4)",
    applicability: "both",
    label: "Free time start",
  },
  free_time_end: {
    citation: "46 CFR 541.6(b)(5)",
    applicability: "both",
    label: "Free time end",
  },
  container_availability_date: {
    citation: "46 CFR 541.6(b)(6)",
    applicability: "import",
    label: "Container availability date",
  },
  earliest_return_date: {
    citation: "46 CFR 541.6(b)(7)",
    applicability: "export",
    label: "Earliest return date",
  },
  charged_dates: {
    citation: "46 CFR 541.6(b)(8)",
    applicability: "both",
    label: "Dates charged",
  },
  total_due: {
    citation: "46 CFR 541.6(c)(1)",
    applicability: "both",
    label: "Total amount due",
  },
  applicable_rule: {
    citation: "46 CFR 541.6(c)(2)",
    applicability: "both",
    label: "Applicable rule",
  },
  rates: {
    citation: "46 CFR 541.6(c)(3)",
    applicability: "both",
    label: "Rates",
  },
  dispute_contact: {
    citation: "46 CFR 541.6(d)(1)",
    applicability: "both",
    label: "Dispute contact",
  },
  dispute_info_link: {
    citation: "46 CFR 541.6(d)(2)",
    applicability: "both",
    label: "Dispute information link",
  },
  dispute_timeframes: {
    citation: "46 CFR 541.6(d)(3)",
    applicability: "both",
    label: "Dispute timeframes",
  },
  cert_rules_compliance: {
    citation: "46 CFR 541.6(e)(1)",
    applicability: "both",
    label: "Rules certification",
  },
  cert_no_contribution: {
    citation: "46 CFR 541.6(e)(2)",
    applicability: "both",
    label: "No-contribution certification",
  },
};
