// pricing.ts — static per-model USD rates for computing agent usage cost.
//
// Rates snapshot: 2026-07-06, from Anthropic's published pricing
// (platform.claude.com/docs/en/about-claude/pricing, anthropic.com/pricing).
// Modern Claude Code writes no costUSD field to transcripts (removed ~v1.0.9),
// so cost must be computed from token counts; no network fetch at poll time —
// same offline posture ccusage/ccost take.
//
// Cache-write approximation: transcript usage deltas carry no TTL breakdown,
// so ALL cache-creation tokens are priced at the standard 5-minute cache-write
// rate (1.25x base input; the 1-hour rate would be 2x). Cache reads are 0.1x
// base input. These multipliers are Anthropic's documented caching pricing.
//
// claude-sonnet-5 uses the introductory rate ($2/$10) in effect through
// 2026-08-31; standard pricing from 2026-09-01 is $3 in / $15 out.
//
// 2026-08-15: added claude-opus-5 (the current Opus model, rates sourced from
// the claude-api skill reference — $5 in / $25 out). It was missing entirely,
// which silently priced every claude-opus-5 agent's usage at cost 0 (the
// unknown-model fallback in usage-store.ts) despite recording real tokens.

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-fable-5':   { inputPerMTok: 10,   outputPerMTok: 50, cacheWritePerMTok: 12.5,  cacheReadPerMTok: 1 },
  'claude-mythos-5':  { inputPerMTok: 10,   outputPerMTok: 50, cacheWritePerMTok: 12.5,  cacheReadPerMTok: 1 },
  'claude-opus-5':    { inputPerMTok: 5,    outputPerMTok: 25, cacheWritePerMTok: 6.25,  cacheReadPerMTok: 0.5 },
  'claude-opus-4-8':  { inputPerMTok: 5,    outputPerMTok: 25, cacheWritePerMTok: 6.25,  cacheReadPerMTok: 0.5 },
  'claude-opus-4-7':  { inputPerMTok: 5,    outputPerMTok: 25, cacheWritePerMTok: 6.25,  cacheReadPerMTok: 0.5 },
  'claude-opus-4-6':  { inputPerMTok: 5,    outputPerMTok: 25, cacheWritePerMTok: 6.25,  cacheReadPerMTok: 0.5 },
  'claude-opus-4-5':  { inputPerMTok: 5,    outputPerMTok: 25, cacheWritePerMTok: 6.25,  cacheReadPerMTok: 0.5 },
  'claude-opus-4-1':  { inputPerMTok: 15,   outputPerMTok: 75, cacheWritePerMTok: 18.75, cacheReadPerMTok: 1.5 },
  'claude-sonnet-5':  { inputPerMTok: 2,    outputPerMTok: 10, cacheWritePerMTok: 2.5,   cacheReadPerMTok: 0.2 },
  'claude-sonnet-4':  { inputPerMTok: 3,    outputPerMTok: 15, cacheWritePerMTok: 3.75,  cacheReadPerMTok: 0.3 },
  'claude-haiku-4-5': { inputPerMTok: 1,    outputPerMTok: 5,  cacheWritePerMTok: 1.25,  cacheReadPerMTok: 0.1 },
  'claude-haiku-3-5': { inputPerMTok: 0.8,  outputPerMTok: 4,  cacheWritePerMTok: 1,     cacheReadPerMTok: 0.08 },
};

/**
 * Longest-prefix match against MODEL_PRICING keys — transcript model ids may
 * carry date/version suffixes (e.g. claude-haiku-4-5-20251001).
 */
export function resolvePricing(model: string): ModelPricing | null {
  let best: { key: string; pricing: ModelPricing } | null = null;
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key) && (best === null || key.length > best.key.length)) best = { key, pricing };
  }
  return best?.pricing ?? null;
}

/** USD cost for a token bundle, or null when the model has no pricing entry. */
export function computeCostUsd(
  model: string,
  t: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number },
): number | null {
  const p = resolvePricing(model);
  if (!p) return null;
  return (
    t.inputTokens * p.inputPerMTok +
    t.outputTokens * p.outputPerMTok +
    t.cacheCreationTokens * p.cacheWritePerMTok +
    t.cacheReadTokens * p.cacheReadPerMTok
  ) / 1_000_000;
}
