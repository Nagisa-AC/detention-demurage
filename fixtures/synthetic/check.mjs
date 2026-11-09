import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { invoices, serializeInvoice } from "./catalog.mjs";
import { extractPages } from "./extract-text.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

for (const invoice of invoices) {
  const committed = path.join(root, `${invoice.id}.json`);
  const actual = fs.readFileSync(committed, "utf8");
  const expected = serializeInvoice(invoice);
  if (actual !== expected) {
    fail(`${invoice.id}.json does not match the catalog`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

const { renderPdfs } = await import("./render.mjs");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-fixtures-"));

try {
  await renderPdfs(tempDir);
  for (const invoice of invoices) {
    const committedPages = await extractPages(path.join(root, `${invoice.id}.pdf`));
    const freshPages = await extractPages(path.join(tempDir, `${invoice.id}.pdf`));
    if (committedPages.length !== freshPages.length) {
      fail(`${invoice.id} page count ${committedPages.length} vs re-render ${freshPages.length}`);
      continue;
    }
    for (let index = 0; index < committedPages.length; index += 1) {
      if (committedPages[index] !== freshPages[index]) {
        fail(`${invoice.id} page ${index + 1} text differs from the re-render`);
      }
    }
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`fixtures:check ok (${invoices.length} invoices)`);
}
