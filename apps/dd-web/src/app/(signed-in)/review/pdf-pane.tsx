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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const onViewedRef = useRef(onViewed);
  const [failed, setFailed] = useState(false);
  const every = viewedCount === pageCount;
  onViewedRef.current = onViewed;

  useEffect(() => {
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    if (canvas === null || layer === null) return;
    let cancelled = false;
    setFailed(false);
    loadDocument(url)
      .then(async (doc) => {
        if (cancelled) return;
        await drawPage(doc, canvas, layer, page, query);
        if (!cancelled) onViewedRef.current(page);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url, page, query]);

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
        <span className="zoom">Zoom 100%</span>
      </div>
      <div className="pdf-frame">
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

async function drawPage(
  doc: PDFDocumentProxy,
  canvas: HTMLCanvasElement,
  layer: HTMLDivElement,
  page: number,
  query: string,
): Promise<void> {
  const pdfjs = await import("pdfjs-dist");
  const pdfPage = await doc.getPage(page);
  const viewport = pdfPage.getViewport({ scale: 1 });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await pdfPage.render({ canvas, viewport }).promise;
  layer.replaceChildren();
  layer.style.width = `${viewport.width}px`;
  layer.style.height = `${viewport.height}px`;
  const text = await pdfPage.getTextContent();
  const textLayer = new pdfjs.TextLayer({ textContentSource: text, container: layer, viewport });
  await textLayer.render();
  const hits = new Set(matchingIndexes(textLayer.textDivs.map((div) => div.textContent ?? ""), query));
  textLayer.textDivs.forEach((div, index) => {
    if (hits.has(index)) div.classList.add("hit");
  });
}
