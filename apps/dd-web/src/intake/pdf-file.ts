import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pdfReadFailure, trailerEncrypts, type PdfRead } from "dd-core";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Page count, or why the bytes are not a PDF this app can read. */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfRead> {
  const beside = new URL("./pdf.worker.mjs", import.meta.url);
  if (existsSync(fileURLToPath(beside))) GlobalWorkerOptions.workerSrc = beside.href;
  if (trailerEncrypts(bytes)) return { kind: "encrypted" };
  const task = getDocument({ data: bytes.slice(), verbosity: 0 });
  let doc: Awaited<typeof task.promise> | undefined;
  try {
    doc = await task.promise;
    const pages = doc.numPages;
    return pages > 0 ? { kind: "ok", pages } : { kind: "malformed" };
  } catch (error) {
    return { kind: pdfReadFailure(error) };
  } finally {
    try {
      await doc?.cleanup();
    } finally {
      await task.destroy();
    }
  }
}
