"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { matchingIndexes } from "../../../review-format";

const documents = new Map<string, Promise<PDFDocumentProxy>>();

export function PdfPane({
  url,
  pageCount,
  page,
  query,
  onPage,
  onViewed,
  viewedCount,
}: {
  url: string;
  pageCount: number;
  page: number;
  query: string;
  onPage: (page: number) => void;
  onViewed: (page: number) => void;
  viewedCount: number;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const onViewedRef = useRef(onViewed);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const every = viewedCount === pageCount;
  onViewedRef.current = onViewed;

  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;
    const measure = (): void => {
      const style = getComputedStyle(frame);
      const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const next = Math.max(0, Math.floor(frame.clientWidth - pad));
      setWidth((current) => (Math.abs(current - next) < 1 ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    if (canvas === null || layer === null || width < 1) return;
    setFailed(false);
    const drawing = drawPage(canvas, layer, url, page, query, width, setZoom);
    drawing.done
      .then(() => {
        if (!drawing.cancelled()) onViewedRef.current(page);
      })
      .catch(() => {
        if (!drawing.cancelled()) setFailed(true);
      });
    return () => drawing.cancel();
  }, [url, page, query, width]);

  return (
    <section aria-label="Invoice page" className="pdf-pane">
      <div className="pdf-tools">
        <button type="button" className="btn" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          ‹ Prev page
        </button>
        <span>
          Page {page} of {pageCount} · {every ? "every page viewed" : `${viewedCount} of ${pageCount} viewed`}
        </span>
        <button type="button" className="btn" onClick={() => onPage(page + 1)} disabled={page >= pageCount}>
          Next page ›
        </button>
        <span className="zoom">{zoom === null ? "Zoom" : `Zoom ${zoom}%`}</span>
      </div>
      <div className="pdf-frame" ref={frameRef}>
        {failed ? <p className="pdf-error">The page could not be loaded.</p> : null}
        <div className="pdf-stage">
          <canvas ref={canvasRef} />
          <div ref={layerRef} className="textLayer" />
        </div>
      </div>
      <p className="pdf-note">Blue outline: where the selected element was read. Page image from the uploaded PDF.</p>
    </section>
  );
}

function loadDocument(url: string): Promise<PDFDocumentProxy> {
  const existing = documents.get(url);
  if (existing !== undefined) return existing;
  const created = (async () => {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/api/pdf-worker";
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error("pdf");
    const data = new Uint8Array(await response.arrayBuffer());
    return pdfjs.getDocument({ data }).promise;
  })();
  documents.set(url, created);
  created.catch(() => {
    documents.delete(url);
  });
  return created;
}

function drawPage(
  canvas: HTMLCanvasElement,
  layer: HTMLDivElement,
  url: string,
  page: number,
  query: string,
  width: number,
  onZoom: (zoom: number) => void,
): { cancel: () => void; cancelled: () => boolean; done: Promise<void> } {
  let stopped = false;
  let task: { cancel: () => void } | null = null;
  const done = (async () => {
    const pdfjs = await import("pdfjs-dist");
    const doc = await loadDocument(url);
    if (stopped) return;
    const pdfPage = await doc.getPage(page);
    if (stopped) return;
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = width / base.width;
    const viewport = pdfPage.getViewport({ scale });
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * pixelRatio);
    canvas.height = Math.floor(viewport.height * pixelRatio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const stage = layer.parentElement;
    if (stage !== null) {
      stage.style.width = `${viewport.width}px`;
      stage.style.height = `${viewport.height}px`;
    }
    const render = pdfPage.render({
      canvas,
      viewport,
      transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
    });
    task = render;
    await render.promise;
    if (stopped) return;
    onZoom(Math.round(scale * 100));
    layer.replaceChildren();
    layer.style.width = `${viewport.width}px`;
    layer.style.height = `${viewport.height}px`;
    const text = await pdfPage.getTextContent();
    if (stopped) return;
    const textLayer = new pdfjs.TextLayer({ textContentSource: text, container: layer, viewport });
    await textLayer.render();
    if (stopped) return;
    const hits = new Set(matchingIndexes(textLayer.textDivs.map((div) => div.textContent ?? ""), query));
    textLayer.textDivs.forEach((div, index) => {
      if (hits.has(index)) div.classList.add("hit");
    });
  })();
  return {
    cancel: () => {
      stopped = true;
      task?.cancel();
    },
    cancelled: () => stopped,
    done,
  };
}
