import { randomBytes } from "node:crypto";
import { CliError, fail } from "./cli-error.js";
import type { CommandIo } from "./layout.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PortalUserCognito = {
  create(input: { email: string; poolId: string }): Promise<{ sub: string }>;
};

export type PortalUserStore = {
  customerExists(customerId: string): Promise<boolean>;
  insert(row: { customerId: string; sub: string; email: string }): Promise<"ok" | "duplicate">;
};

export function createUserInput(poolId: string, email: string, temporaryPassword: string): {
  UserPoolId: string;
  Username: string;
  MessageAction: "SUPPRESS";
  TemporaryPassword: string;
  UserAttributes: { Name: string; Value: string }[];
} {
  return {
    UserPoolId: poolId,
    Username: email,
    MessageAction: "SUPPRESS",
    TemporaryPassword: temporaryPassword,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "email_verified", Value: "true" },
    ],
  };
}

/** Permanent moves the user to CONFIRMED. The password is not returned to the caller. */
export function setPasswordInput(poolId: string, email: string, password: string): {
  UserPoolId: string;
  Username: string;
  Password: string;
  Permanent: true;
} {
  return {
    UserPoolId: poolId,
    Username: email,
    Password: password,
    Permanent: true,
  };
}

export function oneTimePassword(): string {
  return `${randomBytes(24).toString("base64url")}Aa1!`;
}

export async function runPortalUser(
  io: CommandIo,
  deps?: { cognito: PortalUserCognito; store: PortalUserStore },
): Promise<number> {
  try {
    if (io.argv[0] !== "add") throw new CliError("Usage: dd portal-user add --customer <id> --email <email>");
    const customerId = flag(io.argv, "--customer");
    const email = flag(io.argv, "--email")?.toLowerCase() ?? null;
    if (customerId === null || !UUID.test(customerId) || email === null || !EMAIL.test(email) || email.length > 254) {
      throw new CliError("Usage: dd portal-user add --customer <id> --email <email>");
    }
    const poolId = io.env.PORTAL_COGNITO_USER_POOL_ID;
    if (poolId === undefined || poolId === "") throw new CliError("PORTAL_COGNITO_USER_POOL_ID is not set.");
    const cognito = deps?.cognito ?? (await liveCognito(io.env));
    const store = deps?.store ?? (await liveStore(io.env));
    if (!(await store.customerExists(customerId))) throw new CliError("That customer was not found.");
    const created = await cognito.create({ email, poolId });
    const saved = await store.insert({ customerId, sub: created.sub, email });
    if (saved === "duplicate") throw new CliError("That email already has a portal user.");
    io.stdout.write("Portal user added.\n");
    return 0;
  } catch (error) {
    return fail(io, error instanceof CliError ? error : new CliError("Could not add the portal user."));
  }
}

function flag(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined || value.startsWith("--")) return null;
  return value;
}

async function liveCognito(env: CommandIo["env"]): Promise<PortalUserCognito> {
  const { cognitoAdmin } = await import("./portal-user-cognito.js");
  return cognitoAdmin(env);
}

async function liveStore(env: CommandIo["env"]): Promise<PortalUserStore> {
  const { ownerStore } = await import("./portal-user-db.js");
  return ownerStore(env);
}
