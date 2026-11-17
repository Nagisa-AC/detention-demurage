import { readFileSync } from "node:fs";
import { readPdfPages } from "./pdf-text.js";

const file = process.argv[2];
if (file === undefined || file === "") {
  console.error("Pass the PDF path.");
  process.exit(1);
}

const pages = await readPdfPages(new Uint8Array(readFileSync(file)));
if (!pages.some((page) => page.trim().length > 0)) {
  console.error("The bundled reader returned an empty text layer.");
  process.exit(1);
}
