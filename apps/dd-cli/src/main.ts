import { spawn } from "node:child_process";
import { runReview } from "./review-command.js";

const command = process.argv[2];
if (command !== "review") {
  process.stderr.write("Usage: dd review <invoice.json> --pdf <file> --name <name> --now <iso> --out <dir>\n");
  process.exitCode = 1;
} else {
  const code = await runReview({
    argv: process.argv.slice(3),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    opener: openPdf,
  });
  process.exitCode = code;
}

function openPdf(pdfPath: string): void {
  const child = spawn("xdg-open", [pdfPath], { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}
