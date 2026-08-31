// ══════════════════════════════════════════════════════════════
//  Analytics service (Phase 5.3) — the production analytics entry.
//
//  Replaces the retired Python bridge as the analytics path:
//    {schemaVersion, dataset} → validate → TypeScript engine →
//    validated EmployeeAnalyticsResult — entirely IN-PROCESS.
//
//  FAILURE ISOLATION (unchanged doctrine): this module NEVER throws
//  and NEVER lets an analytics problem propagate. Login, Quality
//  Notes, Audit Log, KPI Reports, Month Close and the Smart Quality
//  Report do NOT depend on it in any way.
//
//  NO PYTHON, NO SUBPROCESS, NO REMOTE SERVICE, NO NEW DATA SOURCE:
//  the only input is the already-verified Performance Intelligence
//  dataset the caller (API route) loaded after authorization.
//
//  CACHE (same semantics as the Phase 5 cache): key = SHA-256 of the
//  exact payload (employeeId + period + full dataset content) → any
//  source-data change produces a new key, so stale analytics can
//  never be served. Only successful results are cached; failures are
//  never cached, so a retry after fixing the data succeeds.
// ══════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import {
  ANALYTICS_SCHEMA_VERSION,
  type AnalyticsApiResponse,
  type EmployeeAnalyticsResult,
} from './types';
import { buildEmployeeAnalyticsResult, validateAnalyticsEnvelope } from './engine';
import { isValidAnalyticsResult } from './validate-result';

// ── Cache bounds (fixed constants — no operator knobs required) ──
const CACHE_TTL_MS = 10 * 60_000; // belt-and-braces for fast-moving MTD data
const CACHE_MAX_ENTRIES = 64;

export type AnalyticsFailureReason =
  | 'DATA_CONTRACT_ERROR'  // dataset failed its input contract (engine never ran)
  | 'ENGINE_ERROR';        // engine executed but failed (caught internal error)

export type AnalyticsServiceOutcome =
  | { ok: true; result: EmployeeAnalyticsResult; cached: boolean }
  | { ok: false; reason: AnalyticsFailureReason; detail?: string };

interface CacheEntry {
  at: number;
  outcome: AnalyticsServiceOutcome;
}

const analyticsCache = new Map<string, CacheEntry>();

/** @internal test hook — clears the module cache between tests. */
export function _resetAnalyticsCacheForTests(): void {
  analyticsCache.clear();
}

/** @internal test hook — current cache entry count. */
export function _analyticsCacheSizeForTests(): number {
  return analyticsCache.size;
}

function cacheGet(key: string): AnalyticsServiceOutcome | null {
  const entry = analyticsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    analyticsCache.delete(key);
    return null;
  }
  // LRU refresh — reinsert to move to the back of eviction order.
  analyticsCache.delete(key);
  analyticsCache.set(key, entry);
  return entry.outcome;
}

function cacheSet(key: string, outcome: AnalyticsServiceOutcome): void {
  // Only successful results are cached (see docblock above).
  if (!outcome.ok) return;
  analyticsCache.set(key, { at: Date.now(), outcome });
  while (analyticsCache.size > CACHE_MAX_ENTRIES) {
    const oldest = analyticsCache.keys().next().value;
    if (oldest === undefined) break;
    analyticsCache.delete(oldest);
  }
}

/**
 * Run deterministic TypeScript analytics over an authorized
 * Performance Intelligence dataset. Never throws; failures come back
 * as structured outcomes so the calling route can degrade gracefully
 * while the rest of the application continues.
 */
export async function runEmployeeAnalytics(
  dataset: EmployeePerformanceDataset,
): Promise<AnalyticsServiceOutcome> {
  // Serialize the envelope — the cache key covers employeeId + period
  // + the ENTIRE dataset content; any source change yields a new key.
  let payload: string;
  try {
    payload = JSON.stringify({
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      dataset,
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'ENGINE_ERROR',
      detail: `payload serialization failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const cacheKey = createHash('sha256').update(payload).digest('hex');
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached.ok ? { ...cached, cached: true } : cached;
  }

  const outcome = executeAnalytics(payload);
  cacheSet(cacheKey, outcome);
  return outcome;
}

/** Synchronous core (kept separate so the cache wraps the full path). */
function executeAnalytics(payload: string): AnalyticsServiceOutcome {
  let envelope: unknown;
  try {
    envelope = JSON.parse(payload);
  } catch {
    // The payload was produced by JSON.stringify above — unreachable,
    // but fail closed with the contract error, never a crash.
    return { ok: false, reason: 'ENGINE_ERROR', detail: 'unreachable: payload re-parse failed' };
  }

  // Fail-closed input contract (same codes as the reference engine).
  const validated = validateAnalyticsEnvelope(envelope);
  if (!validated.ok) {
    return {
      ok: false,
      reason: 'DATA_CONTRACT_ERROR',
      detail: `dataset rejected: ${validated.error.code} — ${validated.error.message}`,
    };
  }

  try {
    const result = buildEmployeeAnalyticsResult(validated.dataset);
    // Self-check (Phase 5 §9 doctrine): an invalid result is an
    // ERROR — never silently accepted, never "unavailable".
    if (!isValidAnalyticsResult(result)) {
      return {
        ok: false,
        reason: 'ENGINE_ERROR',
        detail: 'engine result failed schema self-validation',
      };
    }
    return { ok: true, result, cached: false };
  } catch (error) {
    return {
      ok: false,
      reason: 'ENGINE_ERROR',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Map a service outcome to the client-facing API response body.
 * UNAVAILABLE/ERROR are returned with HTTP 200 on purpose: they are
 * explicit, non-fatal analytics states — not page failures (the
 * Smart Quality Report keeps working).
 *
 * Phase 5.3: UNAVAILABLE/TIMEOUT states remain part of the response
 * CONTRACT for UI compatibility, but the in-process engine can no
 * longer produce them — there is no runtime to be unavailable.
 */
export function analyticsApiResponseBody(
  outcome: AnalyticsServiceOutcome,
): AnalyticsApiResponse {
  if (outcome.ok) {
    return { status: 'OK', analytics: outcome.result };
  }
  if (outcome.reason === 'DATA_CONTRACT_ERROR') {
    // Contract rejection — the dataset did not match the analytics
    // input contract. Logged server-side; never a page failure.
    return {
      status: 'ANALYTICS_ERROR',
      reason: outcome.reason,
      message: 'بيانات الفترة لم تطابق عقد التحليل الإحصائي — تم تسجيل التفاصيل في سجل الخادم — باقي التقرير يعمل بشكل طبيعي',
    };
  }
  return {
    status: 'ANALYTICS_ERROR',
    reason: outcome.reason,
    message: 'تعذر إتمام التحليل الإحصائي — باقي التقرير يعمل بشكل طبيعي',
  };
}
