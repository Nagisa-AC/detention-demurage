import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { isSessionRequired, requireSession } from "../../../session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const require = createRequire(import.meta.url);

function workerFile(): string {
  const candidates = [
    path.join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
    path.join(process.cwd(), "../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
  ];
  try {
    candidates.unshift(require.resolve("pdfjs-dist/build/pdf.worker.min.mjs"));
  } catch {
    // A bundled server resolves the package from the candidates above.
  }
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error("The PDF worker is not installed.");
  return found;
}

export async function GET(): Promise<Response> {
  try {
    await requireSession({ path: "/api/pdf-worker", kind: "route" });
  } catch (error) {
    if (isSessionRequired(error)) {
      return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
    }
    throw error;
  }
  const bytes = await readFile(workerFile());
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "private, max-age=86400",
    },
  });
}
