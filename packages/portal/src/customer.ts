import type { PortalIdentity } from "./verify";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const portalBrand = Symbol("portal-customer");

/** A customer id that came from the verified Cognito sub. Callers cannot build this. */
export type PortalCustomer = { readonly customerId: string; readonly [portalBrand]: true };

export function isPortalCustomer(value: unknown): value is PortalCustomer {
  if (typeof value !== "object" || value === null) return false;
  const record = value as unknown as Record<PropertyKey, unknown>;
  const customerId = record.customerId;
  return record[portalBrand] === true && typeof customerId === "string" && UUID.test(customerId);
}

export type PortalAccount = { customer: PortalCustomer; email: string | null };

export type PortalVerifier = (token: string) => Promise<PortalIdentity | null>;
export type PortalLookup = (sub: string) => Promise<string | null>;

/**
 * The customer is the portal user for the verified sub.
 * A customer id on the URL, a header, or a form is not read.
 */
export async function resolvePortalCustomer(
  token: string | null,
  deps: { verify: PortalVerifier; lookup: PortalLookup },
): Promise<PortalAccount | null> {
  if (token === null || token.trim() === "") return null;
  const verified = await deps.verify(token);
  if (verified === null) return null;
  const sub = verified.sub.trim();
  if (sub === "" || sub.length > 256) return null;
  const customerId = await deps.lookup(sub);
  if (customerId === null || !UUID.test(customerId)) return null;
  return { customer: { customerId, [portalBrand]: true }, email: verified.email };
}
