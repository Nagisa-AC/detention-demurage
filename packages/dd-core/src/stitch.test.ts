import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ELEMENT_KEYS } from "./elements.js";
import {
  fixtureTruthSchema,
  pageExtractionSchema,
  stitchedInvoiceSchema,
  type FixtureTruth,
  type PageExtraction,
  type PrintedChargeLine,
} from "./schema.js";
import { StitchError, stitch } from "./stitch.js";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/synthetic");

describe("stitch", () => {
  it("joins the split row at the page break and keeps the page 3 element", () => {
    const truth = readTruth("split_row");
    const stitched = stitch(pagesFromTruth(truth));
    stitchedInvoiceSchema.parse(stitched);

    expect(stitched.charge_lines).toHaveLength(truth.charge_lines.length);
    expect(stitched.charge_lines.map((line) => line.id)).toEqual(["ln_1", "ln_2", "ln_3", "ln_4"]);
    expect(stitched.unresolved).toEqual([]);
    expect(stitched.conflicts).toEqual([]);

    const joined = stitched.charge_lines[3];
    expect(joined?.placement).toEqual({ kind: "split", head_page: 2, tail_page: 3 });
    expect(joined?.container).toEqual({ text: "SLLU0000074", page: 2 });
    expect(joined?.charged_from).toEqual({ text: "2026-05-13", page: 2 });
    expect(joined?.amount).toEqual({ text: "300.00", page: 3 });
    expect(joined?.charge).toEqual({ text: "demurrage", page: 2 });

    expect(stitched.elements.dispute_contact).toEqual({
      text: "disputes@sample-line.example",
      page: 3,
    });
    expect(stitched.elements.earliest_return_date).toBeUndefined();
    expect(stitched.invoice_number).toEqual({ text: "SYN-1008", page: 1 });
    expect(stitched.elements.bl_number?.page).toBe(1);
  });

  it("does not join a mid-page row that has no amount to the next page's tail", () => {
    const stitched = stitch([
      page(1, {
        charge_lines: [
          line(1, { container: "SLLU0000011", charge: "demurrage", amount: "10.00" }),
          line(1, { container: "SLLU0000027", charge: "demurrage", charged_from: "2026-05-13" }),
          line(1, { container: "SLLU0000032", charge: "demurrage", amount: "20.00" }),
        ],
      }),
      page(2, {
        charge_lines: [line(2, { amount: "30.00" })],
      }),
    ]);

    expect(stitched.charge_lines.map((entry) => entry.container.text)).toEqual(["SLLU0000011", "SLLU0000032"]);
    expect(stitched.charge_lines.some((entry) => entry.amount.text === "30.00")).toBe(false);
    expect(stitched.unresolved).toEqual([
      {
        kind: "open_head",
        page: 1,
        container: "SLLU0000027",
        charge: "demurrage",
        charged_from: "2026-05-13",
      },
      { kind: "orphan_tail", page: 2, amount: "30.00" },
    ]);
  });

  it("keeps an orphan tail unresolved", () => {
    const stitched = stitch([
      page(1, {
        charge_lines: [line(1, { container: "SLLU0000011", charge: "demurrage", amount: "10.00" })],
      }),
      page(2, {
        charge_lines: [line(2, { amount: "30.00", rate: "100.00" })],
      }),
    ]);

    expect(stitched.charge_lines).toHaveLength(1);
    expect(stitched.charge_lines[0]?.id).toBe("ln_1");
    expect(stitched.unresolved).toEqual([{ kind: "orphan_tail", page: 2, rate: "100.00", amount: "30.00" }]);
  });

  it("records both texts when one key disagrees and keeps the earlier page when they agree", () => {
    const stitched = stitch([
      page(1, {
        invoice_number: "SYN-1008",
        elements: {
          invoice_date: { text: "2026-05-22", page: 1 },
          bl_number: { text: "SYN-BL-1008", page: 1 },
        },
      }),
      page(2, {
        invoice_number: "SYN-9999",
        elements: {
          invoice_date: { text: "2026-05-23", page: 2 },
          bl_number: { text: "SYN-BL-1008", page: 2 },
        },
      }),
    ]);

    expect(stitched.elements.invoice_date).toBeUndefined();
    expect(stitched.conflicts).toEqual([
      {
        key: "invoice_date",
        values: [
          { text: "2026-05-22", page: 1 },
          { text: "2026-05-23", page: 2 },
        ],
      },
    ]);
    expect(stitched.elements.bl_number).toEqual({ text: "SYN-BL-1008", page: 1 });
    expect(stitched.invoice_number).toBeUndefined();
    expect(stitched.header_conflicts).toEqual([
      {
        field: "invoice_number",
        values: [
          { text: "SYN-1008", page: 1 },
          { text: "SYN-9999", page: 2 },
        ],
      },
    ]);
  });

  it("leaves a printed date as printed text", () => {
    const stitched = stitch([
      page(1, {
        charge_lines: [
          line(1, {
            container: "SLLU0000011",
            charged_from: "13 May 2026",
            amount: "300.00",
          }),
        ],
      }),
    ]);

    expect(stitched.charge_lines[0]?.charged_from).toEqual({ text: "13 May 2026", page: 1 });
    expect(stitched.charge_lines[0]?.amount).toEqual({ text: "300.00", page: 1 });
  });

  it("throws when a page is missing and does not throw for an unresolved row", () => {
    expect(() => stitch([page(1, {}), page(3, {})])).toThrow(StitchError);
    expect(() => stitch([page(1, {}), page(3, {})])).toThrow("Page 2 is missing.");
    expect(() => stitch([page(1, {}), page(1, {})])).toThrow("A page number is repeated.");

    const stitched = stitch([
      page(1, {
        charge_lines: [line(1, { container: "SLLU0000011", charge: "demurrage" })],
      }),
    ]);
    expect(stitched.charge_lines).toEqual([]);
    expect(stitched.unresolved).toEqual([
      { kind: "open_head", page: 1, container: "SLLU0000011", charge: "demurrage" },
    ]);
  });
});

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

function page(pageNumber: number, input: {
  invoice_number?: string;
  elements?: PageExtraction["elements"];
  charge_lines?: PrintedChargeLine[];
}): PageExtraction {
  const value: Record<string, unknown> = {
    page: pageNumber,
    elements: input.elements ?? {},
    charge_lines: input.charge_lines ?? [],
  };
  if (input.invoice_number !== undefined) value["invoice_number"] = input.invoice_number;
  return pageExtractionSchema.parse(value);
}

function line(pageNumber: number, fields: Omit<PrintedChargeLine, "page">): PrintedChargeLine {
  return { page: pageNumber, ...fields };
}
