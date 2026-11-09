import fs from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function extractPages(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const task = getDocument({ data });
  const doc = await task.promise;
  const pages = [];
  try {
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => (item && typeof item.str === "string" ? item.str : ""))
        .join("");
      pages.push(text);
      page.cleanup();
    }
  } finally {
    await doc.cleanup();
    await task.destroy();
  }
  return pages;
}

export function foldText(value) {
  return value.replace(/\s+/g, "");
}
