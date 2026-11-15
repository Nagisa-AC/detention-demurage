type LogFn = (line: string) => void;

let write: LogFn = (line) => {
  console.info(line);
};

/** Test seam. Production logs with console.info. */
export function setLog(fn: LogFn): void {
  write = fn;
}

/** Route and whether a session was present. Nothing else. */
export function logRequest(path: string, sessionPresent: boolean): void {
  write(`path ${path} session ${sessionPresent ? "yes" : "no"}`);
}
