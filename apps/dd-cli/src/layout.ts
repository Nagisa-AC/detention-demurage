import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadCustomerConfig, type CustomerConfig } from "dd-core";
import { CliError } from "./cli-error.js";
import { customerDir, isHash, isLabel, requireHash, requireLabel, stayInside } from "./paths.js";

export const DOCUMENT_TYPES = ["invoice", "bill_of_lading", "payment_proof", "contract", "carrier_response"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type Movement = "import" | "export";

export type IngestDocument = {
  sha256: string;
  type: DocumentType;
  source: string;
  movement: Movement;
};

export type CommandIo = {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
};

export function flagsOf(argv: readonly string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token.startsWith("--")) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new CliError(`${token} needs a value.`);
      flags.set(token, value);
      index += 1;
      continue;
    }
    positional.push(token);
  }
  return { positional, flags };
}

export function requireCustomer(argv: readonly string[], env: NodeJS.ProcessEnv): { customer: string; root: string } {
  const { positional } = flagsOf(argv);
  const customer = requireLabel(positional[0], "customer");
  return { customer, root: customerDir(env, customer) };
}

export function requireRun(argv: readonly string[], env: NodeJS.ProcessEnv): { customer: string; run: string; root: string; runDir: string } {
  const { customer, root } = requireCustomer(argv, env);
  const { flags } = flagsOf(argv);
  const run = requireLabel(flags.get("--run"), "run id");
  const runDir = stayInside(root, path.join(root, "runs", run));
  return { customer, run, root, runDir };
}

export function loadConfig(root: string, customer: string): CustomerConfig {
  const file = path.join(root, "config.yaml");
  if (!fs.existsSync(file)) throw new CliError("config.yaml was not found.");
  const config = loadCustomerConfig(file);
  if (config.id !== customer) throw new CliError(`customer ${customer} does not match config id ${config.id}`);
  return config;
}

export function readIngest(runDir: string): IngestDocument[] {
  const file = path.join(runDir, "ingest.json");
  if (!fs.existsSync(file)) return [];
  return parseIngest(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function writeIngest(runDir: string, documents: readonly IngestDocument[]): void {
  fs.mkdirSync(runDir, { recursive: true });
  const body = `${JSON.stringify({ documents }, null, 2)}\n`;
  const temp = path.join(runDir, `ingest.json.${process.pid}.tmp`);
  fs.writeFileSync(temp, body);
  fs.renameSync(temp, path.join(runDir, "ingest.json"));
}

export function listRuns(root: string): string[] {
  const runsDir = path.join(root, "runs");
  if (!fs.existsSync(runsDir)) return [];
  const names = fs.readdirSync(runsDir, { withFileTypes: true });
  const invalid = names.find((entry) => entry.isDirectory() && !isLabel(entry.name));
  if (invalid !== undefined) throw new CliError(`run folder ${invalid.name} must match ^[a-z0-9_-]+$`);
  return names
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function blobPath(root: string, hash: string): string {
  const checked = requireHash(hash, "document hash");
  return stayInside(root, path.join(root, "blobs", `${checked}.pdf`));
}

export function documentDir(root: string, run: string, hash: string): string {
  requireLabel(run, "run id");
  requireHash(hash, "document hash");
  return stayInside(root, path.join(root, "runs", run, hash));
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

export function requireType(value: string | undefined): DocumentType {
  if (value === undefined || !(DOCUMENT_TYPES as readonly string[]).includes(value)) {
    throw new CliError("type is invoice, bill_of_lading, payment_proof, contract, or carrier_response.");
  }
  return value as DocumentType;
}

export function requireMovement(value: string | undefined): Movement {
  if (value === undefined) return "import";
  if (value !== "import" && value !== "export") throw new CliError("movement is import or export.");
  return value;
}

function parseIngest(raw: unknown): IngestDocument[] {
  if (!isRecord(raw) || !Array.isArray(raw["documents"])) throw new CliError("ingest.json is invalid.");
  return raw["documents"].map((entry) => {
    if (!isRecord(entry)) throw new CliError("ingest.json is invalid.");
    const hash = entry["sha256"];
    const type = entry["type"];
    const source = entry["source"];
    const movement = entry["movement"];
    if (typeof hash !== "string" || !isHash(hash)) throw new CliError("ingest.json sha256 is invalid.");
    if (typeof type !== "string" || !(DOCUMENT_TYPES as readonly string[]).includes(type)) throw new CliError("ingest.json type is invalid.");
    if (typeof source !== "string" || source === "") throw new CliError("ingest.json source is invalid.");
    if (movement !== "import" && movement !== "export") throw new CliError("ingest.json movement is invalid.");
    return { sha256: hash, type: type as DocumentType, source, movement };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
