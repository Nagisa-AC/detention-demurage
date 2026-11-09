import fs from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

const partyIdSchema = z.string().min(1, "must be a non-empty string");
const isoDateSchema = z.iso.date("must be a YYYY-MM-DD date");
const moneySchema = z.string().regex(/^\d+\.\d{2}$/, "must be a two-decimal string");
const currencySchema = z.string().regex(/^[A-Z]{3}$/, "must be three letters");

/**
 * Inclusive from 0 through 1. Digits only: "0.25" never becomes a float.
 * "0", "1", and "1.00" pass. A leading zero, other than the zero in "0.25", fails.
 */
const feePctSchema = z.custom<string>(
  (value) => typeof value === "string" && /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value),
  "must be a decimal string from 0 through 1",
);

/**
 * Business days still need a holiday calendar. That list is an open item,
 * so `business` is accepted here and no holiday field is required.
 */
const dayBasisSchema = z.enum(["calendar", "business"], "must be calendar or business");

const freeTimeSchema = z.strictObject({
  free_days: z.int("must be an integer").nonnegative("must be a non-negative integer"),
  day_basis: dayBasisSchema,
});

const rateTierSchema = z
  .strictObject({
    charge: z.enum(["demurrage", "detention"], "must be demurrage or detention"),
    from_day: z.int("must be an integer").positive("must be a positive integer"),
    to_day: z.int("must be an integer").positive("must be a positive integer").exactOptional(),
    per_day: moneySchema,
    currency: currencySchema,
  })
  .superRefine((rate, ctx) => {
    if (rate.to_day !== undefined && rate.to_day < rate.from_day) {
      ctx.addIssue({
        code: "custom",
        path: ["to_day"],
        message: "to_day is before from_day",
      });
    }
  });

type RateTier = z.infer<typeof rateTierSchema>;

const contractTermSchema = z
  .strictObject({
    billing_party: partyIdSchema,
    service_contract: z.string().min(1, "must be a non-empty string"),
    valid_from: isoDateSchema,
    valid_to: isoDateSchema,
    demurrage: freeTimeSchema,
    detention: freeTimeSchema,
    rates: z.array(rateTierSchema),
  })
  .superRefine((term, ctx) => {
    if (term.valid_to < term.valid_from) {
      ctx.addIssue({
        code: "custom",
        path: ["valid_to"],
        message: "valid_to is before valid_from",
      });
    }
    for (const overlap of tierOverlaps(term.rates)) {
      ctx.addIssue({
        code: "custom",
        path: ["rates", overlap.index],
        message: overlap.message,
      });
    }
  });

type ContractTerm = z.infer<typeof contractTermSchema>;

export const customerConfigSchema = z
  .strictObject({
    id: z.string().min(1, "must be a non-empty string"),
    name: z.string().min(1, "must be a non-empty string"),
    fee_pct: feePctSchema,
    billed_party_role: z.enum(["direct", "nvocc_passthrough"], "must be direct or nvocc_passthrough"),
    nvocc: z.string().min(1, "must be a non-empty string").nullable(),
    authorization: z.strictObject({
      document: z.string().min(1, "must be a non-empty string"),
      signed_on: isoDateSchema,
      valid_until: isoDateSchema,
      covers: z.array(partyIdSchema),
    }),
    billing_parties: z.strictObject({
      pursue: z.array(partyIdSchema),
      do_not_pursue: z.array(partyIdSchema),
    }),
    store_contract_terms: z.boolean().exactOptional(),
    contract_terms: z.array(contractTermSchema).exactOptional(),
    lookback_from: isoDateSchema,
    retention_days_after_close: z.int("must be an integer").positive("must be a positive integer"),
  })
  .superRefine((config, ctx) => {
    const pursue = config.billing_parties.pursue;
    const refused = config.billing_parties.do_not_pursue;
    const covers = new Set(config.authorization.covers);

    for (const id of repeated(pursue)) {
      ctx.addIssue({
        code: "custom",
        path: ["billing_parties", "pursue"],
        message: `${id} is repeated`,
      });
    }
    for (const id of repeated(refused)) {
      ctx.addIssue({
        code: "custom",
        path: ["billing_parties", "do_not_pursue"],
        message: `${id} is repeated`,
      });
    }

    const refusedSet = new Set(refused);
    for (const id of new Set(pursue)) {
      if (refusedSet.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["billing_parties", "pursue"],
          message: `${id} is in both pursue and do_not_pursue`,
        });
      }
    }
    for (const id of new Set(pursue)) {
      if (!covers.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["billing_parties", "pursue"],
          message: `${id} is not in authorization.covers`,
        });
      }
    }
    for (const id of new Set(refused)) {
      if (!covers.has(id)) {
        ctx.addIssue({
          code: "custom",
          path: ["billing_parties", "do_not_pursue"],
          message: `${id} is not in authorization.covers`,
        });
      }
    }

    if (config.billed_party_role === "direct" && config.nvocc !== null) {
      ctx.addIssue({ code: "custom", path: ["nvocc"], message: "direct has no nvocc" });
    }
    if (config.billed_party_role === "nvocc_passthrough" && config.nvocc === null) {
      ctx.addIssue({
        code: "custom",
        path: ["nvocc"],
        message: "nvocc_passthrough names the nvocc",
      });
    }

    if (config.authorization.valid_until < config.authorization.signed_on) {
      ctx.addIssue({
        code: "custom",
        path: ["authorization", "valid_until"],
        message: "valid_until is before signed_on",
      });
    }

    const terms = config.contract_terms ?? [];
    if (terms.length > 0 && config.store_contract_terms !== true) {
      ctx.addIssue({
        code: "custom",
        path: ["contract_terms"],
        message: "contract terms require store_contract_terms: true",
      });
    }
    terms.forEach((term, index) => {
      if (!covers.has(term.billing_party)) {
        ctx.addIssue({
          code: "custom",
          path: ["contract_terms", index, "billing_party"],
          message: `${term.billing_party} is not in authorization.covers`,
        });
      }
    });
    for (const overlap of crossContractOverlaps(terms)) {
      ctx.addIssue({
        code: "custom",
        path: ["contract_terms", overlap.termIndex, "rates", overlap.rateIndex],
        message: overlap.message,
      });
    }
  });

export type CustomerConfig = z.infer<typeof customerConfigSchema>;

export type ConfigProblem = {
  path: string;
  message: string;
};

export class CustomerConfigError extends Error {
  readonly filePath: string;
  readonly problems: readonly ConfigProblem[];

  constructor(filePath: string, problems: readonly ConfigProblem[]) {
    super(problems.map((problem) => `${filePath}: ${problem.path}: ${problem.message}`).join("\n"));
    this.name = "CustomerConfigError";
    this.filePath = filePath;
    this.problems = problems;
  }
}

/** Read one customer YAML file. Throws CustomerConfigError naming the file and each field. */
export function loadCustomerConfig(filePath: string): CustomerConfig {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    const code = readCode(error);
    const message = code === "ENOENT" ? "file not found" : "could not be read";
    throw new CustomerConfigError(filePath, [{ path: "document", message }]);
  }

  let document: unknown;
  try {
    // Core schema keeps unquoted dates and decimal strings as strings.
    document = parse(text, { schema: "core" });
  } catch {
    throw new CustomerConfigError(filePath, [{ path: "document", message: "is not valid YAML" }]);
  }
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw new CustomerConfigError(filePath, [{ path: "document", message: "must be a mapping" }]);
  }

  const parsed = customerConfigSchema.safeParse(document);
  if (!parsed.success) {
    const problems = parsed.error.issues.flatMap((issue): ConfigProblem[] => {
      if (issue.code === "unrecognized_keys") {
        const prefix = issue.path.map(String).join(".");
        return issue.keys.map((key) => ({
          path: prefix.length === 0 ? key : `${prefix}.${key}`,
          message: "is not a field",
        }));
      }
      return [
        {
          path: issue.path.length === 0 ? "document" : issue.path.map(String).join("."),
          message: issue.message,
        },
      ];
    });
    throw new CustomerConfigError(
      filePath,
      problems.length > 0 ? problems : [{ path: "document", message: "is not a valid customer config" }],
    );
  }
  return parsed.data;
}

function readCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

function repeated(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeats: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      if (!repeats.includes(id)) repeats.push(id);
    } else {
      seen.add(id);
    }
  }
  return repeats;
}

type TierOverlap = {
  index: number;
  message: string;
};

function tierOverlaps(rates: readonly RateTier[]): TierOverlap[] {
  const overlaps: TierOverlap[] = [];
  const seen = new Map<RateTier["charge"], { index: number; from: number; to: number | null }[]>();
  rates.forEach((rate, index) => {
    const to = rate.to_day ?? null;
    const earlier = seen.get(rate.charge) ?? [];
    for (const previous of earlier) {
      if (rangesOverlap(previous.from, previous.to, rate.from_day, to)) {
        overlaps.push({
          index,
          message: `${rate.charge} ${formatSpan(previous.from, previous.to)} overlaps ${rate.charge} ${formatSpan(rate.from_day, to)}`,
        });
      }
    }
    earlier.push({ index, from: rate.from_day, to });
    seen.set(rate.charge, earlier);
  });
  return overlaps;
}

type ContractOverlap = {
  termIndex: number;
  rateIndex: number;
  message: string;
};

function crossContractOverlaps(terms: readonly ContractTerm[]): ContractOverlap[] {
  const overlaps: ContractOverlap[] = [];
  for (let later = 1; later < terms.length; later += 1) {
    const right = terms[later];
    if (right === undefined) continue;
    for (let earlier = 0; earlier < later; earlier += 1) {
      const left = terms[earlier];
      if (left === undefined) continue;
      if (left.billing_party !== right.billing_party) continue;
      if (left.valid_from > right.valid_to || right.valid_from > left.valid_to) continue;
      for (const overlap of tierOverlaps([...left.rates, ...right.rates])) {
        if (overlap.index < left.rates.length) continue;
        overlaps.push({
          termIndex: later,
          rateIndex: overlap.index - left.rates.length,
          message: `${overlap.message} in contract_terms.${earlier}`,
        });
      }
    }
  }
  return overlaps;
}

function rangesOverlap(leftFrom: number, leftTo: number | null, rightFrom: number, rightTo: number | null): boolean {
  const leftEndsBeforeRight = leftTo !== null && leftTo < rightFrom;
  const rightEndsBeforeLeft = rightTo !== null && rightTo < leftFrom;
  return !leftEndsBeforeRight && !rightEndsBeforeLeft;
}

function formatSpan(from: number, to: number | null): string {
  return to === null ? `${from}-` : `${from}-${to}`;
}
