import path from "node:path";
import { CliError } from "./cli-error.js";

const LABEL = /^[a-z0-9_-]+$/;
const HASH = /^[0-9a-f]{64}$/;

export function dataDir(env: NodeJS.ProcessEnv): string {
  const value = env["DD_DATA_DIR"];
  if (value === undefined || value === "") throw new CliError("DD_DATA_DIR is not set.");
  return value;
}

/** Checked before any path is built. A value such as `../x` never reaches `path.join`. */
export function requireLabel(value: string | undefined, name: string): string {
  if (value === undefined || !LABEL.test(value)) throw new CliError(`${name} must match ^[a-z0-9_-]+$`);
  return value;
}

export function requireHash(value: string | undefined, name: string): string {
  if (value === undefined || !HASH.test(value)) throw new CliError(`${name} must match ^[0-9a-f]{64}$`);
  return value;
}

export function isHash(value: string): boolean {
  return HASH.test(value);
}

export function isLabel(value: string): boolean {
  return LABEL.test(value);
}

export function customerDir(env: NodeJS.ProcessEnv, customer: string): string {
  const root = dataDir(env);
  const id = requireLabel(customer, "customer");
  return stayInside(root, path.join(root, id));
}

export function stayInside(root: string, candidate: string): string {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new CliError("path escapes DD_DATA_DIR");
  return resolved;
}
