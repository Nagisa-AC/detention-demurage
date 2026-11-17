import { PDFDocument } from "pdf-lib";
import { MAX_PAGES, PageLimitError } from "./errors.js";

/** One PDF per page, in order, so each model call sees a single page. */
export async function splitPdf(bytes: Uint8Array): Promise<Uint8Array[]> {
  const source = await PDFDocument.load(bytes);
  const count = source.getPageCount();
  if (count > MAX_PAGES) throw new PageLimitError();
  const pages: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(source, [index]);
    if (page === undefined) continue;
    doc.addPage(page);
    pages.push(await doc.save());
  }
  return pages;
}
