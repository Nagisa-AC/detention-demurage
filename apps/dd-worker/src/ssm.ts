export const DATABASE_PARAMETER = "/dd/worker/database-url";
export const ANTHROPIC_PARAMETER = "/dd/worker/anthropic-api-key";

const TLS_MODES = new Set(["require", "verify-ca", "verify-full"]);

/** Refuse a URL that can connect without TLS. Stricter than require is verify-ca or verify-full. */
export function assertDatabaseTls(databaseUrl: string): void {
  let params: URLSearchParams;
  try {
    params = new URL(databaseUrl).searchParams;
  } catch {
    throw new Error("The database URL must set sslmode=require or stricter.");
  }
  const modes = [...params.entries()]
    .filter(([key]) => key.toLowerCase() === "sslmode")
    .map(([, value]) => value.trim().toLowerCase());
  if (modes.length !== 1 || !TLS_MODES.has(modes[0] ?? "")) {
    throw new Error("The database URL must set sslmode=require or stricter.");
  }
}

/** Values stay in the returned object. This function does not write them. */
export async function readWorkerSecrets(
  get: (name: string) => Promise<string>,
): Promise<{ databaseUrl: string; anthropicKey: string }> {
  const databaseUrl = await get(DATABASE_PARAMETER);
  const anthropicKey = await get(ANTHROPIC_PARAMETER);
  if (databaseUrl === "" || anthropicKey === "") throw new Error("A worker parameter is missing.");
  assertDatabaseTls(databaseUrl);
  return { databaseUrl, anthropicKey };
}
