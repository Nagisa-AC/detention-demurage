import type { CustomerConfig } from "dd-core";
import { feePercent, formatSavedAt, type CustomerSettings } from "./settings";

export type Fact = { label: string; value: string };

export type CarrierCard = { id: string; pursue: boolean };

export type TermCard = { title: string; facts: Fact[] };

export type SettingsCards = {
  customerId: string;
  displayName: string;
  headline: string;
  engagement: Fact[] | null;
  unreadable: string | null;
  carriers: CarrierCard[];
  terms: TermCard[];
  history: string[];
};

/** Readable cards from the current settings version. The YAML editor stays separate. */
export function settingsCards(customer: CustomerSettings): SettingsCards {
  const current = customer.versions[0];
  const history = customer.versions.map(
    (version) => `Version ${version.version} saved by ${version.createdBy} on ${formatSavedAt(version.createdAt)}`,
  );
  if (current === undefined) {
    return {
      customerId: customer.id,
      displayName: customer.displayName,
      headline: "No settings yet",
      engagement: null,
      unreadable: null,
      carriers: [],
      terms: [],
      history,
    };
  }
  if (current.config === null) {
    return {
      customerId: customer.id,
      displayName: customer.displayName,
      headline: `Version ${current.version}`,
      engagement: null,
      unreadable: `Version ${current.version} cannot be shown.`,
      carriers: [],
      terms: [],
      history,
    };
  }
  return {
    customerId: customer.id,
    displayName: customer.displayName,
    headline: `Version ${current.version} · saved by ${current.createdBy}, ${formatSavedAt(current.createdAt)}`,
    engagement: engagementOf(current.config),
    unreadable: null,
    carriers: [
      ...current.config.billing_parties.pursue.map((id) => ({ id, pursue: true })),
      ...current.config.billing_parties.do_not_pursue.map((id) => ({ id, pursue: false })),
    ],
    terms: (current.config.contract_terms ?? []).map((term) => termCard(term)),
    history,
  };
}

function engagementOf(config: CustomerConfig): Fact[] {
  const covers = config.authorization.covers.length === 0 ? "none" : config.authorization.covers.join(", ");
  return [
    { label: "Fee", value: feePercent(config.fee_pct) },
    { label: "Billed as", value: billedAs(config) },
    {
      label: "Authorization",
      value: `Signed ${config.authorization.signed_on} · valid to ${config.authorization.valid_until} · covers ${covers}`,
    },
    { label: "Lookback from", value: config.lookback_from },
    { label: "Retention", value: `Documents kept ${config.retention_days_after_close} days after the case closes` },
  ];
}

function billedAs(config: CustomerConfig): string {
  if (config.billed_party_role === "direct") return "Direct";
  return config.nvocc === null ? "NVOCC passthrough" : `NVOCC passthrough · ${config.nvocc}`;
}

function termCard(term: NonNullable<CustomerConfig["contract_terms"]>[number]): TermCard {
  return {
    title: term.billing_party,
    facts: [
      { label: "Carrier", value: term.billing_party },
      { label: "Contract", value: term.service_contract },
      { label: "Valid", value: `${term.valid_from} to ${term.valid_to}` },
      { label: "Demurrage free days", value: `${term.demurrage.free_days} · ${term.demurrage.day_basis}` },
      { label: "Detention free days", value: `${term.detention.free_days} · ${term.detention.day_basis}` },
      { label: "Rates", value: term.rates.map(rateText).join(", ") },
    ],
  };
}

function rateText(rate: { charge: string; from_day: number; to_day?: number | undefined; per_day: string; currency: string }): string {
  const span = rate.to_day === undefined ? `day ${rate.from_day} on` : `days ${rate.from_day}–${rate.to_day}`;
  return `${rate.per_day} ${rate.currency}/day ${rate.charge} ${span}`;
}
