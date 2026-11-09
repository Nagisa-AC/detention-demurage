import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extract } from "./extract.js";

const pdfPath = path.resolve(process.cwd(), "fixtures/synthetic/clean.pdf");
const pdf = new Uint8Array(fs.readFileSync(pdfPath));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-extract-clean-"));

const result = await extract({
  pdf,
  outDir,
  provider: "anthropic",
});

console.log(outDir);
for (const page of result.pages) {
  console.log(JSON.stringify(page.record, null, 2));
}
