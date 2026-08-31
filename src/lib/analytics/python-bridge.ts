// ══════════════════════════════════════════════════════════════
//  Python Analytics Bridge (Phase 5)
//
//  The ONLY place where the Next.js server invokes the Python
//  analytics engine. Architecture (spec §26): a Python SUBPROCESS
//  fed over stdin and read from stdout — the portable boundary
//  that works identically in local dev, Docker (python3 installed
//  in the runner image) and degrades gracefully everywhere else.
//
//  FAILURE ISOLATION (spec §28): this module NEVER throws and
//  NEVER lets a Python problem propagate. Login, Quality Notes,
//  Audit Log, KPI Reports, Month Close and the Smart Quality
//  Report do NOT depend on it in any way.
//
//  READ-ONLY (spec §4): the payload leaves through stdin, the
//  result comes back through stdout. Nothing is written to any
//  store by this module or by the engine.
//
//  SECURITY (spec §30): callers authorize FIRST and pass an
//  already-authorized dataset. The dataset travels via stdin
//  (never argv — invisible in process lists). The engine runs in
//  isolated mode (-I: no user site-packages, ignores PYTHONPATH).
// ══════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import path from 'node:path';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import {
  ANALYTICS_KIND,
  ANALYTICS_SCHEMA_VERSION,
  type AnalyticsApiResponse,
  type EmployeeAnalyticsResult,
} from './types';

// ── Environment knobs (all optional, safe defaults) ───────────
const ENV_ENABLED = 'PYTHON_ANALYTICS_ENABLED';       // '0'/'false' disables
const ENV_BIN = 'PYTHON_ANALYTICS_BIN';               // absolute python path
const ENV_SCRIPT = 'PYTHON_ANALYTICS_SCRIPT';         // engine script path
const ENV_TIMEOUT_MS = 'PYTHON_ANALYTICS_TIMEOUT_MS'; // default 20000
const ENV_CACHE_TTL_MS = 'PYTHON_ANALYTICS_CACHE_TTL_MS'; // default 600000, 0=off
const ENV_CACHE_MAX = 'PYTHON_ANALYTICS_CACHE_MAX';   // default 64 entries

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_CACHE_MAX = 64;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const PYTHON_CANDIDATES = ['python3', 'python'] as const;

export type PythonAnalyticsFailureReason =
  | 'DISABLED'
  | 'PYTHON_UNAVAILABLE'
  | 'SCRIPT_MISSING'
  | 'TIMEOUT'
  | 'SCRIPT_ERROR'
  | 'INVALID_OUTPUT';

export type PythonAnalyticsOutcome =
  | { ok: true; result: EmployeeAnalyticsResult; cached: boolean }
  | { ok: false; reason: PythonAnalyticsFailureReason; detail?: string };

// ── Cache (spec §29) ──────────────────────────────────────────
// Key = SHA-256 of the exact payload (employeeId + period + full
// dataset content) → any source-data change produces a new key,
// so stale analytics can never be served. TTL is belt-and-braces
// for fast-moving MTD data. Failures are NEVER cached, so a
// later retry (e.g. after installing Python) succeeds.

interface CacheEntry {
  at: number;
  outcome: PythonAnalyticsOutcome;
}

const analyticsCache = new Map<string, CacheEntry>();

/** @internal test hook — clears the module cache between tests. */
export function _resetPythonAnalyticsCacheForTests(): void {
  analyticsCache.clear();
  resolvedAutoBinary = undefined;
}

/** @internal test hook — current cache entry count. */
export function _pythonAnalyticsCacheSizeForTests(): number {
  return analyticsCache.size;
}

function cacheTtlMs(): number {
  const raw = Number(process.env[ENV_CACHE_TTL_MS]);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_CACHE_TTL_MS;
}

function cacheMaxEntries(): number {
  const raw = Number(process.env[ENV_CACHE_MAX]);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_CACHE_MAX;
}

function cacheGet(key: string): PythonAnalyticsOutcome | null {
  const ttl = cacheTtlMs();
  const entry = analyticsCache.get(key);
  if (!entry) return null;
  if (ttl === 0 || Date.now() - entry.at > ttl) {
    analyticsCache.delete(key);
    return null;
  }
  // LRU refresh — reinsert to move to the back of eviction order.
  analyticsCache.delete(key);
  analyticsCache.set(key, entry);
  return entry.outcome;
}

function cacheSet(key: string, outcome: PythonAnalyticsOutcome): void {
  // Only successful results are cached (see docblock above).
  if (!outcome.ok) return;
  analyticsCache.set(key, { at: Date.now(), outcome });
  while (analyticsCache.size > cacheMaxEntries()) {
    const oldest = analyticsCache.keys().next().value;
    if (oldest === undefined) break;
    analyticsCache.delete(oldest);
  }
}

// ── Node runtime modules (build-trace safe) ──────────────────
// node:fs / node:child_process are resolved at RUNTIME through a
// turbopack-ignored dynamic import. Static imports here make the
// build-time file tracer follow this module's process/filesystem
// boundary and pull the ENTIRE project into the standalone output
// (NFT warning + image bloat). The ignored dynamic import keeps
// the trace scoped while runtime behavior is identical.
type FsModule = typeof import('node:fs');
type CpModule = typeof import('node:child_process');

let fsModulePromise: Promise<FsModule> | null = null;
let cpModulePromise: Promise<CpModule> | null = null;

async function loadFs(): Promise<FsModule> {
  if (!fsModulePromise) {
    fsModulePromise = import(/* turbopackIgnore: true */ 'node:fs') as Promise<FsModule>;
  }
  return fsModulePromise;
}

async function loadCp(): Promise<CpModule> {
  if (!cpModulePromise) {
    cpModulePromise = import(/* turbopackIgnore: true */ 'node:child_process') as Promise<CpModule>;
  }
  return cpModulePromise;
}

// ── Python binary resolution ──────────────────────────────────
// The auto-detected binary is cached for the process lifetime;
// an explicitly configured PYTHON_ANALYTICS_BIN is always honored
// immediately (no cache) so operators can fix/override at runtime.

let resolvedAutoBinary: string | null | undefined;

async function detectPythonBinary(): Promise<string | null> {
  const { spawnSync } = await loadCp();
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      const probe = spawnSync(candidate, ['-I', '-c', 'pass'], {
        timeout: 5_000,
        encoding: 'utf8',
      });
      if (!probe.error && probe.status === 0) return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function resolvePythonBinary(): Promise<string | null> {
  const configured = process.env[ENV_BIN];
  if (configured && configured.trim() !== '') {
    return configured.trim();
  }
  if (resolvedAutoBinary === undefined) {
    resolvedAutoBinary = await detectPythonBinary();
  }
  return resolvedAutoBinary;
}

function resolveScriptPath(): string {
  const configured = process.env[ENV_SCRIPT];
  if (configured && configured.trim() !== '') return configured.trim();
  // Statically scoped to a literal subfolder (Node File Tracing safe).
  return path.join(process.cwd(), 'python-analytics', 'employee_analytics.py');
}

// ── Node File Tracing (NFT) note ──────────────────────────────
// (Historical) a direct fs.existsSync(<env-derived value>) made the
// build-time tracer pull the whole project into the standalone output.
// fs is now resolved through the ignored dynamic import above, which
// keeps the trace scoped in every case.

function resolveTimeoutMs(): number {
  const raw = Number(process.env[ENV_TIMEOUT_MS]);
  return Number.isFinite(raw) && raw >= 1_000 ? raw : DEFAULT_TIMEOUT_MS;
}

function analyticsEnabled(): boolean {
  const raw = (process.env[ENV_ENABLED] ?? '').trim().toLowerCase();
  return raw !== '0' && raw !== 'false';
}

// ── Output validation ─────────────────────────────────────────

function isValidAnalyticsResult(value: unknown): value is EmployeeAnalyticsResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === ANALYTICS_SCHEMA_VERSION &&
    v.analyticsKind === ANALYTICS_KIND &&
    v.status === 'OK' &&
    typeof (v as { trendAnalysis?: unknown }).trendAnalysis === 'object' &&
    typeof (v as { dataQuality?: unknown }).dataQuality === 'object'
  );
}

// ── Subprocess execution ──────────────────────────────────────

async function runPythonOnce(
  binary: string,
  scriptPath: string,
  payload: string,
): Promise<PythonAnalyticsOutcome> {
  const { spawn } = await loadCp();
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: PythonAnalyticsOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    let child;
    try {
      // -I: isolated mode — ignore PYTHONPATH/user site-packages.
      child = spawn(binary, ['-I', scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      settle({
        ok: false,
        reason: 'PYTHON_UNAVAILABLE',
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            if (!child.killed) child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }, 1_000);
      } catch {
        /* already gone */
      }
      settle({ ok: false, reason: 'TIMEOUT', detail: `exceeded ${resolveTimeoutMs()}ms` });
    }, resolveTimeoutMs());

    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let truncated = false;

    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        truncated = true;
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        return;
      }
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      // Keep only a short tail — never echo the payload.
      stderr = (stderr + chunk.toString('utf8')).slice(-2_000);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        settle({ ok: false, reason: 'PYTHON_UNAVAILABLE', detail: error.message });
      } else {
        settle({ ok: false, reason: 'PYTHON_UNAVAILABLE', detail: error.message });
      }
    });

    child.on('close', (code) => {
      if (truncated) {
        settle({ ok: false, reason: 'INVALID_OUTPUT', detail: 'output exceeded size cap' });
        return;
      }
      if (code !== 0) {
        settle({
          ok: false,
          reason: 'SCRIPT_ERROR',
          detail: `exit code ${code}${stderr ? `: ${stderr.trim().slice(-500)}` : ''}`,
        });
        return;
      }
      try {
        const parsed: unknown = JSON.parse(stdout);
        if (!isValidAnalyticsResult(parsed)) {
          settle({
            ok: false,
            reason: 'INVALID_OUTPUT',
            detail: 'result failed schema validation',
          });
          return;
        }
        settle({ ok: true, result: parsed, cached: false });
      } catch (error) {
        settle({
          ok: false,
          reason: 'INVALID_OUTPUT',
          detail: error instanceof Error ? error.message : 'unparseable stdout',
        });
      }
    });

    // Payload travels over stdin — never argv (spec §30).
    child.stdin.on('error', () => {
      /* EPIPE if the child dies early — close handler settles */
    });
    child.stdin.end(payload, 'utf8');
  });
}

// ── Public API ────────────────────────────────────────────────

/**
 * Run deterministic Python analytics over an authorized
 * Performance Intelligence dataset. Never throws; failures come
 * back as structured outcomes so the calling route can degrade
 * gracefully while the rest of the application continues.
 */
export async function runPythonAnalytics(
  dataset: EmployeePerformanceDataset,
): Promise<PythonAnalyticsOutcome> {
  if (!analyticsEnabled()) {
    return { ok: false, reason: 'DISABLED', detail: `${ENV_ENABLED} is disabled` };
  }

  let payload: string;
  try {
    payload = JSON.stringify({
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      dataset,
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'SCRIPT_ERROR',
      detail: `payload serialization failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Cache key covers employeeId + period + the ENTIRE dataset content
  // (spec §29) — any source change yields a new key.
  const cacheKey = createHash('sha256').update(payload).digest('hex');
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached.ok ? { ...cached, cached: true } : cached;
  }

  const binary = await resolvePythonBinary();
  if (!binary) {
    return {
      ok: false,
      reason: 'PYTHON_UNAVAILABLE',
      detail: 'no Python interpreter found (set PYTHON_ANALYTICS_BIN)',
    };
  }

  const scriptPath = resolveScriptPath();
  const fsModule = await loadFs();
  if (!fsModule.existsSync(scriptPath)) {
    return {
      ok: false,
      reason: 'SCRIPT_MISSING',
      detail: `engine script not found at ${scriptPath}`,
    };
  }

  const outcome = await runPythonOnce(binary, scriptPath, payload);
  cacheSet(cacheKey, outcome);
  return outcome;
}

/**
 * Map a bridge outcome to the client-facing API response body.
 * UNAVAILABLE/ERROR are returned with HTTP 200 on purpose: they
 * are explicit, non-fatal analytics states — not page failures
 * (spec §27/§28 — the Smart Quality Report keeps working).
 */
export function analyticsApiResponseBody(
  outcome: PythonAnalyticsOutcome,
): AnalyticsApiResponse {
  if (outcome.ok) {
    return { status: 'OK', analytics: outcome.result };
  }
  if (
    outcome.reason === 'DISABLED' ||
    outcome.reason === 'PYTHON_UNAVAILABLE' ||
    outcome.reason === 'SCRIPT_MISSING'
  ) {
    return {
      status: 'ANALYTICS_UNAVAILABLE',
      reason: outcome.reason,
      message: 'التحليل الإحصائي غير متاح على هذه البيئة — باقي التقرير يعمل بشكل طبيعي',
    };
  }
  return {
    status: 'ANALYTICS_ERROR',
    reason: outcome.reason,
    message: 'تعذر إتمام التحليل الإحصائي — باقي التقرير يعمل بشكل طبيعي',
  };
}
