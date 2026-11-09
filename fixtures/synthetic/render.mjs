import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { invoices, serializeInvoice } from "./catalog.mjs";
import { LABELS } from "./labels.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function rowCells(line, part) {
  if (part === "tail") {
    return ["", "", "", "", "", "", line.amount];
  }
  const head = [
    line.container,
    line.charge,
    line.charged_from,
    line.charged_to,
    line.days,
    line.rate,
  ];
  if (part === "head") {
    return [...head, ""];
  }
  return [...head, line.amount];
}

function rowsOnPage(invoice, pageNumber) {
  const rows = [];
  for (const line of invoice.charge_lines) {
    const placement = line.placement;
    if (placement.kind === "row" && placement.page === pageNumber) {
      rows.push(rowCells(line, "full"));
    }
    if (placement.kind === "split" && placement.head_page === pageNumber) {
      rows.push(rowCells(line, "head"));
    }
    if (placement.kind === "split" && placement.tail_page === pageNumber) {
      rows.push(rowCells(line, "tail"));
    }
  }
  return rows;
}

export function invoiceHtml(invoice) {
  const sheets = [];
  for (let pageNumber = 1; pageNumber <= invoice.pages; pageNumber += 1) {
    const fields = Object.entries(invoice.elements)
      .filter(([, element]) => element.state === "present" && element.page === pageNumber)
      .map(([key, element]) => {
        const label = LABELS[key];
        return `<p>${escapeHtml(label)}: ${escapeHtml(element.text)}</p>`;
      });
    const rows = rowsOnPage(invoice, pageNumber);
    const table = rows.length === 0
      ? ""
      : `<table>
          <thead><tr>${["Container", "Charge", "From", "To", "Days", "Rate", "Amount"].map((heading) => `<th>${heading}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>`;
    const heading = pageNumber === 1
      ? `<h1>Invoice ${escapeHtml(invoice.invoice_number)}</h1>
         <p>Billing party: ${escapeHtml(invoice.billing_party)}</p>
         <p>Billed party: ${escapeHtml(invoice.billed_party)}</p>`
      : `<h1>Invoice ${escapeHtml(invoice.invoice_number)} page ${pageNumber}</h1>`;
    sheets.push(`<section class="sheet">${heading}${fields.join("")}${table}</section>`);
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: Letter; margin: 12mm; }
    body { font-family: "DejaVu Sans", sans-serif; font-size: 12px; color: #111; }
    h1 { font-size: 16px; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; }
    th, td { border: 1px solid #222; padding: 4px 6px; text-align: left; }
    .sheet { break-after: page; }
    .sheet:last-child { break-after: auto; }
  </style>
</head>
<body>
${sheets.join("\n")}
</body>
</html>`;
}

export async function renderPdfs(targetDir, source = invoices) {
  fs.mkdirSync(targetDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const invoice of source) {
      await page.setContent(invoiceHtml(invoice), { waitUntil: "load" });
      await page.pdf({
        path: path.join(targetDir, `${invoice.id}.pdf`),
        format: "Letter",
        preferCSSPageSize: true,
        printBackground: true,
      });
    }
  } finally {
    await browser.close();
  }
}

export function writeTruthFiles(targetDir, source = invoices) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const invoice of source) {
    fs.writeFileSync(path.join(targetDir, `${invoice.id}.json`), serializeInvoice(invoice));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeTruthFiles(root);
  await renderPdfs(root);
}
