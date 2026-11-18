import { createHash } from "node:crypto";
import { PDFDocument, PDFHexString, StandardFonts, rgb } from "pdf-lib";
import { renderExhibits } from "./exhibits";
import type { ReportBuild } from "./model";
import { renderFront, renderScope } from "./pdf";

const mute = rgb(102 / 255, 101 / 255, 94 / 255);

/** Body from react-pdf, exhibit pages from the stored invoice PDFs, dates and id from the rules run. */
export async function renderReport(model: ReportBuild): Promise<Uint8Array> {
  const front = await renderFront(model);
  const scope = await renderScope(model);
  const exhibits = await renderExhibits(model);
  const pdf = await PDFDocument.create();
  await append(pdf, front);
  if (exhibits !== null) await append(pdf, exhibits);
  await append(pdf, scope);
  await stampFooters(pdf, model);
  pdf.setTitle(`Demurrage and Detention Audit — ${model.customerName}`);
  pdf.setAuthor(model.firmName);
  pdf.setCreator(model.firmName);
  pdf.setProducer(model.firmName);
  pdf.setCreationDate(model.finishedAt);
  pdf.setModificationDate(model.finishedAt);
  const id = model.runId.replaceAll("-", "").toLowerCase();
  pdf.context.trailerInfo.ID = pdf.context.obj([PDFHexString.of(id), PDFHexString.of(id)]);
  return pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function append(pdf: PDFDocument, bytes: Uint8Array): Promise<void> {
  const part = await PDFDocument.load(bytes);
  const pages = await pdf.copyPages(part, part.getPageIndices());
  for (const page of pages) pdf.addPage(page);
}

async function stampFooters(pdf: PDFDocument, model: ReportBuild): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const pages = pdf.getPages();
  const label = `${model.firmName} · Confidential · prepared for ${model.customerName}`;
  pages.forEach((page, index) => {
    page.drawText(label, { x: 61, y: 32, size: 8, font, color: mute });
    const num = `${index + 1} / ${pages.length}`;
    const width = mono.widthOfTextAtSize(num, 8);
    page.drawText(num, { x: page.getWidth() - 61 - width, y: 32, size: 8, font: mono, color: mute });
  });
}
