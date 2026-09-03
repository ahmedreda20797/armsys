// ══════════════════════════════════════════════════════════════
//  AI Gateway — per-user rate limiting (Phase 6.4, spec §23)
//
//  Extends the Phase 6.2 quality-AI protection into the GENERAL
//  gateway mechanism:
//    • per user  +  per feature (quality-analysis, chat, …)
//    • sliding window, server-side, in-memory (Vercel-compatible —
//      the same documented per-instance limitation as §26 cache)
//    • provider-aware defaults: conservative limits suitable for
//      free-tier quotas; one user must not exhaust the quota for
//      everyone (§23/§28)
//
//  The existing checkQualityAIRateLimit() keeps its exact behavior
//  (§37 — existing tests keep passing); new AI features call THIS
//  module. Do not let one user exhaust a free provider quota.
// ══════════════════════════════════════════════════════════════

export interface AIRateLimitRule {
  windowMs: number;
  maxPerWindow: number;
}

/** Conservative defaults per feature (free-tier friendly, §28). */
const DEFAULT_RULES: Record<string, AIRateLimitRule> = {
  'quality-analysis': { windowMs: 60_000, maxPerWindow: 6 },
  chat: { windowMs: 60_000, maxPerWindow: 10 },
  memory: { windowMs: 60_000, maxPerWindow: 20 },
  health: { windowMs: 60_000, maxPerWindow: 10 },
};

const FALLBACK_RULE: AIRateLimitRule = { windowMs: 60_000, maxPerWindow: 6 };

const windows = new Map<string, number[]>();

export function getAIRateLimitRule(feature: string): AIRateLimitRule {
  return DEFAULT_RULES[feature] ?? FALLBACK_RULE;
}

/** Sliding-window check. Returns true when the call is allowed
 *  (and records it), false when the user hit the limit. */
export function checkAIRateLimit(userId: string, feature: string, now: number = Date.now()): boolean {
  const rule = getAIRateLimitRule(feature);
  const key = `${feature}:${userId}`;
  const window = (windows.get(key) ?? []).filter((t) => now - t < rule.windowMs);
  if (window.length >= rule.maxPerWindow) {
    windows.set(key, window);
    return false;
  }
  window.push(now);
  windows.set(key, window);
  return true;
}

/** Seconds until the user may retry (rounded up) — for Retry-After hints. */
export function retryAfterSeconds(userId: string, feature: string, now: number = Date.now()): number {
  const rule = getAIRateLimitRule(feature);
  const window = (windows.get(`${feature}:${userId}`) ?? []).filter((t) => now - t < rule.windowMs);
  if (window.length === 0) return 0;
  const oldest = Math.min(...window);
  return Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000));
}

/** Test helper. */
export function clearAIRateLimitsForTests(): void {
  windows.clear();
}
