import { Client } from "pg";

export type CustomerRow = { id: string; displayName: string };

export type CustomerWrite = { ok: true } | { ok: false; message: string };

const DISPLAY_NAME = "Enter a display name.";
const CONFIG_ID = "Enter a config id like harbor_home.";
const DUPLICATE = "A customer with that config id already exists.";
const NOT_CONFIGURED = "The database is not configured.";

export type CustomerSql = {
  query: (text: string, values?: readonly unknown[]) => Promise<{ rows: readonly { id?: string }[] }>;
};

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

export function readCustomerFields(
  displayName: string,
  configId: string,
): { ok: true; displayName: string; configId: string } | { ok: false; message: string } {
  const name = displayName.trim();
  if (name.length < 1 || name.length > 120 || hasControl(name)) {
    return { ok: false, message: DISPLAY_NAME };
  }
  const id = configId.trim();
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(id)) return { ok: false, message: CONFIG_ID };
  return { ok: true, displayName: name, configId: id };
}

export async function insertCustomer(
  sql: CustomerSql,
  input: { displayName: string; configId: string; actor: string },
): Promise<CustomerWrite> {
  const fields = readCustomerFields(input.displayName, input.configId);
  if (!fields.ok) return fields;
  try {
    await sql.query("BEGIN");
    const inserted = await sql.query(
      `INSERT INTO "Customer" (config_id, display_name) VALUES ($1, $2) RETURNING id`,
      [fields.configId, fields.displayName],
    );
    const id = inserted.rows[0]?.id;
    if (id === undefined) throw new Error("The customer was not stored.");
    await sql.query(
      `INSERT INTO "AuditEvent" (customer_id, actor, action, payload)
       VALUES ($1, $2, 'customer_added', $3::jsonb)`,
      [id, input.actor, JSON.stringify({ config_id: fields.configId })],
    );
    await sql.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await sql.query("ROLLBACK");
    if (isUnique(error)) return { ok: false, message: DUPLICATE };
    throw error;
  }
}

export async function addCustomer(input: {
  displayName: string;
  configId: string;
  actor: string;
}): Promise<CustomerWrite> {
  const fields = readCustomerFields(input.displayName, input.configId);
  if (!fields.ok) return fields;
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") return { ok: false, message: NOT_CONFIGURED };
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await insertCustomer(
      {
        query: (text, values) => client.query(text, values === undefined ? undefined : [...values]),
      },
      { displayName: fields.displayName, configId: fields.configId, actor: input.actor },
    );
  } finally {
    await client.end();
  }
}

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
