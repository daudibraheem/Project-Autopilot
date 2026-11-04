/**
 * USD per 1M tokens. Configurable: set AUTOPILOT_PRICES_JSON='{"model-id":{"input":1,"output":5}}'.
 * Anthropic prices from the Claude API model table (2026-10). OpenAI prices: verify against provider docs.
 */
export interface Price {
  input: number;
  output: number;
}

export const DEFAULT_PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-fable-5-1": { input: 10, output: 50 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
};

const FALLBACK: Price = { input: 3, output: 15 };

export function priceTable(): Record<string, Price> {
  const raw = process.env.AUTOPILOT_PRICES_JSON;
  if (!raw) return DEFAULT_PRICES;
  try {
    return { ...DEFAULT_PRICES, ...(JSON.parse(raw) as Record<string, Price>) };
  } catch {
    return DEFAULT_PRICES;
  }
}

export function estimateUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceTable()[model] ?? FALLBACK;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** Rough token estimate (chars / 4) used by the mock provider. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
