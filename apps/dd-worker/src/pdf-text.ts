import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** One string per page, items joined with no extra spaces, matching the fixture text layer. */
export async function readPdfPages(pdf: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: pdf, verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  try {
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.map((item) => (typeof item.str === "string" ? item.str : "")).join("");
      pages.push(text);
      page.cleanup();
    }
  } finally {
    await doc.cleanup();
    await task.destroy();
  }
  return pages;
}
