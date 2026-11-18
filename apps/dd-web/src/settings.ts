import { CustomerConfigError, customerConfigSchema, parseCustomerConfig, type CustomerConfig } from "dd-core";
import { Client } from "pg";

export type SettingsProblem = { path: string; message: string };

export type SettingsVersion = {
  version: number;
  createdBy: string;
  createdAt: string;
  config: CustomerConfig | null;
};

export type CustomerSettings = {
  id: string;
  displayName: string;
  configId: string;
  versions: SettingsVersion[];
};

export type SettingsWrite = { ok: true; version: number } | { ok: false; problems: SettingsProblem[] };

export type SettingsSql = {
  query: <T extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ) => Promise<{ rows: T[] }>;
};

const NOT_CONFIGURED: SettingsProblem = { path: "document", message: "the database is not configured" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Customers with their settings versions, newest version first. Empty when the database is not configured. */
export async function readCustomerSettings(): Promise<CustomerSettings[]> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") return [];
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const customers = await client.query<{ id: string; display_name: string; config_id: string }>(
      `SELECT id, display_name, config_id FROM "Customer" ORDER BY display_name, id`,
    );
    const versions = await client.query<{
      customer_id: string;
      version: number;
      config: unknown;
      created_by: string;
      created_at: Date;
    }>(
      `SELECT customer_id, version, config, created_by, created_at
       FROM "CustomerConfigVersion"
       ORDER BY customer_id, version DESC`,
    );
    const byCustomer = new Map<string, SettingsVersion[]>();
    for (const row of versions.rows) {
      const parsed = customerConfigSchema.safeParse(row.config);
      const list = byCustomer.get(row.customer_id) ?? [];
      list.push({
        version: row.version,
        createdBy: row.created_by,
        createdAt: row.created_at.toISOString(),
        config: parsed.success ? parsed.data : null,
      });
      byCustomer.set(row.customer_id, list);
    }
    return customers.rows.map((customer) => ({
      id: customer.id,
      displayName: customer.display_name,
      configId: customer.config_id,
      versions: byCustomer.get(customer.id) ?? [],
    }));
  } finally {
    await client.end();
  }
}

export async function saveCustomerSettings(input: {
  customerId: string;
  yaml: string;
  actor: string;
}): Promise<SettingsWrite> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") return { ok: false, problems: [NOT_CONFIGURED] };
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await insertSettingsVersion(
      {
        query: (text, values) => client.query(text, values === undefined ? undefined : [...values]),
      },
      input,
    );
  } finally {
    await client.end();
  }
}

/** Insert the next settings version and one settings_saved audit row. The payload is the version number only. */
export async function insertSettingsVersion(
  sql: SettingsSql,
  input: { customerId: string; yaml: string; actor: string },
): Promise<SettingsWrite> {
  if (!UUID.test(input.customerId)) {
    return { ok: false, problems: [{ path: "customer", message: "is not a customer" }] };
  }
  try {
    await sql.query("BEGIN");
    const locked = await sql.query<{ config_id: string }>(
      `SELECT config_id FROM "Customer" WHERE id = $1::uuid FOR UPDATE`,
      [input.customerId],
    );
    const configId = locked.rows[0]?.config_id;
    if (configId === undefined) {
      await sql.query("ROLLBACK");
      return { ok: false, problems: [{ path: "customer", message: "was not found" }] };
    }

    let config: CustomerConfig;
    try {
      config = parseCustomerConfig(input.yaml, "settings");
    } catch (error) {
      await sql.query("ROLLBACK");
      if (error instanceof CustomerConfigError) return { ok: false, problems: [...error.problems] };
      throw error;
    }
    if (config.id !== configId) {
      await sql.query("ROLLBACK");
      return { ok: false, problems: [{ path: "id", message: `must be ${configId}` }] };
    }

    const current = await sql.query<{ version: number }>(
      `SELECT COALESCE(MAX(version), 0)::int AS version
       FROM "CustomerConfigVersion"
       WHERE customer_id = $1::uuid`,
      [input.customerId],
    );
    const version = (current.rows[0]?.version ?? 0) + 1;
    await sql.query(
      `INSERT INTO "CustomerConfigVersion" (customer_id, version, config, created_by)
       VALUES ($1::uuid, $2::int, $3::jsonb, $4)`,
      [input.customerId, version, JSON.stringify(config), input.actor],
    );
    await sql.query(
      `INSERT INTO "AuditEvent" (customer_id, actor, action, payload)
       VALUES ($1::uuid, $2, 'settings_saved', $3::jsonb)`,
      [input.customerId, input.actor, JSON.stringify({ version })],
    );
    await sql.query("COMMIT");
    return { ok: true, version };
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  }
}

/** "0.25" is 25%. The fee stays a decimal string; this is display only. */
export function feePercent(fee: string): string {
  if (/^1(?:\.0+)?$/.test(fee)) return "100%";
  const fraction = fee.split(".")[1] ?? "";
  const padded = `${fraction}00`;
  const head = padded.slice(0, 2);
  const tail = padded.slice(2).replace(/0+$/, "");
  const whole = head.replace(/^0+/, "") || "0";
  return tail === "" ? `${whole}%` : `${whole}.${tail}%`;
}

export function settingsFacts(config: CustomerConfig): { label: string; value: string }[] {
  const terms = config.contract_terms?.length ?? 0;
  const termLabel = terms === 1 ? "1 contract term" : `${terms} contract terms`;
  return [
    { label: "Fee", value: feePercent(config.fee_pct) },
    {
      label: "Authorization",
      value: `signed ${config.authorization.signed_on}, valid until ${config.authorization.valid_until}`,
    },
    { label: "Pursue", value: partyList(config.billing_parties.pursue) },
    { label: "Do not pursue", value: partyList(config.billing_parties.do_not_pursue) },
    { label: "Contract terms", value: termLabel },
    { label: "Lookback", value: config.lookback_from },
  ];
}

export function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${formatted} ET`;
}

function partyList(ids: readonly string[]): string {
  return ids.length === 0 ? "none" : ids.join(", ");
}
