import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

/** One string per page, items joined with no extra spaces, matching the fixture text layer. */
export async function readPdfPages(pdf: Uint8Array): Promise<string[]> {
  // The bundle ships pdf.worker.mjs beside main.mjs. Source tests keep pdfjs's own worker.
  const beside = new URL("./pdf.worker.mjs", import.meta.url);
  if (existsSync(fileURLToPath(beside))) GlobalWorkerOptions.workerSrc = beside.href;
  // pdfjs detaches the ArrayBuffer it is given. A copy leaves the caller's bytes for pdf-lib.
  // pdfjs detaches the ArrayBuffer it is given. A copy leaves the caller's bytes for pdf-lib.
  const task = getDocument({ data: pdf.slice(), verbosity: 0 });
  let doc: Awaited<typeof task.promise> | undefined;
  try {
    doc = await task.promise;
    const pages: string[] = [];
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.map((item) => (typeof item.str === "string" ? item.str : "")).join("");
      pages.push(text);
      page.cleanup();
    }
    return pages;
  } finally {
    // Destroy even when the read throws, so the next attempt does not see a pending worker.
    try {
      await doc?.cleanup();
    } finally {
      await task.destroy();
    }
  }
}
