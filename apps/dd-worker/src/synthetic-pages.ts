import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ELEMENT_KEYS,
  fixtureTruthSchema,
  pageExtractionSchema,
  type FixtureTruth,
  type PageExtraction,
  type PrintedChargeLine,
} from "dd-core";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/synthetic");
const LINE_FIELDS = ["container", "charge", "charged_from", "charged_to", "days", "rate", "amount"] as const;
const HEADER_FIELDS = ["invoice_number", "billing_party", "billed_party", "currency"] as const;

export function pagesFromFixture(id: string): PageExtraction[] {
  return pagesFromTruth(readTruth(id));
}

export function textOf(page: PageExtraction): string {
  const parts: string[] = [];
  for (const field of HEADER_FIELDS) {
    const text = page[field];
    if (text !== undefined) parts.push(text);
  }
  for (const element of Object.values(page.elements)) {
    if (element !== undefined) parts.push(element.text);
  }
  for (const line of page.charge_lines) {
    for (const field of LINE_FIELDS) {
      const text = line[field];
      if (text !== undefined) parts.push(text);
    }
  }
  return parts.join("\n");
}

function readTruth(id: string): FixtureTruth {
  return fixtureTruthSchema.parse(JSON.parse(fs.readFileSync(path.join(fixtureDir, `${id}.json`), "utf8")));
}

function pagesFromTruth(truth: FixtureTruth): PageExtraction[] {
  const buckets = new Map<number, { elements: PageExtraction["elements"]; charge_lines: PrintedChargeLine[] }>();
  for (let number = 1; number <= truth.pages; number += 1) {
    buckets.set(number, { elements: {}, charge_lines: [] });
  }
  for (const key of ELEMENT_KEYS) {
    const element = truth.elements[key];
    if (element.state !== "present" || element.page === null || element.text === undefined || element.text === "") continue;
    const bucket = buckets.get(element.page);
    if (bucket === undefined) continue;
    bucket.elements[key] = element.region === undefined
      ? { text: element.text, page: element.page }
      : { text: element.text, page: element.page, region: element.region };
  }
  for (const entry of truth.charge_lines) {
    if (entry.placement.kind === "row") {
      buckets.get(entry.placement.page)?.charge_lines.push(fullLine(entry, entry.placement.page));
      continue;
    }
    buckets.get(entry.placement.head_page)?.charge_lines.push({
      page: entry.placement.head_page,
      container: entry.container,
      charge: entry.charge,
      charged_from: entry.charged_from,
      charged_to: entry.charged_to,
      days: entry.days,
      rate: entry.rate,
    });
    buckets.get(entry.placement.tail_page)?.charge_lines.push({
      page: entry.placement.tail_page,
      amount: entry.amount,
    });
  }
  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([number, bucket]) => {
      const value: Record<string, unknown> = {
        page: number,
        elements: bucket.elements,
        charge_lines: bucket.charge_lines,
      };
      if (number === 1) {
        value["invoice_number"] = truth.invoice_number;
        value["billing_party"] = truth.billing_party;
        value["billed_party"] = truth.billed_party;
        value["currency"] = truth.currency;
      }
      return pageExtractionSchema.parse(value);
    });
}

function fullLine(entry: FixtureTruth["charge_lines"][number], pageNumber: number): PrintedChargeLine {
  return {
    page: pageNumber,
    container: entry.container,
    charge: entry.charge,
    charged_from: entry.charged_from,
    charged_to: entry.charged_to,
    days: entry.days,
    rate: entry.rate,
    amount: entry.amount,
  };
}
