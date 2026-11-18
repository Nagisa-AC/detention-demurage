"use client";

import { useState } from "react";
import { PdfPane } from "../review/pdf-pane";

export function FindingPdf({
  url,
  pageCount,
  page,
  queries,
  caption,
}: {
  url: string;
  pageCount: number;
  page: number;
  queries: readonly string[];
  caption: string;
}) {
  const [current, setCurrent] = useState(page);
  const [viewed, setViewed] = useState<ReadonlySet<number>>(() => new Set());
  return (
    <PdfPane
      url={url}
      pageCount={pageCount}
      page={current}
      query=""
      queries={queries}
      caption={caption}
      onPage={(next) => {
        if (next >= 1 && next <= pageCount) setCurrent(next);
      }}
      onViewed={(seen) => {
        setViewed((existing) => {
          if (existing.has(seen)) return existing;
          const next = new Set(existing);
          next.add(seen);
          return next;
        });
      }}
      viewedCount={viewed.size}
    />
  );
}
