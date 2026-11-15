import { Client } from "pg";

export type CustomerRow = { id: string; displayName: string };

/** Empty when the database is not configured. The page still has to call requireSession first. */
export async function listCustomers(): Promise<CustomerRow[]> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") return [];
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM "Customer" ORDER BY display_name, id`,
    );
    return result.rows.map((row) => ({ id: row.id, displayName: row.display_name }));
  } finally {
    await client.end();
  }
}
