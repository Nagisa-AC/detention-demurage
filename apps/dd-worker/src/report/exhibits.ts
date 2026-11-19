import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb, type PDFEmbeddedPage, type PDFFont } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ReportBuild } from "./model.js";

const ink = rgb(26 / 255, 26 / 255, 23 / 255);
const mute = rgb(102 / 255, 101 / 255, 94 / 255);
const line = rgb(225 / 255, 223 / 255, 215 / 255);
const panel = rgb(247 / 255, 246 / 255, 242 / 255);
const blue = rgb(42 / 255, 76 / 255, 142 / 255);
const blueFill = rgb(42 / 255, 76 / 255, 142 / 255);

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 61;
const MARGIN_TOP = 58;
const MARGIN_BOTTOM = 56;

type Hit = { x: number; y: number; w: number; h: number };

export type Clip = {
  page: number;
  hits: number;
  left: number;
  bottom: number;
  right: number;
  top: number;
  boxes: Hit[];
};

type TextItem = { str: string; transform: number[]; width: number; height: number };

/** Text positions on the stored page, then a clip around the cited lines. */
export async function clipInvoicePage(pdf: Uint8Array, pageNumber: number, needles: readonly string[]): Promise<Clip | null> {
  const located = await locate(pdf, pageNumber, needles);
  if (located === null) return null;
  return located;
}

/** One-page PDF of the clip, with the blue outline, for tests. */
export async function renderClip(pdf: Uint8Array, pageNumber: number, needles: readonly string[]): Promise<Uint8Array | null> {
  const clip = await clipInvoicePage(pdf, pageNumber, needles);
  if (clip === null) return null;
  const out = await PDFDocument.create();
  const embedded = await embedClip(out, pdf, clip);
  if (embedded === null) return null;
  const page = out.addPage([embedded.width + 16, embedded.height + 16]);
  page.drawPage(embedded.page, { x: 8, y: 8, width: embedded.width, height: embedded.height });
  return out.save({ useObjectStreams: false, updateFieldAppearances: false });
}

export async function renderExhibits(model: Pick<ReportBuild, "exhibits" | "exhibitIntro" | "firmName" | "customerName" | "reportNumber">): Promise<Uint8Array | null> {
  if (model.exhibits.length === 0) return null;
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const semi = bold;
  const mono = await pdf.embedFont(StandardFonts.Courier);
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let cursor = PAGE_HEIGHT - MARGIN_TOP;
  const drawHead = () => {
    const firm = model.firmName.toUpperCase();
    page.drawText(firm, { x: MARGIN_X, y: cursor, size: 9, font: bold, color: ink });
    const meta = `${model.customerName} · ${model.reportNumber}`;
    const metaWidth = mono.widthOfTextAtSize(meta, 7.5);
    page.drawText(meta, { x: PAGE_WIDTH - MARGIN_X - metaWidth, y: cursor, size: 7.5, font: mono, color: mute });
    cursor -= 8;
    page.drawLine({ start: { x: MARGIN_X, y: cursor }, end: { x: PAGE_WIDTH - MARGIN_X, y: cursor }, thickness: 0.75, color: line });
    cursor -= 16;
  };
  drawHead();
  page.drawText("Exhibits", { x: MARGIN_X, y: cursor, size: 11.5, font: semi, color: ink });
  cursor -= 14;
  const introLines = wrap(model.exhibitIntro, regular, 8, PAGE_WIDTH - MARGIN_X * 2);
  for (const intro of introLines) {
    page.drawText(intro, { x: MARGIN_X, y: cursor, size: 8, font: regular, color: mute });
    cursor -= 11;
  }
  cursor -= 6;

  let first = true;
  const contentWidth = PAGE_WIDTH - MARGIN_X * 2;
  for (const exhibit of model.exhibits) {
    const clips: { page: PDFEmbeddedPage; width: number; height: number }[] = [];
    for (const source of exhibit.clips) {
      const bounds = await clipInvoicePage(source.pdf, source.page, source.needles);
      if (bounds === null) continue;
      const embedded = await embedClip(pdf, source.pdf, bounds);
      if (embedded === null) continue;
      clips.push(embedded);
    }
    const whoWidth = mono.widthOfTextAtSize(exhibit.who, 8);
    const captionWidth = Math.max(120, contentWidth - 96 - whoWidth);
    const captionLines = wrap(exhibit.caption, regular, 8, captionWidth);
    const headerH = Math.max(26, 8 + captionLines.length * 11 + 8);
    const roomFor = (maxImage: number): { sizes: { width: number; height: number }[]; block: number } => {
      const sizes = clips.map((clip) => fitted(clip.width, clip.height, maxImage));
      const images = sizes.reduce((sum, size) => sum + size.height + 8, 0);
      return { sizes, block: headerH + 12 + images + 8 };
    };
    let packed = roomFor(220);
    if (!first && cursor - packed.block < MARGIN_BOTTOM) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      cursor = PAGE_HEIGHT - MARGIN_TOP;
      drawHead();
    }
    first = false;
    const available = cursor - MARGIN_BOTTOM;
    if (packed.block > available && clips.length > 0) {
      const overhead = headerH + 12 + clips.length * 8 + 8;
      const natural = clips.reduce((sum, clip) => sum + fitted(clip.width, clip.height, 220).height, 0);
      const scale = Math.max(0.35, (available - overhead) / Math.max(natural, 1));
      packed = roomFor(220 * scale);
    }
    const top = cursor;
    const bottom = top - packed.block;
    page.drawRectangle({
      x: MARGIN_X,
      y: bottom,
      width: contentWidth,
      height: packed.block,
      borderColor: line,
      borderWidth: 0.75,
    });
    page.drawRectangle({
      x: MARGIN_X,
      y: top - headerH,
      width: contentWidth,
      height: headerH,
      color: panel,
      borderColor: line,
      borderWidth: 0.75,
    });
    const headerTextY = top - 16;
    page.drawText(`EXHIBIT ${exhibit.letter}`, { x: MARGIN_X + 8, y: headerTextY, size: 7, font: mono, color: mute });
    page.drawText(exhibit.who, { x: MARGIN_X + 78, y: headerTextY, size: 8, font: mono, color: ink });
    let captionY = headerTextY;
    for (const caption of captionLines) {
      page.drawText(caption, { x: MARGIN_X + 86 + whoWidth, y: captionY, size: 8, font: regular, color: mute });
      captionY -= 11;
    }
    let imageY = top - headerH - 10;
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      const fit = packed.sizes[index];
      if (clip === undefined || fit === undefined) continue;
      imageY -= fit.height;
      page.drawPage(clip.page, { x: MARGIN_X + 10, y: imageY, width: fit.width, height: fit.height });
      imageY -= 8;
    }
    cursor = bottom - 12;
  }
  if (pdf.getPageCount() === 0) return null;
  return pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
}

function fitted(width: number, height: number, maxHeight: number): { width: number; height: number } {
  const maxWidth = (PAGE_WIDTH - MARGIN_X * 2) * 0.74;
  const scale = Math.min(maxWidth / Math.max(width, 1), maxHeight / Math.max(height, 1));
  return { width: width * scale, height: height * scale };
}

async function embedClip(pdf: PDFDocument, bytes: Uint8Array, clip: Clip): Promise<{ page: Awaited<ReturnType<PDFDocument["embedPage"]>>; width: number; height: number } | null> {
  const source = await PDFDocument.load(bytes);
  const page = source.getPage(clip.page - 1);
  if (page === undefined) return null;
  for (const box of clip.boxes) {
    page.drawRectangle({
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      color: blueFill,
      opacity: 0.14,
      borderColor: blue,
      borderWidth: 1.25,
    });
  }
  const embedded = await pdf.embedPage(page, { left: clip.left, bottom: clip.bottom, right: clip.right, top: clip.top });
  return { page: embedded, width: clip.right - clip.left, height: clip.top - clip.bottom };
}

async function locate(pdf: Uint8Array, pageNumber: number, needles: readonly string[]): Promise<Clip | null> {
  const source = await PDFDocument.load(pdf);
  const page = source.getPage(pageNumber - 1);
  if (page === undefined) return null;
  const width = page.getWidth();
  const height = page.getHeight();
  const items = await textItems(pdf, pageNumber);
  const useful = needles.map((needle) => needle.trim()).filter((needle) => needle.length >= 4);
  const boxes = useful.length === 0 ? [] : boxesFor(items, useful);
  if (boxes.length === 0) {
    return { page: pageNumber, hits: 0, left: 36, bottom: height * 0.42, right: width - 36, top: height - 28, boxes: [] };
  }
  let bottom = height;
  let top = 0;
  for (const box of boxes) {
    bottom = Math.min(bottom, box.y);
    top = Math.max(top, box.y + box.h);
  }
  bottom -= 8;
  top += 8;
  if (top - bottom < 48) {
    const mid = (top + bottom) / 2;
    top = mid + 24;
    bottom = mid - 24;
  }
  let left = width;
  let right = 0;
  for (const item of items) {
    if (item.width <= 0) continue;
    const x = item.transform[4] ?? 0;
    const baseline = item.transform[5] ?? 0;
    const h = Math.max(item.height, Math.abs(item.transform[3] ?? 0), 8);
    const itemBottom = baseline - h * 0.2;
    const itemTop = itemBottom + h;
    if (itemTop < bottom || itemBottom > top) continue;
    left = Math.min(left, x);
    right = Math.max(right, x + item.width);
  }
  if (right <= left) {
    for (const box of boxes) {
      left = Math.min(left, box.x);
      right = Math.max(right, box.x + box.w);
    }
  }
  left -= 12;
  right += 12;
  left = clamp(left, 0, width - 1);
  right = clamp(right, left + 1, width);
  bottom = clamp(bottom, 0, height - 1);
  top = clamp(top, bottom + 1, height);
  return { page: pageNumber, hits: boxes.length, left, bottom, right, top, boxes };
}

function boxesFor(items: readonly TextItem[], needles: readonly string[]): Hit[] {
  const lines: { baseline: number; items: TextItem[] }[] = [];
  const ordered = [...items].filter((item) => item.str !== "").sort((left, right) => (right.transform[5] ?? 0) - (left.transform[5] ?? 0) || (left.transform[4] ?? 0) - (right.transform[4] ?? 0));
  for (const item of ordered) {
    const baseline = item.transform[5] ?? 0;
    const current = lines[lines.length - 1];
    if (current !== undefined && Math.abs(current.baseline - baseline) < 2) current.items.push(item);
    else lines.push({ baseline, items: [item] });
  }
  const boxes: Hit[] = [];
  for (const group of lines) {
    const text = group.items.map((item) => item.str).join("");
    if (!needles.some((needle) => text.includes(needle))) continue;
    for (const item of group.items) {
      if (item.width <= 0) continue;
      const x = item.transform[4] ?? 0;
      const baseline = item.transform[5] ?? 0;
      const h = Math.max(item.height, Math.abs(item.transform[3] ?? 0), 8);
      boxes.push({ x, y: baseline - h * 0.2, w: item.width, h });
    }
  }
  return boxes;
}

function useBundledWorker(): void {
  const beside = new URL("./pdf.worker.mjs", import.meta.url);
  if (existsSync(fileURLToPath(beside))) GlobalWorkerOptions.workerSrc = beside.href;
}

async function textItems(pdf: Uint8Array, pageNumber: number): Promise<TextItem[]> {
  useBundledWorker();
  const task = getDocument({ data: pdf.slice(), verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const item of content.items) {
      if (typeof item !== "object" || item === null || !("str" in item)) continue;
      const record = item as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown };
      if (typeof record.str !== "string" || !Array.isArray(record.transform)) continue;
      items.push({
        str: record.str,
        transform: record.transform.filter((value): value is number => typeof value === "number"),
        width: typeof record.width === "number" ? record.width : 0,
        height: typeof record.height === "number" ? record.height : 0,
      });
    }
    return items;
  } finally {
    await task.destroy();
  }
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter((word) => word !== "");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current === "" ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(next, size) > width && current !== "") {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current !== "") lines.push(current);
  return lines;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
