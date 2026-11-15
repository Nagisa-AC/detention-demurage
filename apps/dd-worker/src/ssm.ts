export const DATABASE_PARAMETER = "/dd/worker/database-url";
export const ANTHROPIC_PARAMETER = "/dd/worker/anthropic-api-key";

/** Values stay in the returned object. This function does not write them. */
export async function readWorkerSecrets(
  get: (name: string) => Promise<string>,
): Promise<{ databaseUrl: string; anthropicKey: string }> {
  const databaseUrl = await get(DATABASE_PARAMETER);
  const anthropicKey = await get(ANTHROPIC_PARAMETER);
  if (databaseUrl === "" || anthropicKey === "") throw new Error("A worker parameter is missing.");
  return { databaseUrl, anthropicKey };
}
