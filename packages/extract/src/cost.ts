import { Decimal } from "decimal.js";

/** Token counts from one or more calls for a single page. */
export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_5m_tokens: number;
  cache_1h_tokens: number;
  cache_read_tokens: number;
};

/**
 * Sonnet 5.5 list prices times 1.1 for US inference.
 * Input $2.20, output $11, 5-minute cache write $2.75, 1-hour cache write $4.40, cache read $0.11, per million tokens.
 */
const PER_MILLION = {
  input: "2.2",
  output: "11",
  cache5m: "2.75",
  cache1h: "4.4",
  cacheRead: "0.11",
} as const;

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

/** Dollar cost as a decimal string. A JavaScript float is not used. */
export function costUsd(usage: Usage): string {
  const total = part(usage.input_tokens, PER_MILLION.input)
    .plus(part(usage.output_tokens, PER_MILLION.output))
    .plus(part(usage.cache_5m_tokens, PER_MILLION.cache5m))
    .plus(part(usage.cache_1h_tokens, PER_MILLION.cache1h))
    .plus(part(usage.cache_read_tokens, PER_MILLION.cacheRead));
  const fixed = total.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  return fixed === "" ? "0" : fixed;
}

function part(tokens: number, perMillion: string): Decimal {
  return new Decimal(String(tokens)).mul(perMillion).div("1000000");
}
