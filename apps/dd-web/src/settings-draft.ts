import type { CustomerConfig } from "dd-core";
import { stringify } from "yaml";

export type CarrierStance = "pursue" | "skip" | "covered";

export type RateDraft = {
  charge: string;
  fromDay: string;
  toDay: string;
  perDay: string;
  currency: string;
};

export type TermDraft = {
  billingParty: string;
  serviceContract: string;
  validFrom: string;
  validTo: string;
  demurrageDays: string;
  demurrageBasis: string;
  detentionDays: string;
  detentionBasis: string;
  rates: RateDraft[];
};

/** Form state. `feePct` is the stored decimal; `feePercent` is the 0–100 field. */
export type SettingsDraft = {
  configId: string;
  name: string;
  feePct: string;
  feePercent: string;
  billedAs: string;
  forwarder: string;
  document: string;
  signedOn: string;
  validUntil: string;
  carriers: { id: string; stance: CarrierStance }[];
  lookbackFrom: string;
  retentionDays: string;
  acceptsRealDocuments: boolean;
  storeContractTerms: boolean | null;
  contractTermsPresent: boolean;
  terms: TermDraft[];
};

const STANCES = new Set<CarrierStance>(["pursue", "skip", "covered"]);

/** The number shown in the fee field. "0.25" is "25". */
export function percentFromFee(fee: string): string {
  if (/^1(?:\.0+)?$/.test(fee)) return "100";
  const fraction = fee.split(".")[1] ?? "";
  const padded = `${fraction}00`;
  const head = padded.slice(0, 2);
  const tail = padded.slice(2).replace(/0+$/, "");
  const whole = head.replace(/^0+/, "") || "0";
  return tail === "" ? whole : `${whole}.${tail}`;
}

/** Decimal string stored as fee_pct. An unparsable entry is returned unchanged so the schema can reject it. */
export function feeFromPercent(input: string): string {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const [wholeRaw = "", fracRaw = ""] = trimmed.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const frac = fracRaw.replace(/0+$/, "");
  if (whole === "100" && frac === "") return "1";
  if (whole === "0" && frac === "") return "0";
  const digits = `${whole}${frac}`;
  const point = whole.length - 2;
  if (point > 0) {
    const left = digits.slice(0, point);
    const right = digits.slice(point).replace(/0+$/, "");
    return right === "" ? left : `${left}.${right}`;
  }
  const right = `${"0".repeat(-point)}${digits}`.replace(/0+$/, "");
  return `0.${right === "" ? "0" : right}`;
}

export function draftFromConfig(config: CustomerConfig): SettingsDraft {
  const covered = new Set<string>();
  const carriers: SettingsDraft["carriers"] = [];
  for (const id of config.authorization.covers) {
    covered.add(id);
    const stance: CarrierStance = config.billing_parties.pursue.includes(id)
      ? "pursue"
      : config.billing_parties.do_not_pursue.includes(id)
        ? "skip"
        : "covered";
    carriers.push({ id, stance });
  }
  for (const id of [...config.billing_parties.pursue, ...config.billing_parties.do_not_pursue]) {
    if (covered.has(id)) continue;
    carriers.push({
      id,
      stance: config.billing_parties.pursue.includes(id) ? "pursue" : "skip",
    });
  }
  return {
    configId: config.id,
    name: config.name,
    feePct: config.fee_pct,
    feePercent: percentFromFee(config.fee_pct),
    billedAs: config.billed_party_role,
    forwarder: config.nvocc ?? "",
    document: config.authorization.document,
    signedOn: config.authorization.signed_on,
    validUntil: config.authorization.valid_until,
    carriers,
    lookbackFrom: config.lookback_from,
    retentionDays: String(config.retention_days_after_close),
    acceptsRealDocuments: config.accepts_real_documents,
    storeContractTerms: config.store_contract_terms === undefined ? null : config.store_contract_terms,
    contractTermsPresent: config.contract_terms !== undefined,
    terms: (config.contract_terms ?? []).map(termFromConfig),
  };
}

export function blankDraft(input: { configId: string; name: string }): SettingsDraft {
  return {
    configId: input.configId,
    name: input.name,
    feePct: "",
    feePercent: "",
    billedAs: "direct",
    forwarder: "",
    document: "",
    signedOn: "",
    validUntil: "",
    carriers: [],
    lookbackFrom: "",
    retentionDays: "",
    acceptsRealDocuments: false,
    storeContractTerms: null,
    contractTermsPresent: false,
    terms: [],
  };
}

export function addCarrier(draft: SettingsDraft): SettingsDraft {
  return { ...draft, carriers: [...draft.carriers, { id: "", stance: "pursue" }] };
}

export function removeCarrier(draft: SettingsDraft, index: number): SettingsDraft {
  return { ...draft, carriers: draft.carriers.filter((_, at) => at !== index) };
}

export function addTerm(draft: SettingsDraft): SettingsDraft {
  const term: TermDraft = {
    billingParty: draft.carriers[0]?.id ?? "",
    serviceContract: "",
    validFrom: "",
    validTo: "",
    demurrageDays: "0",
    demurrageBasis: "calendar",
    detentionDays: "0",
    detentionBasis: "calendar",
    rates: [],
  };
  return {
    ...draft,
    storeContractTerms: true,
    contractTermsPresent: true,
    terms: [...draft.terms, term],
  };
}

export function removeTerm(draft: SettingsDraft, index: number): SettingsDraft {
  return { ...draft, terms: draft.terms.filter((_, at) => at !== index) };
}

export function addRate(draft: SettingsDraft, termIndex: number): SettingsDraft {
  return {
    ...draft,
    terms: draft.terms.map((term, index) =>
      index === termIndex
        ? { ...term, rates: [...term.rates, { charge: "demurrage", fromDay: "", toDay: "", perDay: "", currency: "USD" }] }
        : term,
    ),
  };
}

export function removeRate(draft: SettingsDraft, termIndex: number, rateIndex: number): SettingsDraft {
  return {
    ...draft,
    terms: draft.terms.map((term, index) =>
      index === termIndex ? { ...term, rates: term.rates.filter((_, at) => at !== rateIndex) } : term,
    ),
  };
}

/**
 * Plain document for the existing YAML parser.
 * The real-documents flag is omitted so a settings save cannot turn that switch.
 */
export function documentFromDraft(draft: SettingsDraft): Record<string, unknown> {
  const pursue = draft.carriers.filter((carrier) => carrier.stance === "pursue").map((carrier) => carrier.id);
  const skip = draft.carriers.filter((carrier) => carrier.stance === "skip").map((carrier) => carrier.id);
  const document: Record<string, unknown> = {
    id: draft.configId,
    name: draft.name,
    fee_pct: feeForSave(draft.feePct, draft.feePercent),
    billed_party_role: draft.billedAs,
    nvocc: draft.billedAs === "nvocc_passthrough" ? draft.forwarder : null,
    authorization: {
      document: draft.document,
      signed_on: draft.signedOn,
      valid_until: draft.validUntil,
      covers: draft.carriers.map((carrier) => carrier.id),
    },
    billing_parties: { pursue, do_not_pursue: skip },
  };
  const terms = draft.terms.map(termDocument);
  if (terms.length > 0) document.store_contract_terms = true;
  else if (draft.storeContractTerms !== null) document.store_contract_terms = draft.storeContractTerms;
  if (draft.contractTermsPresent || terms.length > 0) document.contract_terms = terms;
  document.lookback_from = draft.lookbackFrom;
  document.retention_days_after_close = integerField(draft.retentionDays);
  return document;
}

export function settingsYaml(draft: SettingsDraft): string {
  return stringify(documentFromDraft(draft), { schema: "core" });
}

export function isSettingsDraft(value: unknown): value is SettingsDraft {
  if (value === null || typeof value !== "object") return false;
  const draft = value as SettingsDraft;
  return (
    typeof draft.configId === "string" &&
    typeof draft.name === "string" &&
    typeof draft.feePct === "string" &&
    typeof draft.feePercent === "string" &&
    typeof draft.billedAs === "string" &&
    typeof draft.forwarder === "string" &&
    typeof draft.document === "string" &&
    typeof draft.signedOn === "string" &&
    typeof draft.validUntil === "string" &&
    typeof draft.lookbackFrom === "string" &&
    typeof draft.retentionDays === "string" &&
    typeof draft.acceptsRealDocuments === "boolean" &&
    (draft.storeContractTerms === null || typeof draft.storeContractTerms === "boolean") &&
    typeof draft.contractTermsPresent === "boolean" &&
    Array.isArray(draft.carriers) &&
    draft.carriers.every(
      (carrier) =>
        carrier !== null &&
        typeof carrier === "object" &&
        typeof carrier.id === "string" &&
        STANCES.has(carrier.stance),
    ) &&
    Array.isArray(draft.terms) &&
    draft.terms.every(isTermDraft)
  );
}

function feeForSave(original: string, percentInput: string): string {
  if (canonicalPercent(percentFromFee(original)) === canonicalPercent(percentInput)) return original;
  return feeFromPercent(percentInput);
}

function canonicalPercent(input: string): string {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const [whole = "", frac = ""] = trimmed.split(".");
  const head = whole.replace(/^0+(?=\d)/, "") || "0";
  const tail = frac.replace(/0+$/, "");
  return tail === "" ? head : `${head}.${tail}`;
}

function termFromConfig(term: NonNullable<CustomerConfig["contract_terms"]>[number]): TermDraft {
  return {
    billingParty: term.billing_party,
    serviceContract: term.service_contract,
    validFrom: term.valid_from,
    validTo: term.valid_to,
    demurrageDays: String(term.demurrage.free_days),
    demurrageBasis: term.demurrage.day_basis,
    detentionDays: String(term.detention.free_days),
    detentionBasis: term.detention.day_basis,
    rates: term.rates.map((rate) => ({
      charge: rate.charge,
      fromDay: String(rate.from_day),
      toDay: rate.to_day === undefined ? "" : String(rate.to_day),
      perDay: rate.per_day,
      currency: rate.currency,
    })),
  };
}

function termDocument(term: TermDraft): Record<string, unknown> {
  return {
    billing_party: term.billingParty,
    service_contract: term.serviceContract,
    valid_from: term.validFrom,
    valid_to: term.validTo,
    demurrage: { free_days: integerField(term.demurrageDays), day_basis: term.demurrageBasis },
    detention: { free_days: integerField(term.detentionDays), day_basis: term.detentionBasis },
    rates: term.rates.map((rate) => {
      const row: Record<string, unknown> = {
        charge: rate.charge,
        from_day: integerField(rate.fromDay),
        per_day: rate.perDay,
        currency: rate.currency,
      };
      if (rate.toDay.trim() !== "") row.to_day = integerField(rate.toDay);
      return row;
    }),
  };
}

function integerField(value: string): number | string {
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return trimmed;
}

function isTermDraft(value: unknown): value is TermDraft {
  if (value === null || typeof value !== "object") return false;
  const term = value as TermDraft;
  return (
    typeof term.billingParty === "string" &&
    typeof term.serviceContract === "string" &&
    typeof term.validFrom === "string" &&
    typeof term.validTo === "string" &&
    typeof term.demurrageDays === "string" &&
    typeof term.demurrageBasis === "string" &&
    typeof term.detentionDays === "string" &&
    typeof term.detentionBasis === "string" &&
    Array.isArray(term.rates) &&
    term.rates.every(
      (rate) =>
        rate !== null &&
        typeof rate === "object" &&
        typeof rate.charge === "string" &&
        typeof rate.fromDay === "string" &&
        typeof rate.toDay === "string" &&
        typeof rate.perDay === "string" &&
        typeof rate.currency === "string",
    )
  );
}
