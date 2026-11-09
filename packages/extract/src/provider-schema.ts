import { ELEMENT_KEYS } from "dd-core";

/** Bump this when the JSON schema sent to the model changes. */
export const SCHEMA_VERSION = "1";

/**
 * The grammar sent to the model. Every field is required, and nothing is nullable:
 * a strict schema allows 24 optional fields and 16 unions, and a nullable string is a union.
 * An empty string means the page does not show that text.
 * `key` is the 20 element keys.
 */
export function providerSchema(): { [key: string]: unknown } {
  return {
    type: "object",
    additionalProperties: false,
    required: ["invoice_number", "billing_party", "billed_party", "currency", "elements", "charge_lines"],
    properties: {
      invoice_number: { type: "string" },
      billing_party: { type: "string" },
      billed_party: { type: "string" },
      currency: { type: "string" },
      elements: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "text"],
          properties: {
            key: { type: "string", enum: [...ELEMENT_KEYS] },
            text: { type: "string" },
          },
        },
      },
      charge_lines: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["container", "charge", "charged_from", "charged_to", "days", "rate", "amount"],
          properties: {
            container: { type: "string" },
            charge: { type: "string" },
            charged_from: { type: "string" },
            charged_to: { type: "string" },
            days: { type: "string" },
            rate: { type: "string" },
            amount: { type: "string" },
          },
        },
      },
    },
  };
}
