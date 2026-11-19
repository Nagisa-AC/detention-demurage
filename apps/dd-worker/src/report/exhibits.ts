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
  pageWidth: number;
  boxes: Hit[];
};

const CLIP_MARGIN = 6;

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

  const contentWidth = PAGE_WIDTH - MARGIN_X * 2;
  const imageWidth = contentWidth - 20;
  for (const exhibit of model.exhibits) {
    const clips: { page: PDFEmbeddedPage; width: number; height: number }[] = [];
    for (const source of exhibit.clips) {
      const bounds = await clipInvoicePage(source.pdf, source.page, source.needles);
      if (bounds === null) continue;
      const embedded = await embedClip(pdf, source.pdf, bounds);
      if (embedded === null) continue;
      const scale = imageWidth / embedded.pageWidth;
      clips.push({ page: embedded.page, width: embedded.width * scale, height: embedded.height * scale });
    }
    const whoWidth = mono.widthOfTextAtSize(exhibit.who, 8);
    const captionWidth = Math.max(120, contentWidth - 96 - whoWidth);
    const captionLines = wrap(exhibit.caption, regular, 8, captionWidth);
    const headerH = Math.max(26, 8 + captionLines.length * 11 + 8);
    const freshPage = () => {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      cursor = PAGE_HEIGHT - MARGIN_TOP;
      drawHead();
    };
    const paintHeader = () => {
      page.drawRectangle({
        x: MARGIN_X,
        y: cursor - headerH,
        width: contentWidth,
        height: headerH,
        color: panel,
        borderColor: line,
        borderWidth: 0.75,
      });
      const headerTextY = cursor - 16;
      page.drawText(`EXHIBIT ${exhibit.letter}`, { x: MARGIN_X + 8, y: headerTextY, size: 7, font: mono, color: mute });
      page.drawText(exhibit.who, { x: MARGIN_X + 78, y: headerTextY, size: 8, font: mono, color: ink });
      let captionY = headerTextY;
      for (const caption of captionLines) {
        page.drawText(caption, { x: MARGIN_X + 86 + whoWidth, y: captionY, size: 8, font: regular, color: mute });
        captionY -= 11;
      }
      cursor -= headerH;
    };
    const closeBox = (top: number) => {
      page.drawRectangle({
        x: MARGIN_X,
        y: cursor,
        width: contentWidth,
        height: top - cursor,
        borderColor: line,
        borderWidth: 0.75,
      });
    };
    if (cursor - (headerH + 20 + (clips[0]?.height ?? 0)) < MARGIN_BOTTOM && cursor < PAGE_HEIGHT - MARGIN_TOP - 1) freshPage();
    let top = cursor;
    paintHeader();
    if (clips.length === 0) {
      cursor -= 8;
      closeBox(top);
      cursor -= 12;
      continue;
    }
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      if (clip === undefined) continue;
      if (cursor - clip.height - 18 < MARGIN_BOTTOM && index > 0) {
        cursor -= 8;
        closeBox(top);
        cursor -= 12;
        freshPage();
        top = cursor;
        paintHeader();
      }
      cursor -= 10;
      cursor -= clip.height;
      page.drawPage(clip.page, { x: MARGIN_X + 10, y: cursor, width: clip.width, height: clip.height });
    }
    cursor -= 8;
    closeBox(top);
    cursor -= 12;
  }
  if (pdf.getPageCount() === 0) return null;
  return pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
}

async function embedClip(pdf: PDFDocument, bytes: Uint8Array, clip: Clip): Promise<{ page: Awaited<ReturnType<PDFDocument["embedPage"]>>; width: number; height: number; pageWidth: number } | null> {
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
  return { page: embedded, width: clip.right - clip.left, height: clip.top - clip.bottom, pageWidth: clip.pageWidth };
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
  if (boxes.length === 0) return null;
  let bottom = height;
  let top = 0;
  for (const box of boxes) {
    bottom = Math.min(bottom, box.y);
    top = Math.max(top, box.y + box.h);
  }
  bottom -= CLIP_MARGIN;
  top += CLIP_MARGIN;
  bottom = clamp(bottom, 0, height - 1);
  top = clamp(top, bottom + 1, height);
  return { page: pageNumber, hits: boxes.length, left: 0, bottom, right: width, top, pageWidth: width, boxes };
}

function boxesFor(items: readonly TextItem[], needles: readonly string[]): Hit[] {
  const lines: TextItem[][] = [];
  const ordered = [...items].filter((item) => item.str.trim() !== "").sort((left, right) => (right.transform[5] ?? 0) - (left.transform[5] ?? 0) || (left.transform[4] ?? 0) - (right.transform[4] ?? 0));
  for (const item of ordered) {
    const baseline = item.transform[5] ?? 0;
    const current = lines[lines.length - 1];
    const currentBaseline = current?.[0]?.transform[5] ?? 0;
    if (current !== undefined && Math.abs(currentBaseline - baseline) < 2) current.push(item);
    else lines.push([item]);
  }
  const boxes: Hit[] = [];
  const seen = new Set<TextItem>();
  for (const line of lines) {
    const text = line.map((item) => item.str).join("");
    for (const needle of needles) {
      let from = 0;
      while (from < text.length) {
        const at = text.indexOf(needle, from);
        if (at < 0) break;
        for (const cover of itemsCovering(line, at, at + needle.length)) {
          if (seen.has(cover.item) || cover.item.width <= 0) continue;
          seen.add(cover.item);
          const end = cover.start === 0 ? cover.item.str.length : cover.end;
          boxes.push(hitOf(cover.item, cover.start, end));
        }
        from = at + Math.max(needle.length, 1);
      }
    }
  }
  return boxes;
}

function itemsCovering(line: readonly TextItem[], start: number, end: number): { item: TextItem; start: number; end: number }[] {
  const covered: { item: TextItem; start: number; end: number }[] = [];
  let cursor = 0;
  for (const item of line) {
    const next = cursor + item.str.length;
    if (next > start && cursor < end) {
      covered.push({
        item,
        start: Math.max(0, start - cursor),
        end: Math.min(item.str.length, end - cursor),
      });
    }
    cursor = next;
  }
  return covered;
}

function hitOf(item: TextItem, start: number, end: number): Hit {
  const length = Math.max(item.str.length, 1);
  const unit = item.width / length;
  const baseline = item.transform[5] ?? 0;
  const h = Math.max(item.height, Math.abs(item.transform[3] ?? 0), 8);
  return {
    x: (item.transform[4] ?? 0) + unit * start - 1.5,
    y: baseline - h * 0.2 - 1,
    w: Math.max(unit * (end - start), 4) + 3,
    h: h + 2,
  };
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
