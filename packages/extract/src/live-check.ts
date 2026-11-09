import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extract } from "./extract.js";

const FIXTURES = [
  "clean",
  "missing_elements",
  "late_37",
  "free_time_overbill",
  "arithmetic",
  "duplicate_a",
  "duplicate_b",
  "split_row",
] as const;

type FixtureName = (typeof FIXTURES)[number];

const name = process.argv[2] ?? "clean";
if (!isFixture(name)) {
  console.error(`Unknown fixture "${name}". Use one of: ${FIXTURES.join(", ")}.`);
  process.exit(1);
}
if (process.argv[3] !== undefined) {
  console.error("Pass one fixture name.");
  process.exit(1);
}

const pdfPath = path.resolve(process.cwd(), "fixtures/synthetic", `${name}.pdf`);
const pdf = new Uint8Array(fs.readFileSync(pdfPath));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `dd-extract-${name}-`));

const result = await extract({
  pdf,
  outDir,
  provider: "anthropic",
});

console.log(outDir);
for (const page of result.pages) {
  console.log(JSON.stringify({ record: page.record, extraction: page.status === "ok" ? page.extraction : null }, null, 2));
}

function isFixture(value: string): value is FixtureName {
  return (FIXTURES as readonly string[]).includes(value);
}
