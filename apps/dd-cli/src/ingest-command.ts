import fs from "node:fs";
import path from "node:path";
import { CliError, fail } from "./cli-error.js";
import {
  blobPath,
  flagsOf,
  loadConfig,
  readIngest,
  requireMovement,
  requireRun,
  requireType,
  sha256,
  writeIngest,
  type CommandIo,
  type DocumentType,
  type IngestDocument,
  type Movement,
} from "./layout.js";

export async function runIngest(io: CommandIo): Promise<number> {
  try {
    const { root, runDir } = requireRun(io.argv, io.env);
    const { positional, flags } = flagsOf(io.argv);
    const customer = positional[0];
    if (customer === undefined) throw new CliError("customer must match ^[a-z0-9_-]+$");
    loadConfig(root, customer);
    const movement = requireMovement(flags.get("--movement"));
    const inputs = positional.slice(1);
    if (inputs.length === 0) throw new CliError("Usage: dd ingest <customer> --run <id> --type <type> <file>...");
    const files = collectFiles(inputs, flags.get("--type"));
    const documents = readIngest(runDir);
    const seen = new Set(documents.map((document) => document.sha256));
    for (const file of files) {
      const bytes = fs.readFileSync(file.path);
      const hash = sha256(bytes);
      const blob = blobPath(root, hash);
      if (fs.existsSync(blob) || seen.has(hash)) {
        io.stdout.write(`duplicate ${hash}\n`);
        continue;
      }
      fs.mkdirSync(path.dirname(blob), { recursive: true });
      const temp = `${blob}.${process.pid}.tmp`;
      fs.writeFileSync(temp, bytes);
      fs.renameSync(temp, blob);
      documents.push({ sha256: hash, type: file.type, source: path.basename(file.path), movement });
      seen.add(hash);
      writeIngest(runDir, documents);
    }
    return 0;
  } catch (error) {
    return fail(io, error);
  }
}

function collectFiles(inputs: readonly string[], typeFlag: string | undefined): { path: string; type: DocumentType }[] {
  const files: { path: string; type: DocumentType }[] = [];
  for (const input of inputs) {
    if (!fs.existsSync(input)) throw new CliError(`${input} was not found.`);
    const stat = fs.statSync(input);
    if (stat.isDirectory()) {
      const type = requireType(typeFlag ?? path.basename(input));
      const children = fs.readdirSync(input, { withFileTypes: true }).filter((entry) => entry.isFile());
      for (const child of children) files.push({ path: path.join(input, child.name), type });
      continue;
    }
    files.push({ path: input, type: requireType(typeFlag) });
  }
  return files;
}

export type { Movement, IngestDocument };
