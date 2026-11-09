export const packageId = "dd-core";

export { ELEMENT_KEYS, ELEMENTS } from "./elements.js";
export type { Applicability, ElementEntry, ElementKey } from "./elements.js";

export {
  chargeLineSchema,
  elementKeySchema,
  elementRecordSchema,
  elementValueSchema,
  findingSchema,
  fixtureTruthSchema,
  invoiceExtractionSchema,
  pageExtractionSchema,
  printedChargeLineSchema,
  printedElementSchema,
  regionSchema,
} from "./schema.js";

export type {
  ChargeLine,
  ElementValue,
  Finding,
  FixtureTruth,
  InvoiceExtraction,
  PageExtraction,
  PrintedChargeLine,
  PrintedElement,
  Region,
} from "./schema.js";
