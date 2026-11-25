import { ELEMENT_KEYS, pageExtractionSchema, parseContainer, type PageExtraction } from "dd-core";
import { describe, expect, it } from "vitest";
import { NormalizeError, StitchFailure } from "./errors.js";
import { extractionValues } from "./model.js";
import { processDocument, sha256Hex, type GroundPage } from "./process.js";
import { pagesFromFixture, textOf } from "./synthetic-pages.js";

const page = (number: number): GroundPage => ({
  page: number,
  status: "ok",
  attempts: 1,
  model: "fake",
  promptVersion: "1",
  schemaVersion: "1",
  values: [],
});

const SECRET = "marked-secret-value";

describe("processDocument", () => {
  it("does not call the model when the hash is outside the eight or the bytes differ", async () => {
    const pdf = new Uint8Array([1, 2, 3, 4]);
    const hash = sha256Hex(pdf);
    const extract = (): Promise<GroundPage[]> => Promise.reject(new Error("model called"));
    const outside = await processDocument({
      pdf,
      declaredHash: hash,
      allow: new Set(),
      readPages: async () => ["text"],
      extract,
    });
    expect(outside.modelCalled).toBe(false);
    expect(outside.pages[0]?.reason).toBe("not_synthetic");
    const mismatch = await processDocument({
      pdf,
      declaredHash: "ab".repeat(32),
      allow: new Set([hash]),
      readPages: async () => ["text"],
      extract,
    });
    expect(mismatch.modelCalled).toBe(false);
    expect(mismatch.pages[0]?.reason).toBe("checksum");
  });

  it("accepts a real PDF and refuses size, pages, encryption, and a file it cannot read", async () => {
    const pdf = new Uint8Array([1, 2, 3, 4]);
    const hash = sha256Hex(pdf);
    const limits = { maxBytes: 3, maxPages: 2 };
    let extracted = false;
    const accepted = await processDocument({
      pdf,
      declaredHash: hash,
      allow: new Set(),
      acceptsReal: true,
      limits: { maxBytes: 10, maxPages: 2 },
      inspect: async () => ({ kind: "ok", pages: 1 }),
      readPages: async () => ["Invoice text"],
      extract: async () => {
        extracted = true;
        return [page(1)];
      },
    });
    expect(accepted.modelCalled).toBe(true);
    expect(extracted).toBe(true);

    const tooLarge = await processDocument({
      pdf,
      declaredHash: hash,
      allow: new Set(),
      acceptsReal: true,
      limits,
      inspect: async () => ({ kind: "ok", pages: 1 }),
      readPages: async () => ["text"],
      extract: () => Promise.reject(new Error("model called")),
    });
    expect(tooLarge.pages[0]?.reason).toBe("too_large");
    expect(tooLarge.modelCalled).toBe(false);

    const long = await processDocument({
      pdf,
      declaredHash: hash,
      allow: new Set(),
      acceptsReal: true,
      limits: { maxBytes: 10, maxPages: 1 },
      inspect: async () => ({ kind: "ok", pages: 2 }),
      readPages: async () => ["one", "two"],
      extract: () => Promise.reject(new Error("model called")),
    });
    expect(long.pages[0]?.reason).toBe("too_many_pages");

    const locked = await processDocument({
      pdf,
      declaredHash: hash,
      allow: new Set(),
      acceptsReal: true,
      inspect: async () => ({ kind: "encrypted" }),
      readPages: async () => ["text"],
      extract: () => Promise.reject(new Error("model called")),
    });
    expect(locked.pages[0]?.reason).toBe("encrypted");

    let read = false;
    const broken = await processDocument({
      pdf,
      declaredHash: hash,
      allow: new Set(),
      acceptsReal: true,
      inspect: async () => ({ kind: "malformed" }),
      readPages: async () => {
        read = true;
        return ["text"];
      },
      extract: () => Promise.reject(new Error("model called")),
    });
    expect(broken.finish).toBe("failed");
    expect(broken.modelCalled).toBe(false);
    expect(broken.pages[0]?.reason).toBe("malformed");
    expect(read).toBe(false);

    const thrown = await processDocument({
      pdf,
      declaredHash: hash,
      allow: new Set(),
      acceptsReal: true,
      inspect: async () => ({ kind: "ok", pages: 1 }),
      readPages: async () => {
        const error = new Error("bad");
        error.name = "InvalidPDFException";
        throw error;
      },
      extract: () => Promise.reject(new Error("model called")),
    });
    expect(thrown.pages[0]?.reason).toBe("malformed");
    expect(thrown.modelCalled).toBe(false);
  });

  it("still accepts a synthetic PDF when real documents are on", async () => {
    const pdf = new Uint8Array([8]);
    const hash = sha256Hex(pdf);
    let inspected = false;
    const result = await processDocument({
      pdf,
      declaredHash: hash,
      allow: new Set([hash]),
      acceptsReal: false,
      inspect: async () => {
        inspected = true;
        return { kind: "malformed" };
      },
      readPages: async () => ["Invoice text"],
      extract: async () => [page(1)],
    });
    expect(inspected).toBe(false);
    expect(result.modelCalled).toBe(true);
  });

  it("skips the model when the text layer is empty and does not call those elements ungrounded", async () => {
    const pdf = new Uint8Array([9]);
    const hash = sha256Hex(pdf);
    const result = await processDocument({
      pdf,
      declaredHash: hash,
      allow: new Set([hash]),
      readPages: async () => ["", "   "],
      extract: () => Promise.reject(new Error("model called")),
    });
    expect(result.modelCalled).toBe(false);
    expect(result.finish).toBe("ok");
    expect(result.read).toBeUndefined();
    expect(result.pages.map((page) => page.status)).toEqual(["no_text_layer", "no_text_layer"]);
    for (const page of result.pages) expect(page.ungrounded).toEqual([]);
  });

  it("keeps a verbatim value, a normalized date, and a miss, on that page only", async () => {
    const pdf = new Uint8Array([7, 7]);
    const hash = sha256Hex(pdf);
    const logs: string[] = [];
    let requested: readonly number[] = [];
    const result = await processDocument({
      pdf,
      declaredHash: hash,
      allow: new Set([hash]),
      readPages: async () => ["Invoice SYN-1001 March 2, 2026", ""],
      extract: async (_pdf, pages) => {
        requested = pages;
        const page: GroundPage = {
          page: 1,
          status: "ok",
          attempts: 1,
          model: "fake",
          promptVersion: "1",
          schemaVersion: "1",
          values: [
            { field: "invoice_number", text: "SYN-1001" },
            { field: "invoice_date", text: "2026-03-02" },
            { field: "bl_number", text: SECRET },
            { field: "port_of_discharge", text: "second page only" },
          ],
        };
        return [page];
      },
      log: (line) => logs.push(line),
    });
    expect(requested).toEqual([1]);
    const stored = result.pages.find((page) => page.page === 1);
    expect(stored?.ungrounded).toEqual(["bl_number", "port_of_discharge"]);
    const body = JSON.stringify(result);
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain("SYN-1001");
    expect(logs.join("\n")).not.toContain(SECRET);
  });

  it("does not treat a value on another page as found", async () => {
    const pdf = new Uint8Array([3]);
    const hash = sha256Hex(pdf);
    const result = await processDocument({
      pdf,
      declaredHash: hash,
      allow: new Set([hash]),
      readPages: async () => ["ONLYONPAGEONE", "nothing else"],
      extract: async () => [
        {
          page: 2,
          status: "ok",
          attempts: 1,
          model: "fake",
          promptVersion: "1",
          schemaVersion: "1",
          values: [{ field: "invoice_number", text: "ONLYONPAGEONE" }],
        },
      ],
    });
    const page = result.pages.find((item) => item.page === 2);
    expect(page?.ungrounded).toEqual(["invoice_number"]);
    expect(JSON.stringify(result)).not.toContain("ONLYONPAGEONE");
  });

  it("refuses a document over the page limit before the model", async () => {
    const pdf = new Uint8Array([1]);
    const hash = sha256Hex(pdf);
    let called = false;
    await expect(
      processDocument({
        pdf,
        declaredHash: hash,
        allow: new Set([hash]),
        readPages: async () => Array.from({ length: 31 }, () => "page text"),
        extract: () => {
          called = true;
          return Promise.resolve([]);
        },
      }),
    ).rejects.toMatchObject({ name: "PageLimitError", message: "The document has too many pages." });
    expect(called).toBe(false);
  });

  it("names a model page that is outside the document", async () => {
    const pdf = new Uint8Array([1]);
    const hash = sha256Hex(pdf);
    const secret = "only-on-the-real-page";
    await expect(
      processDocument({
        pdf,
        declaredHash: hash,
        allow: new Set([hash]),
        readPages: async () => [secret],
        extract: async () => [page(4)],
      }),
    ).rejects.toMatchObject({ name: "GroundingError", message: "A page could not be grounded." });
  });

  it("saves the clean fixture as one invoice, twenty elements, and a normalized line", async () => {
    const pages = pagesFromFixture("clean");
    const result = await read(pages);
    const saved = result.read;
    if (saved === undefined) throw new Error("missing read");
    expect(result.finish).toBe("ok");
    expect(result.pages.every((page) => page.ungrounded.length === 0)).toBe(true);
    expect(saved.invoiceNumber).toBe("SYN-1001");
    expect(saved.billingParty).toBe("Sample Line Logistics");
    expect(saved.billedParty).toBe("Harbor Home Goods");
    expect(saved.currency).toBe("USD");
    expect(saved.invoiceDate).toBe("2026-01-20");
    expect(saved.dueDate).toBe("2026-02-19");
    expect(saved.pageCount).toBe(1);
    expect(saved.elements).toHaveLength(ELEMENT_KEYS.length);
    expect(saved.elements.map((element) => element.key)).toEqual([...ELEMENT_KEYS]);
    const absent = saved.elements.find((element) => element.key === "earliest_return_date");
    expect(absent).toMatchObject({ state: "not_applicable", text: null, value: null, page: null, grounded: null });
    for (const element of saved.elements) {
      if (element.key === "earliest_return_date") continue;
      expect(element.state, element.key).toBe("present");
      expect(element.grounded, element.key).toBe(true);
      expect(element.page, element.key).toBe(1);
    }
    expect(saved.elements.find((element) => element.key === "container_number")?.value).toBe(parseContainer("SLLU0000011"));
    expect(saved.elements.find((element) => element.key === "total_due")?.value).toBe("450.00");
    expect(saved.lines).toEqual([
      {
        lineId: "ln_1",
        container: "SLLU0000011",
        charge: "demurrage",
        chargedFrom: "2026-01-10",
        chargedTo: "2026-01-12",
        days: 3,
        rate: "150.00",
        amount: "450.00",
        currency: "USD",
        grounded: true,
        containerPage: 1,
        fromPage: 1,
        toPage: 1,
        daysPage: 1,
        ratePage: 1,
        amountPage: 1,
      },
    ]);
    expect(saved.unresolved).toEqual([]);
    expect(JSON.stringify(result.pages)).not.toContain("SYN-1001");
  });

  it("keeps an ungrounded value, and does not call a missing or export-only element ungrounded", async () => {
    const invented = "NOT-ON-PAGE";
    const [clean] = pagesFromFixture("clean");
    if (clean === undefined) throw new Error("missing page");
    const pageText = textOf(clean);
    const elements = { ...clean.elements };
    delete elements.port_of_discharge;
    elements.bl_number = { text: invented, page: 1 };
    elements.earliest_return_date = { text: "Export Yard", page: 1 };
    const page = pageExtractionSchema.parse({ ...clean, elements });
    const result = await read([page], [pageText]);
    const saved = result.read;
    if (saved === undefined) throw new Error("missing read");
    expect(result.pages[0]?.ungrounded).toEqual(["bl_number"]);
    expect(saved.elements.find((element) => element.key === "bl_number")).toMatchObject({
      state: "present",
      text: invented,
      grounded: false,
      page: 1,
    });
    expect(saved.elements.find((element) => element.key === "port_of_discharge")).toMatchObject({
      state: "suggested_absent",
      text: null,
      page: null,
      grounded: null,
    });
    expect(saved.elements.find((element) => element.key === "earliest_return_date")).toMatchObject({
      state: "not_applicable",
      text: null,
      page: null,
      grounded: null,
    });
    expect(JSON.stringify(result.pages)).not.toContain(invented);
  });

  it("turns a stitch conflict into unreadable and still finishes ok", async () => {
    const [first] = pagesFromFixture("clean");
    if (first === undefined) throw new Error("missing page");
    const second = pageExtractionSchema.parse({
      page: 2,
      elements: { bl_number: { text: "SYN-BL-OTHER", page: 2 } },
      charge_lines: [],
    });
    const conflicted = pageExtractionSchema.parse({
      ...first,
      invoice_number: "SYN-OTHER",
    });
    const result = await read([first, second], [textOf(first), "SYN-BL-OTHER"]);
    const saved = result.read;
    if (saved === undefined) throw new Error("missing read");
    expect(result.finish).toBe("ok");
    expect(saved.invoiceNumber).toBe("SYN-1001");
    expect(saved.elements.find((element) => element.key === "bl_number")).toMatchObject({
      state: "unreadable",
      text: "SYN-BL-1001",
      page: 1,
      grounded: true,
    });
    const headers = await read([conflicted, pageExtractionSchema.parse({ ...second, invoice_number: "SYN-1001" })], [
      textOf(conflicted),
      "SYN-1001",
    ]);
    expect(headers.finish).toBe("ok");
    expect(headers.read?.invoiceNumber).toBe("SYN-OTHER");
  });

  it("normalizes a printed charge date", async () => {
    const [clean] = pagesFromFixture("clean");
    if (clean === undefined) throw new Error("missing page");
    const line = clean.charge_lines[0];
    if (line === undefined) throw new Error("missing line");
    const page = pageExtractionSchema.parse({
      ...clean,
      charge_lines: [{ ...line, charged_from: "March 2, 2026", charged_to: "March 4, 2026" }],
    });
    const result = await read([page]);
    expect(result.read?.lines[0]).toMatchObject({ chargedFrom: "2026-03-02", chargedTo: "2026-03-04", grounded: true });
  });

  it("fails a missing page and a line that will not parse, without the model text", async () => {
    const secret = "NOT-MONEY-SECRET";
    const [clean] = pagesFromFixture("clean");
    if (clean === undefined) throw new Error("missing page");
    const skipped = pageExtractionSchema.parse({
      page: 3,
      elements: { bl_number: { text: secret, page: 3 } },
      charge_lines: [],
    });
    const stitchError = await rejection(read([clean, skipped], [textOf(clean), "middle page", "tail page"]));
    expect(stitchError).toMatchObject({ name: "StitchFailure", message: "The pages could not be stitched." });
    expect(stitchError.stack ?? "").not.toContain(secret);

    const line = clean.charge_lines[0];
    if (line === undefined) throw new Error("missing line");
    const bad = pageExtractionSchema.parse({ ...clean, charge_lines: [{ ...line, amount: secret }] });
    const normalizeError = await rejection(read([bad]));
    expect(normalizeError).toBeInstanceOf(NormalizeError);
    expect(normalizeError).toMatchObject({ name: "NormalizeError", message: "The invoice could not be normalized." });
    expect(normalizeError.stack ?? "").not.toContain(secret);
    expect(stitchError).toBeInstanceOf(StitchFailure);
  });
});

function okPage(extraction: PageExtraction): GroundPage {
  return {
    page: extraction.page,
    status: "ok",
    attempts: 1,
    model: "fake",
    promptVersion: "1",
    schemaVersion: "1",
    values: extractionValues(extraction),
    extraction,
  };
}

function read(pages: readonly PageExtraction[], texts: readonly string[] = pages.map(textOf)): Promise<Awaited<ReturnType<typeof processDocument>>> {
  const pdf = new Uint8Array([4, 5, 6]);
  const hash = sha256Hex(pdf);
  return processDocument({
    pdf,
    declaredHash: hash,
    allow: new Set([hash]),
    readPages: async () => texts,
    extract: async () => pages.map(okPage),
  });
}

async function rejection(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("The call did not fail.");
}
