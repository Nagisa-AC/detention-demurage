import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import {
  ELEMENT_KEYS,
  ReviewError,
  savedDecisionSchema,
  startReview,
  type ElementKey,
  type ReviewSession,
} from "dd-core";
import { CliError } from "./cli-error.js";
import { blobPath, documentDir, flagsOf, loadConfig, requireRun, sha256, writeJson } from "./layout.js";
import { requireHash, requireLabel } from "./paths.js";
import { readPrepared } from "./prepared.js";

export type ReviewIo = {
  argv: readonly string[];
  env?: NodeJS.ProcessEnv;
  stdin: Readable;
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  opener: (pdfPath: string) => void;
};

export async function runReview(io: ReviewIo): Promise<number> {
  try {
    if (!io.argv.includes("--pdf")) return await runCustomerReview(io);
    const args = parseArgs(io.argv);
    const file = readPrepared(args.invoicePath, "The invoice file");
    const pdf = fs.readFileSync(args.pdfPath);
    const documentHash = sha256(pdf);
    const prior = args.decisionsPath === undefined ? [] : readDecisions(args.decisionsPath);
    io.opener(args.pdfPath);
    const session = startReview({
      documentHash,
      invoice: file.invoice,
      elements: file.elements,
      pages: file.pages,
      name: args.name,
      at: args.now,
      ...(args.dateHint === undefined ? {} : { dateHint: args.dateHint }),
      priorDecisions: prior,
    });
    return await conduct(io, session, file.pages, () => {
      fs.mkdirSync(args.outDir, { recursive: true });
      fs.writeFileSync(path.join(args.outDir, "review.json"), `${JSON.stringify(session.finish(), null, 2)}\n`);
    });
  } catch (error) {
    const message = error instanceof ReviewError || error instanceof CliError || error instanceof Error ? error.message : "The review failed.";
    io.stderr.write(`${message}\n`);
    return 1;
  }
}

async function runCustomerReview(io: ReviewIo): Promise<number> {
  const env = io.env ?? process.env;
  const { positional, flags } = flagsOf(io.argv);
  requireLabel(positional[0], "customer");
  requireLabel(flags.get("--run"), "run id");
  const hash = requireHash(flags.get("--document"), "document hash");
  const { root, run, customer } = requireRun(io.argv, env);
  loadConfig(root, customer);
  const name = flags.get("--name");
  const now = flags.get("--now");
  if (name === undefined || name === "" || now === undefined || now === "") {
    throw new ReviewError("Usage: dd review <customer> --run <id> --document <sha256> --name <name> --now <iso>");
  }
  const hint = flags.get("--date-hint");
  if (hint !== undefined && hint !== "DMY" && hint !== "MDY") throw new ReviewError("The date hint is DMY or MDY.");
  const dir = documentDir(root, run, hash);
  const preparedPath = path.join(dir, "prepared.json");
  const prepared = readPrepared(preparedPath);
  const blob = blobPath(root, hash);
  if (!fs.existsSync(blob)) throw new CliError(`run ${run} document ${hash} was not ingested.`);
  const pdf = fs.readFileSync(blob);
  if (sha256(pdf) !== hash) throw new CliError(`run ${run} document ${hash} does not match its bytes.`);
  const decisions = flags.get("--decisions");
  const prior = decisions === undefined ? [] : readDecisions(decisions);
  io.opener(blob);
  const session = startReview({
    documentHash: hash,
    invoice: prepared.invoice,
    elements: prepared.elements,
    pages: prepared.pages,
    name,
    at: now,
    ...(hint === "DMY" || hint === "MDY" ? { dateHint: hint } : {}),
    priorDecisions: prior,
  });
  return conduct(io, session, prepared.pages, () => {
    writeJson(path.join(dir, "review.json"), session.finish());
    fs.writeFileSync(path.join(dir, "review.stamp"), `${sha256(fs.readFileSync(preparedPath))}\n`);
  });
}

async function conduct(io: ReviewIo, session: ReviewSession, pages: number, finish: () => void): Promise<number> {
  const lines = readline.createInterface({ input: io.stdin, crlfDelay: Infinity });
  try {
    const read = lines[Symbol.asyncIterator]();
    for (let page = 1; page <= pages; page += 1) {
      io.stdout.write(`page ${page} of ${pages}\n`);
      const answer = await read.next();
      if (answer.done === true) {
        io.stderr.write("The review did not finish.\n");
        return 1;
      }
      session.acknowledge(page);
    }
    listOpen(io, session);
    for (;;) {
      const answer = await read.next();
      if (answer.done === true) {
        io.stderr.write("The review did not finish.\n");
        return 1;
      }
      const command = String(answer.value).trim();
      if (command === "") continue;
      if (command === "finish") {
        finish();
        return 0;
      }
      apply(session, command);
    }
  } finally {
    lines.close();
  }
}

function readDecisions(filePath: string) {
  const raw: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(raw)) throw new ReviewError("Decisions must be a list.");
  return raw.map((entry) => savedDecisionSchema.parse(entry));
}

function listOpen(io: ReviewIo, session: ReviewSession): void {
  const view = session.view();
  for (const key of ELEMENT_KEYS) {
    const element = view.elements[key];
    if ("state" in element && (element.state === "suggested_absent" || element.state === "unreadable")) {
      io.stdout.write(`${key} ${element.state}\n`);
    }
  }
  for (const conflict of view.header_conflicts) {
    io.stdout.write(`header ${conflict.field} differs\n`);
  }
  view.unresolved.forEach((fragment, index) => {
    io.stdout.write(`fragment ${index} ${fragment.kind} page ${fragment.page}\n`);
  });
}

function apply(session: ReviewSession, command: string): void {
  const [verb, ...rest] = command.split(" ");
  if (verb === "confirm" && rest.length === 1 && isKey(rest[0])) {
    session.confirmAbsent(rest[0]);
    return;
  }
  if (verb === "found" && rest.length >= 3 && isKey(rest[0]) && rest[1] !== undefined) {
    session.found(rest[0], Number(rest[1]), rest.slice(2).join(" "));
    return;
  }
  if (verb === "correct" && rest.length >= 2 && isKey(rest[0])) {
    session.correct(rest[0], rest.slice(1).join(" "));
    return;
  }
  if (verb === "unreadable" && rest.length >= 2 && isKey(rest[0])) {
    session.markUnreadable(rest[0], rest.slice(1).join(" "));
    return;
  }
  if (verb === "approve-lines" && rest.length === 0) {
    session.approveLines();
    return;
  }
  if (verb === "edit" && rest.length >= 3 && rest[0] !== undefined && rest[1] !== undefined) {
    session.editLine(rest[0], rest[1], rest.slice(2).join(" "));
    return;
  }
  if (verb === "join" && rest.length === 2 && rest[0] !== undefined && rest[1] !== undefined) {
    session.join(Number(rest[0]), Number(rest[1]));
    return;
  }
  if (verb === "split" && rest.length === 1 && rest[0] !== undefined) {
    session.split(rest[0]);
    return;
  }
  if (verb === "dismiss" && rest.length >= 2 && rest[0] !== undefined) {
    session.dismissFragment(Number(rest[0]), rest.slice(1).join(" "));
    return;
  }
  throw new ReviewError(`Unknown command: ${command}`);
}

function isKey(value: string | undefined): value is ElementKey {
  return value !== undefined && (ELEMENT_KEYS as readonly string[]).includes(value);
}

type Args = {
  invoicePath: string;
  pdfPath: string;
  name: string;
  now: string;
  outDir: string;
  dateHint?: "DMY" | "MDY";
  decisionsPath?: string;
};

function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (token.startsWith("--")) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new ReviewError(`${token} needs a value.`);
      flags.set(token, value);
      index += 1;
      continue;
    }
    positional.push(token);
  }
  const invoicePath = positional[0];
  const pdfPath = flags.get("--pdf");
  const name = flags.get("--name");
  const now = flags.get("--now");
  const outDir = flags.get("--out");
  if (invoicePath === undefined || pdfPath === undefined || name === undefined || now === undefined || outDir === undefined) {
    throw new ReviewError("Usage: dd review <invoice.json> --pdf <file> --name <name> --now <iso> --out <dir>");
  }
  const hint = flags.get("--date-hint");
  if (hint !== undefined && hint !== "DMY" && hint !== "MDY") throw new ReviewError("The date hint is DMY or MDY.");
  const args: Args = { invoicePath, pdfPath, name, now, outDir };
  if (hint === "DMY" || hint === "MDY") args.dateHint = hint;
  const decisions = flags.get("--decisions");
  if (decisions !== undefined) args.decisionsPath = decisions;
  return args;
}
