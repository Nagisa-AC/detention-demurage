import fs from "node:fs";
import { elementRecordSchema, stitchedInvoiceSchema, type ElementRecord, type StitchedInvoice } from "dd-core";
import { CliError } from "./cli-error.js";
import type { Movement } from "./layout.js";

export type PreparedFile = {
  pages: number;
  movement: Movement;
  invoice: StitchedInvoice;
  elements: ElementRecord;
};

export function readPrepared(filePath: string, label = "prepared.json"): PreparedFile {
  if (!fs.existsSync(filePath)) throw new CliError(`${label} was not found.`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new CliError(`${label} is not JSON.`);
  }
  if (!isRecord(raw)) throw new CliError(`${label} is not an object.`);
  if (raw["movement"] !== "import" && raw["movement"] !== "export") throw new CliError(`${label} movement is import or export.`);
  if (typeof raw["pages"] !== "number" || !Number.isInteger(raw["pages"]) || raw["pages"] < 1) {
    throw new CliError(`${label} needs a page count.`);
  }
  const invoice = stitchedInvoiceSchema.safeParse(raw["invoice"]);
  if (!invoice.success) throw new CliError(`${label} invoice did not parse.`);
  const elements = elementRecordSchema.safeParse(raw["elements"]);
  if (!elements.success) throw new CliError(`${label} elements did not parse.`);
  return { pages: raw["pages"], movement: raw["movement"], invoice: invoice.data, elements: elements.data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
