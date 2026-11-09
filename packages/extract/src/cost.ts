import { Decimal } from "decimal.js";

/** Token counts from one or more calls for a single page. */
export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_5m_tokens: number;
  cache_1h_tokens: number;
  cache_read_tokens: number;
};

type Rates = {
  input: string;
  output: string;
  cache5m: string;
  cache1h: string;
  cacheRead: string;
};

/**
 * List price per million tokens, already including the 1.1 US-inference multiplier.
 * Sonnet 5.5: input $2.20, output $11, 5-minute cache write $2.75, 1-hour cache write $4.40, cache read $0.11.
 * A model that is not listed has no price. Nothing here is a stand-in for another model.
 */
const PRICES: Record<string, Rates> = {
  "claude-sonnet-5-5": {
    input: "2.2",
    output: "11",
    cache5m: "2.75",
    cache1h: "4.4",
    cacheRead: "0.11",
  },
};

export type Priced = {
  cost_usd: string | null;
  cost_note?: string;
};

export function emptyUsage(): Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_5m_tokens: 0,
    cache_1h_tokens: 0,
    cache_read_tokens: 0,
  };
}

export function addUsage(left: Usage, right: Usage): Usage {
  return {
    input_tokens: left.input_tokens + right.input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
    cache_5m_tokens: left.cache_5m_tokens + right.cache_5m_tokens,
    cache_1h_tokens: left.cache_1h_tokens + right.cache_1h_tokens,
    cache_read_tokens: left.cache_read_tokens + right.cache_read_tokens,
  };
}

/** Dollar cost for a known model, or null and a note when this model has no price. */
export function priceUsage(model: string, usage: Usage): Priced {
  const rates = PRICES[model];
  if (rates === undefined) return { cost_usd: null, cost_note: `No price for ${model}.` };
  return { cost_usd: formatCost(rates, usage) };
}

function formatCost(rates: Rates, usage: Usage): string {
  const total = part(usage.input_tokens, rates.input)
    .plus(part(usage.output_tokens, rates.output))
    .plus(part(usage.cache_5m_tokens, rates.cache5m))
    .plus(part(usage.cache_1h_tokens, rates.cache1h))
    .plus(part(usage.cache_read_tokens, rates.cacheRead));
  const fixed = total.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  return fixed === "" ? "0" : fixed;
}

function part(tokens: number, perMillion: string): Decimal {
  return new Decimal(String(tokens)).mul(perMillion).div("1000000");
}
