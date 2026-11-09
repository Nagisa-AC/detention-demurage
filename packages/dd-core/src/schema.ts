import { z } from "zod";

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

export const elementKeySchema = z.enum(ELEMENT_KEYS);

const money = z.string().regex(/^\d+\.\d{2}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const unit = z.number().min(0).max(1);

export const regionSchema = z.strictObject({
  x: unit,
  y: unit,
  w: unit,
  h: unit,
});

export type Region = z.infer<typeof regionSchema>;

/** What the model read. Strings as printed. No presence state. */
export const printedElementSchema = z.strictObject({
  text: z.string(),
  page: z.int().positive(),
  region: regionSchema.exactOptional(),
});

export type PrintedElement = z.infer<typeof printedElementSchema>;

/** One fragment of a charge row as printed on a single page. A split tail may be only an amount. */
export const printedChargeLineSchema = z.strictObject({
  page: z.int().positive(),
  container: z.string().exactOptional(),
  charge: z.string().exactOptional(),
  charged_from: z.string().exactOptional(),
  charged_to: z.string().exactOptional(),
  days: z.string().exactOptional(),
  rate: z.string().exactOptional(),
  amount: z.string().exactOptional(),
});

export type PrintedChargeLine = z.infer<typeof printedChargeLineSchema>;

/** One model call. Elements and charge lines on this page only. */
export const pageExtractionSchema = z
  .strictObject({
    page: z.int().positive(),
    invoice_number: z.string().exactOptional(),
    billing_party: z.string().exactOptional(),
    billed_party: z.string().exactOptional(),
    currency: currency.exactOptional(),
    elements: z.partialRecord(elementKeySchema, printedElementSchema),
    charge_lines: z.array(printedChargeLineSchema),
  })
  .superRefine((extraction, ctx) => {
    for (const [key, element] of Object.entries(extraction.elements)) {
      if (element !== undefined && element.page !== extraction.page) {
        ctx.addIssue({
          code: "custom",
          message: "Element is from another page.",
          path: ["elements", key, "page"],
        });
      }
    }
    extraction.charge_lines.forEach((line, index) => {
      if (line.page !== extraction.page) {
        ctx.addIssue({
          code: "custom",
          message: "Charge line is from another page.",
          path: ["charge_lines", index, "page"],
        });
      }
    });
  });

export type PageExtraction = z.infer<typeof pageExtractionSchema>;

/** The model's output: one extraction per page. Stitching into one invoice is M1.10. */
export const invoiceExtractionSchema = z.array(pageExtractionSchema);

export type InvoiceExtraction = z.infer<typeof invoiceExtractionSchema>;

const elementStateSchema = z.enum([
  "present",
  "unreadable",
  "suggested_absent",
  "not_applicable",
]);

export const elementValueSchema = z
  .strictObject({
    state: elementStateSchema,
    text: z.string().exactOptional(),
    value: z.string().exactOptional(),
    page: z.int().positive().nullable(),
    region: regionSchema.exactOptional(),
    decided_by: z.string().min(1).exactOptional(),
    decided_at: z.string().min(1).exactOptional(),
  })
  .superRefine((element, ctx) => {
    const seen = element.state === "present" || element.state === "unreadable";
    if (seen && element.page === null) {
      ctx.addIssue({ code: "custom", message: "A seen element has a page.", path: ["page"] });
    }
    if (!seen && element.page !== null) {
      ctx.addIssue({ code: "custom", message: "An unseen element has no page.", path: ["page"] });
    }
    if (element.state === "present" && element.text === undefined) {
      ctx.addIssue({ code: "custom", message: "A present element has text.", path: ["text"] });
    }
  });

export type ElementValue = z.infer<typeof elementValueSchema>;

const elementRecordShape = Object.fromEntries(
  ELEMENT_KEYS.map((key) => [key, elementValueSchema]),
) as Record<ElementKey, typeof elementValueSchema>;

export const elementRecordSchema = z.strictObject(elementRecordShape);

/**
 * Normalized charge line. `id` is assigned at stitch and is never printed.
 * Dates are ISO. `days` is an integer. Money is a two-decimal string.
 */
export const chargeLineSchema = z.strictObject({
  id: z.string().min(1),
  container: z.string().min(1),
  charge: z.enum(["demurrage", "detention"]),
  charged_from: z.iso.date(),
  charged_to: z.iso.date(),
  days: z.int().nonnegative(),
  rate: money,
  amount: money,
});

export type ChargeLine = z.infer<typeof chargeLineSchema>;

const evidenceFieldSchema = z.union([
  elementKeySchema,
  z.enum(["id", "container", "charge", "charged_from", "charged_to", "days", "rate", "amount"]),
]);

export const findingSchema = z.strictObject({
  rule: z.enum(["R1", "R2", "R3", "R4", "R5", "manual"]),
  rule_version: z.int().positive(),
  ground: z.enum([
    "missing_information",
    "late_invoice",
    "billing_error",
    "duplicate_charge",
    "unreasonable_charge",
  ]),
  citations: z.array(z.string().min(1)).min(1),
  invoice_id: z.string().min(1),
  line_ids: z.array(z.string().min(1)),
  expected: z.string(),
  actual: z.string(),
  disputable_amount: money,
  currency,
  evidence: z
    .array(
      z.strictObject({
        page: z.int().positive().nullable(),
        field: evidenceFieldSchema,
      }),
    )
    .min(1),
  explain: z.string().min(1),
});

export type Finding = z.infer<typeof findingSchema>;

const placementSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("row"), page: z.int().positive() }),
  z.strictObject({
    kind: z.literal("split"),
    head_page: z.int().positive(),
    tail_page: z.int().positive(),
  }),
]);

const fixtureChargeLineSchema = z.strictObject({
  container: z.string(),
  charge: z.string(),
  charged_from: z.string(),
  charged_to: z.string(),
  days: z.string(),
  rate: z.string(),
  amount: z.string(),
  placement: placementSchema,
});

const fixtureFindingSchema = z.discriminatedUnion("rule", [
  z.strictObject({
    rule: z.literal("R2"),
    ground: z.literal("late_invoice"),
    citation: z.string().min(1),
    disputable_amount: money,
    currency,
  }),
  z.strictObject({
    rule: z.literal("R4"),
    ground: z.literal("billing_error"),
    part: z.enum(["line", "total"]),
    disputable_amount: money,
    currency,
  }),
  z.strictObject({
    rule: z.literal("R5"),
    ground: z.literal("duplicate_charge"),
    overlapping_days: z.int().positive(),
    disputable_amount: money,
    currency,
  }),
]);

const conventionSideSchema = z.strictObject({
  chargeable_days: z.int().nonnegative(),
  expected_amount: money,
  finding: z.strictObject({
    rule: z.literal("R3"),
    ground: z.literal("billing_error"),
    disputable_amount: money,
    currency,
  }),
});

export const fixtureTruthSchema = z.strictObject({
  id: z.string().min(1),
  invoice_number: z.string().min(1),
  pages: z.int().positive(),
  movement: z.literal("import"),
  currency,
  billing_party: z.string().min(1),
  billed_party: z.string().min(1),
  reissue_of: z.string().nullable(),
  elements: elementRecordSchema,
  charge_lines: z.array(fixtureChargeLineSchema).min(1),
  total_due: money,
  expected_findings: z.array(fixtureFindingSchema),
  convention_sensitive: z.literal(true).exactOptional(),
  by_convention: z
    .strictObject({
      day1: conventionSideSchema,
      day0: conventionSideSchema,
    })
    .exactOptional(),
  review_cases: z
    .strictObject({
      before_review: z.strictObject({
        rule: z.literal("R1"),
        outcome: z.literal("not_evaluable"),
      }),
      after_review: z.strictObject({
        confirmed_absent: z.array(elementKeySchema).min(1),
        finding: z.strictObject({
          rule: z.literal("R1"),
          ground: z.literal("missing_information"),
          citations: z.array(z.string().min(1)).min(1),
          disputable_amount: money,
          currency,
        }),
      }),
    })
    .exactOptional(),
});

export type FixtureTruth = z.infer<typeof fixtureTruthSchema>;
