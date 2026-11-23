import { Client } from "pg";
import { CliError } from "./cli-error.js";
import type { PortalUserStore } from "./portal-user.js";

export function ownerStore(env: NodeJS.ProcessEnv): PortalUserStore {
  const url = env.DATABASE_URL;
  if (url === undefined || url === "") throw new CliError("DATABASE_URL is not set.");
  return {
    async customerExists(customerId) {
      return withClient(url, async (client) => {
        const result = await client.query(`SELECT 1 FROM "Customer" WHERE id = $1`, [customerId]);
        return (result.rowCount ?? 0) > 0;
      });
    },
    async insert(row) {
      return withClient(url, async (client) => {
        try {
          await client.query(
            `INSERT INTO "PortalUser" (customer_id, cognito_sub, email) VALUES ($1, $2, $3)`,
            [row.customerId, row.sub, row.email],
          );
          return "ok";
        } catch (error) {
          const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
          if (code === "23505") return "duplicate";
          throw new CliError("Could not save the portal user.");
        }
      });
    },
  };
}

async function withClient<T>(url: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}
