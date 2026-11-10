export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export function fail(io: { stderr: { write(chunk: string): void } }, error: unknown): number {
  const message = error instanceof Error ? error.message : "The command failed.";
  io.stderr.write(`${message}\n`);
  return 1;
}
