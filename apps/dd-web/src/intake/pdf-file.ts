import { pdfReadFailure, trailerEncrypts, type PdfRead } from "dd-core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Page count, or why the bytes are not a PDF this app can read. Node uses pdfjs's own worker. */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfRead> {
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
