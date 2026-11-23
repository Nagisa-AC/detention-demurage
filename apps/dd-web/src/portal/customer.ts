import { withReviewDb, type ReviewSql } from "../review-data";
import { verifyPortalIdToken } from "./verify";

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

export type PortalVerifier = (token: string) => Promise<{ sub: string } | null>;
export type PortalLookup = (sub: string) => Promise<string | null>;

/**
 * The customer is the PortalUser row for the verified sub.
 * A customer id on the URL, a header, or a form is not read.
 */
export async function resolvePortalCustomer(
  request: { url: string; headers: { get(name: string): string | null } },
  deps: { verify: PortalVerifier; lookup: PortalLookup },
): Promise<PortalCustomer | null> {
  const token = bearer(request.headers.get("authorization"));
  if (token === null) return null;
  const verified = await deps.verify(token);
  if (verified === null) return null;
  const sub = verified.sub.trim();
  if (sub === "" || sub.length > 256) return null;
  const customerId = await deps.lookup(sub);
  if (customerId === null || !UUID.test(customerId)) return null;
  return { customerId, [portalBrand]: true };
}

export async function lookupPortalCustomer(sql: ReviewSql, sub: string): Promise<string | null> {
  if (sub.trim() === "" || sub.length > 256) return null;
  const result = await sql.query<{ customer_id: string }>(
    `SELECT pu.customer_id
     FROM "PortalUser" pu
     WHERE pu.cognito_sub = $1
       AND NOT EXISTS (
         SELECT 1 FROM "AuditEvent" e
         WHERE e.customer_id = pu.customer_id
           AND e.action = 'portal_user_disabled'
           AND e.payload->>'portal_user_id' = pu.id::text
       )`,
    [sub],
  );
  const customerId = result.rows[0]?.customer_id;
  if (customerId === undefined || !UUID.test(customerId)) return null;
  return customerId;
}

/** Production entry. The sub is checked against the portal pool, then PortalUser. */
export async function resolvePortalRequest(request: {
  url: string;
  headers: { get(name: string): string | null };
}): Promise<PortalCustomer | null> {
  return resolvePortalCustomer(request, {
    verify: verifyPortalIdToken,
    lookup: async (sub) => {
      const customerId = await withReviewDb((sql) => lookupPortalCustomer(sql, sub));
      return customerId ?? null;
    },
  });
}

function bearer(header: string | null): string | null {
  if (header === null) return null;
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header.trim());
  const token = match?.[1];
  if (token === undefined || token === "") return null;
  return token;
}
