export const packageId = "dd-core";

export { CustomerConfigError, customerConfigSchema, loadCustomerConfig } from "./config.js";
export type { ConfigProblem, CustomerConfig } from "./config.js";

export { addDays, dayCount, isUnreadable, parseDate, unreadable } from "./normalize/dates.js";
export type { DayConvention, FormatHint, Unreadable } from "./normalize/dates.js";

export { parseContainer } from "./normalize/container.js";

export { parseMoney } from "./normalize/money.js";
export type { Money, MoneyHint } from "./normalize/money.js";

export { ELEMENT_KEYS, ELEMENTS } from "./elements.js";
export type { Applicability, ElementEntry, ElementKey } from "./elements.js";

export { assignPresence, forRules } from "./presence.js";
export type { Movement, RuleElement } from "./presence.js";

export { requiredElements } from "./rules/requiredElements.js";
export type { RequiredElementsResult, RuleInvoice } from "./rules/requiredElements.js";

export { lateIssuance } from "./rules/lateIssuance.js";
export type { LateConfig, LateInvoice, LateResult } from "./rules/lateIssuance.js";

export { carryDecisions, isConfirmedAbsent, loadReview, startReview, ReviewError, ReviewSession, savedDecisionSchema } from "./review.js";
export type { ConfirmedAbsent, ReviewResult, ReviewedElement, SavedDecision } from "./review.js";

export { StitchError, stitch } from "./stitch.js";

export {
  chargeLineSchema,
  elementConflictSchema,
  elementKeySchema,
  elementRecordSchema,
  elementValueSchema,
  findingSchema,
  fixtureTruthSchema,
  headerConflictSchema,
  invoiceExtractionSchema,
  pageExtractionSchema,
  printedChargeLineSchema,
  printedElementSchema,
  regionSchema,
  stitchedChargeLineSchema,
  stitchedInvoiceSchema,
  unresolvedFragmentSchema,
} from "./schema.js";

export type {
  ChargeLine,
  ElementConflict,
  ElementRecord,
  ElementValue,
  Finding,
  FixtureTruth,
  HeaderConflict,
  InvoiceExtraction,
  PageExtraction,
  PrintedChargeLine,
  PrintedElement,
  Region,
  StitchedChargeLine,
  StitchedInvoice,
  UnresolvedFragment,
} from "./schema.js";
