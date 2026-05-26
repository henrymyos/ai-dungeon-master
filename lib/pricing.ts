// Claude Haiku 4.5 pricing (USD per million tokens).
// https://www.anthropic.com/pricing
export const PRICING = {
  inputPerMillion: 1.0,
  outputPerMillion: 5.0,
  cacheReadPerMillion: 0.1,
  cacheCreationPerMillion: 1.25,
} as const;

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
};

export function costFor(u: Usage): number {
  return (
    (u.input_tokens * PRICING.inputPerMillion +
      u.output_tokens * PRICING.outputPerMillion +
      u.cache_read_tokens * PRICING.cacheReadPerMillion +
      u.cache_creation_tokens * PRICING.cacheCreationPerMillion) /
    1_000_000
  );
}

export function formatCost(usd: number): string {
  if (usd < 0.001) return "<$0.001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
