import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { ELEMENT_KEYS, assignPresence, isConfirmedAbsent, loadReview, stitchedInvoiceSchema } from "dd-core";
import { describe, expect, it } from "vitest";
import { runReview } from "./review-command.js";

describe("dd review", () => {
  it("asks for each page and does not treat opening the PDF as an acknowledgement", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-review-"));
    const pdfPath = path.join(dir, "invoice.pdf");
    const pdf = Buffer.from("%PDF-1.4 synthetic");
    fs.writeFileSync(pdfPath, pdf);
    const invoice = stitchedInvoiceSchema.parse({
      elements: {},
      conflicts: [],
      header_conflicts: [],
      charge_lines: [],
      unresolved: [],
    });
    const elements = assignPresence(invoice, "import");
    for (const key of ELEMENT_KEYS) {
      const element = elements[key];
      if (element.state === "suggested_absent" && key !== "free_time_start") {
        elements[key] = { state: "present", text: "shown", page: 1 };
      }
    }
    const invoicePath = path.join(dir, "invoice.json");
    fs.writeFileSync(invoicePath, JSON.stringify({ pages: 1, movement: "import", invoice, elements }));
    const opened: string[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runReview({
      argv: [invoicePath, "--pdf", pdfPath, "--name", "Reviewer", "--now", "2026-11-09T20:20:00Z", "--out", dir],
      stdin: Readable.from(["\n", "confirm free_time_start\n", "approve-lines\n", "finish\n"]),
      stdout: { write: (chunk) => { stdout.push(chunk); } },
      stderr: { write: (chunk) => { stderr.push(chunk); } },
      opener: (file) => { opened.push(file); },
    });

    expect(code, stderr.join("")).toBe(0);
    expect(opened).toEqual([pdfPath]);
    expect(stdout.join("")).toContain("page 1 of 1\n");
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "review.json"), "utf8")) as {
      document_hash: string;
      acknowledged_pages: number[];
      elements: { free_time_start: unknown };
    };
    expect(saved.document_hash).toBe(createHash("sha256").update(pdf).digest("hex"));
    expect(saved.acknowledged_pages).toEqual([1]);
    expect(isConfirmedAbsent(saved.elements.free_time_start)).toBe(false);
    expect(isConfirmedAbsent(loadReview(saved, 1).elements.free_time_start)).toBe(true);
  });
});
