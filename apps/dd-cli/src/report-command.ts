import fs from "node:fs";
import path from "node:path";
import { findingsCsv, reportJson, type RunReport } from "dd-core";
import { CliError, fail } from "./cli-error.js";
import { loadConfig, requireRun, type CommandIo } from "./layout.js";
import { publishFiles, type PublishHooks } from "./publish.js";

export type ReportIo = CommandIo & { publish?: PublishHooks };

export async function runReport(io: ReportIo): Promise<number> {
  try {
    const { root, run, runDir, customer } = requireRun(io.argv, io.env);
    loadConfig(root, customer);
    const day0 = readRules(path.join(runDir, "rules", "day0.json"), run);
    const day1 = readRules(path.join(runDir, "rules", "day1.json"), run);
    publishFiles(
      [
        { path: path.join(runDir, "report", "day0", "findings.csv"), contents: findingsCsv(day0) },
        { path: path.join(runDir, "report", "day0", "report.json"), contents: reportJson(day0) },
        { path: path.join(runDir, "report", "day1", "findings.csv"), contents: findingsCsv(day1) },
        { path: path.join(runDir, "report", "day1", "report.json"), contents: reportJson(day1) },
      ],
      io.publish,
    );
    return 0;
  } catch (error) {
    return fail(io, error);
  }
}

function readRules(file: string, run: string): RunReport {
  if (!fs.existsSync(file)) throw new CliError(`run ${run} has no rules output.`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new CliError(`run ${run} rules output did not parse.`);
  }
  if (!isReport(raw)) throw new CliError(`run ${run} rules output did not parse.`);
  return raw;
}

function isReport(value: unknown): value is RunReport {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (record["convention"] === "day0" || record["convention"] === "day1") && Array.isArray(record["findings"]) && Array.isArray(record["invoices"]) && Array.isArray(record["total_disputable"]);
}
