import fs from "node:fs";
import path from "node:path";
import {
  assignPresence,
  pageExtractionSchema,
  stitch,
  type InvoiceExtraction,
  type PageExtraction,
} from "dd-core";
import { CliError, fail } from "./cli-error.js";
import {
  blobPath,
  documentDir,
  flagsOf,
  loadConfig,
  readIngest,
  requireRun,
  sha256,
  writeJson,
  type CommandIo,
} from "./layout.js";

export async function runExtract(io: CommandIo): Promise<number> {
  try {
    const { root, run, runDir, customer } = requireRun(io.argv, io.env);
    loadConfig(root, customer);
    const provider = flagsOf(io.argv).flags.get("--provider");
    if (provider !== undefined && provider !== "anthropic") throw new CliError("provider must be anthropic.");
    if (!fs.existsSync(path.join(runDir, "ingest.json"))) throw new CliError(`run ${run} was not ingested.`);
    const invoices = readIngest(runDir).filter((document) => document.type === "invoice");
    if (invoices.length === 0) throw new CliError(`run ${run} has no invoice.`);
    for (const document of invoices) {
      await extractDocument(root, run, document.sha256, document.movement, provider === "anthropic");
    }
    return 0;
  } catch (error) {
    return fail(io, error);
  }
}

async function extractDocument(root: string, run: string, hash: string, movement: "import" | "export", live: boolean): Promise<void> {
  const blob = blobPath(root, hash);
  if (!fs.existsSync(blob)) throw new CliError(`run ${run} document ${hash} was not ingested.`);
  const bytes = fs.readFileSync(blob);
  if (sha256(bytes) !== hash) throw new CliError(`run ${run} document ${hash} does not match its bytes.`);
  const dir = documentDir(root, run, hash);
  const extractDir = path.join(dir, "extract");
  let pages: InvoiceExtraction;
  if (live) {
    const { extract } = await import("dd-extract");
    const result = await extract({ pdf: bytes, outDir: extractDir, provider: "anthropic" });
    const failed = result.pages.find((page) => page.status === "failed");
    if (failed !== undefined) {
      throw new CliError(`run ${run} document ${hash} page ${failed.record.page} failed.`);
    }
    for (const page of result.pages) {
      if (page.status !== "ok") continue;
      const folder = path.join(extractDir, "pages", String(page.record.page).padStart(3, "0"));
      writeJson(path.join(folder, "extraction.json"), page.extraction);
    }
    pages = result.pages.flatMap((page) => (page.status === "ok" ? [page.extraction] : []));
  } else {
    pages = readStoredPages(extractDir, run, hash);
  }
  const invoice = stitch(pages);
  const elements = assignPresence(invoice, movement);
  writeJson(path.join(dir, "prepared.json"), { pages: pages.length, movement, invoice, elements });
}

function readStoredPages(extractDir: string, run: string, hash: string): PageExtraction[] {
  const pagesDir = path.join(extractDir, "pages");
  if (!fs.existsSync(pagesDir)) {
    throw new CliError(`run ${run} document ${hash} has no stored extraction. Pass --provider anthropic to read the PDF.`);
  }
  const names = fs
    .readdirSync(pagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{3}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) {
    throw new CliError(`run ${run} document ${hash} has no stored extraction. Pass --provider anthropic to read the PDF.`);
  }
  const pages: PageExtraction[] = [];
  names.forEach((name, index) => {
    const expected = index + 1;
    if (Number(name) !== expected) throw new CliError(`run ${run} document ${hash} is missing page ${expected}.`);
    const file = path.join(pagesDir, name, "extraction.json");
    if (!fs.existsSync(file)) {
      throw new CliError(`run ${run} document ${hash} has no stored extraction. Pass --provider anthropic to read the PDF.`);
    }
    const parsed = pageExtractionSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (!parsed.success || parsed.data.page !== expected) throw new CliError(`run ${run} document ${hash} page ${expected} did not parse.`);
    pages.push(parsed.data);
  });
  return pages;
}
