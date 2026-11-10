import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract, type PageRecord } from "dd-extract";

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

async function main(): Promise<number> {
  if (process.env["CI"] !== undefined && process.env["CI"] !== "") {
    process.stderr.write("evals:capture does not run in CI.\n");
    return 1;
  }
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (apiKey === undefined || apiKey === "") {
    process.stderr.write("ANTHROPIC_API_KEY is not set.\n");
    return 1;
  }

  const root = repoRoot();
  let failed = false;
  for (const id of FIXTURES) {
    const pdf = fs.readFileSync(path.join(root, "fixtures/synthetic", `${id}.pdf`));
    const hash = createHash("sha256").update(pdf).digest("hex");
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dd-capture-"));
    try {
      const result = await extract({ pdf, outDir: temp, provider: "anthropic" });
      const dest = path.join(root, "evals/synthetic", id);
      fs.rmSync(path.join(dest, "pages"), { recursive: true, force: true });
      for (const page of result.pages) {
        const folder = path.join(dest, "pages", String(page.record.page).padStart(3, "0"));
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, "record.json"), json(stored(page.record, hash)));
        if (page.status === "ok") fs.writeFileSync(path.join(folder, "extraction.json"), json(page.extraction));
      }
      const pageFailed = result.pages.some((page) => page.status !== "ok");
      if (pageFailed) failed = true;
      process.stdout.write(`${id} ${result.pages.length} ${pageFailed ? "failed" : "ok"}\n`);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  return failed ? 1 : 0;
}

function stored(record: PageRecord, documentSha256: string): PageRecord & { document_sha256: string } {
  return { ...record, document_sha256: documentSha256 };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

const entry = process.argv[1];
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.name : "Error"}\n`);
      process.exitCode = 1;
    });
}
