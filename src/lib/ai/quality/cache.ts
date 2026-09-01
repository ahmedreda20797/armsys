// ══════════════════════════════════════════════════════════════
//  Quality AI — result cache + rate protection (Phase 6.2, §26/§34)
//
//  CACHE (§26): in-process LRU keyed by
//    sha256(employeeId + period + window + payload-content-hash +
//           analyticsVersion + promptVersion + provider + model)
//  so a changed dataset can NEVER be served a stale AI result.
//  FAILURES ARE NEVER CACHED AS SUCCESS — only validated OK results
//  enter the cache.
//  Limitation (documented): per-serverless-instance — acceptable for
//  an on-demand, low-frequency, user-triggered analysis.
//
//  RATE PROTECTION (§34): per-user sliding window (in-memory) —
//  prevents accidental request storms; NOT a billing system.
// ══════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import type { QualityAIAnalysisResult } from './contracts';

// ── cache ───────────────────────────────────────────────────────

const CACHE_MAX_ENTRIES = 32;
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  result: QualityAIAnalysisResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function qualityAICacheKey(parts: {
  employeeId: string;
  month: string;
  windowMonths: number;
  minOccurrences: number;
  payload: unknown;
  analyticsEngineVersion: string;
  promptVersion: string;
  provider: string;
  model: string;
}): string {
  const payloadHash = createHash('sha256')
    .update(JSON.stringify(parts.payload))
    .digest('hex');
  return createHash('sha256')
    .update(JSON.stringify({
      employeeId: parts.employeeId,
      month: parts.month,
      windowMonths: parts.windowMonths,
      minOccurrences: parts.minOccurrences,
      payloadHash,
      analyticsEngineVersion: parts.analyticsEngineVersion,
      promptVersion: parts.promptVersion,
      provider: parts.provider,
      model: parts.model,
    }))
    .digest('hex');
}

export function getCachedQualityAI(key: string): QualityAIAnalysisResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  // LRU refresh.
  cache.delete(key);
  cache.set(key, entry);
  return entry.result;
}

export function setCachedQualityAI(key: string, result: QualityAIAnalysisResult): void {
  cache.delete(key);
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Test helper — clears the whole cache. */
export function clearQualityAICacheForTests(): void {
  cache.clear();
}

// ── per-user rate protection (§34) ──────────────────────────────

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 6;

const rateWindows = new Map<string, number[]>();

export function checkQualityAIRateLimit(userId: string): boolean {
  const now = Date.now();
  const window = (rateWindows.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (window.length >= RATE_MAX_PER_WINDOW) {
    rateWindows.set(userId, window);
    return false;
  }
  window.push(now);
  rateWindows.set(userId, window);
  return true;
}

/** Test helper. */
export function clearQualityAIRateLimitForTests(): void {
  rateWindows.clear();
}
