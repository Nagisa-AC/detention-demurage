import { PDFDocument } from "pdf-lib";

/** One PDF per page, in order, so each model call sees a single page. */
export async function splitPdf(bytes: Uint8Array): Promise<Uint8Array[]> {
  const source = await PDFDocument.load(bytes);
  const pages: Uint8Array[] = [];
  for (let index = 0; index < source.getPageCount(); index += 1) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(source, [index]);
    if (page === undefined) continue;
    doc.addPage(page);
    pages.push(await doc.save());
  }
  return pages;
}
