import { customerConfigSchema, type CustomerConfig } from "dd-core";

export type PartyOption = { id: string; label: string };

export type BillingPartyPayload = {
  invoice_id: string;
  party_id: string;
  settings_version: number;
};

/** A billing_party_set payload. Extra fields are refused. */
export function parseBillingParty(value: unknown): BillingPartyPayload | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 3) return null;
  if (typeof row.invoice_id !== "string" || row.invoice_id === "") return null;
  if (typeof row.party_id !== "string" || row.party_id === "") return null;
  if (typeof row.settings_version !== "number" || !Number.isInteger(row.settings_version) || row.settings_version < 1) {
    return null;
  }
  return {
    invoice_id: row.invoice_id,
    party_id: row.party_id,
    settings_version: row.settings_version,
  };
}

/** Pursue ids, then do-not-pursue ids. The printed invoice name is not matched. */
export function partyOptions(config: CustomerConfig): PartyOption[] {
  return [
    ...config.billing_parties.pursue.map((id) => ({ id, label: id })),
    ...config.billing_parties.do_not_pursue.map((id) => ({ id, label: `${id} (do not pursue)` })),
  ];
}

export function partyInConfig(config: CustomerConfig, partyId: string): boolean {
  return (
    config.billing_parties.pursue.includes(partyId) || config.billing_parties.do_not_pursue.includes(partyId)
  );
}

/** Options from the highest version. An older version is ignored. */
export function optionsFromVersions(versions: readonly { version: number; config: unknown }[]): PartyOption[] {
  const current = versions.reduce<{ version: number; config: unknown } | null>((best, row) => {
    if (best === null || row.version > best.version) return row;
    return best;
  }, null);
  if (current === null) return [];
  const parsed = customerConfigSchema.safeParse(current.config);
  if (!parsed.success) return [];
  return partyOptions(parsed.data);
}

/**
 * Events are oldest first. The last payload for this invoice is the choice.
 * At approval, that is the latest event before the approval is written.
 */
export function latestParty(events: readonly { payload: unknown }[], invoiceId: string): BillingPartyPayload | null {
  let found: BillingPartyPayload | null = null;
  for (const event of events) {
    const parsed = parseBillingParty(event.payload);
    if (parsed === null || parsed.invoice_id !== invoiceId) continue;
    found = parsed;
  }
  return found;
}

/**
 * An approval that recorded a party keeps that party.
 * Otherwise the latest billing_party_set wins, including the one-time backfill after approval.
 */
export function shownPartyId(
  invoiceId: string,
  decisions: readonly { outcome: string; party_id?: string | undefined }[],
  events: readonly { payload: unknown }[],
): string | null {
  const approval = decisions.find((decision) => decision.outcome === "approved");
  if (approval?.party_id !== undefined && approval.party_id !== "") return approval.party_id;
  return latestParty(events, invoiceId)?.party_id ?? null;
}
