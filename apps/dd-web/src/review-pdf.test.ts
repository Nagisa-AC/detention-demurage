import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./app/api/review/[customerId]/invoices/[invoiceId]/pdf/route";
import { findDocumentKey, isDocumentKey, setPdfSource, type PdfSource } from "./review-pdf";
import { setLog } from "./log";
import { encodeSession, setCookieReader } from "./session";
import type { ReviewSql } from "./review-data";

const SECRET = "test-session-secret";
const CUSTOMER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const INVOICE = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const KEY = `documents/${CUSTOMER}/abcd.pdf`;
const here = path.dirname(fileURLToPath(import.meta.url));

let logs: string[];

beforeEach(() => {
  logs = [];
  process.env.DD_SESSION_SECRET = SECRET;
  setLog((line) => {
    logs.push(line);
  });
  setCookieReader(async () => undefined);
  setPdfSource(null);
});

afterEach(() => {
  delete process.env.DD_SESSION_SECRET;
  setPdfSource(null);
});

describe("invoice pdf route", () => {
  it("rejects a request with no session before it looks up an invoice", async () => {
    const source = recordingSource(KEY);
    setPdfSource(source);
    const response = await GET(new Request("http://localhost/pdf"), { params: Promise.resolve({ customerId: CUSTOMER, invoiceId: INVOICE }) });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(source.lookups).toEqual([]);
    expect(source.opened).toEqual([]);
    expect(logs).toEqual(["path /api/review/pdf session no"]);
  });

  it("rejects a request for another customer's invoice and does not open the object", async () => {
    setCookieReader(async () => cookie());
    const source = recordingSource(KEY);
    setPdfSource(source);
    const response = await GET(new Request("http://localhost/pdf"), {
      params: Promise.resolve({ customerId: OTHER, invoiceId: INVOICE }),
    });
    expect(response.status).toBe(404);
    expect(source.lookups).toEqual([{ customerId: OTHER, invoiceId: INVOICE }]);
    expect(source.opened).toEqual([]);
    expect(logs).toEqual(["path /api/review/pdf session yes"]);
  });

  it("streams the stored object for the invoice's own customer and does not sign a URL", async () => {
    setCookieReader(async () => cookie());
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const source = recordingSource(KEY, bytes);
    setPdfSource(source);
    const response = await GET(new Request("http://localhost/pdf"), {
      params: Promise.resolve({ customerId: CUSTOMER, invoiceId: INVOICE }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(source.opened).toEqual([KEY]);
    const body = JSON.stringify({ status: response.status, type: response.headers.get("content-type") });
    expect(body).not.toContain("X-Amz-");
    expect(body).not.toContain("https://");
  });
});

describe("document key", () => {
  it("returns a key only when the invoice belongs to that customer", async () => {
    const sql = fakeSql();
    expect(await findDocumentKey(sql, CUSTOMER, INVOICE)).toBe(KEY);
    expect(await findDocumentKey(sql, OTHER, INVOICE)).toBeNull();
    expect(sql.calls[0]?.values).toEqual([INVOICE, CUSTOMER]);
    expect(sql.calls[1]?.values).toEqual([INVOICE, OTHER]);
    expect(isDocumentKey(CUSTOMER, KEY)).toBe(true);
    expect(isDocumentKey(OTHER, KEY)).toBe(false);
    expect(isDocumentKey(CUSTOMER, `incoming/${CUSTOMER}/file.pdf`)).toBe(false);
  });

  it("reads the object with GetObject and does not presign", () => {
    const source = fs.readFileSync(path.join(here, "review-pdf.ts"), "utf8");
    expect(source).toContain("GetObjectCommand");
    expect(source).not.toContain("getSignedUrl");
    expect(source).not.toContain("presign");
    expect(source).not.toContain("s3-request-presigner");
  });
});

function cookie(): string {
  return encodeSession({ name: "Ibrahim", exp: Math.floor(Date.now() / 1000) + 3600, mfa: true }, SECRET);
}

function recordingSource(storedKey: string, bytes = new Uint8Array([1])): PdfSource & {
  lookups: { customerId: string; invoiceId: string }[];
  opened: string[];
} {
  const lookups: { customerId: string; invoiceId: string }[] = [];
  const opened: string[] = [];
  return {
    lookups,
    opened,
    async findKey(customerId, invoiceId) {
      lookups.push({ customerId, invoiceId });
      if (customerId !== CUSTOMER || invoiceId !== INVOICE) return null;
      return storedKey;
    },
    async open(key) {
      opened.push(key);
      return new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    },
  };
}

function fakeSql(): ReviewSql & { calls: { text: string; values: readonly unknown[] }[] } {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  return {
    calls,
    async query<T extends Record<string, unknown>>(text: string, values?: readonly unknown[]) {
      calls.push({ text, values: values ?? [] });
      const customerId = values?.[1];
      if (customerId !== CUSTOMER) return { rows: [] as T[] };
      return { rows: [{ storage_key: KEY }] as unknown as T[] };
    },
  };
}
