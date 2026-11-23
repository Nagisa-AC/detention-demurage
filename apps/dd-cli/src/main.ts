import { spawn } from "node:child_process";
import { runExtract } from "./extract-command.js";
import { runIngest } from "./ingest-command.js";
import { runPortalUser } from "./portal-user.js";
import { runReport } from "./report-command.js";
import { runReview } from "./review-command.js";
import { runRulesCommand } from "./rules-command.js";

const command = process.argv[2];
const argv = process.argv.slice(3);
const io = { argv, env: process.env, stdout: process.stdout, stderr: process.stderr };

if (command === "ingest") {
  process.exitCode = await runIngest(io);
} else if (command === "extract") {
  process.exitCode = await runExtract(io);
} else if (command === "review") {
  process.exitCode = await runReview({ ...io, stdin: process.stdin, opener: openPdf });
} else if (command === "rules") {
  process.exitCode = await runRulesCommand(io);
} else if (command === "report") {
  process.exitCode = await runReport(io);
} else if (command === "portal-user") {
  process.exitCode = await runPortalUser(io);
} else {
  process.stderr.write("Usage: dd ingest | extract | review | rules | report <customer> --run <id> | portal-user add --customer <id> --email <email>\n");
  process.exitCode = 1;
}

function openPdf(pdfPath: string): void {
  const child = spawn("xdg-open", [pdfPath], { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}
