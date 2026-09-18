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
//
//  PHASE 5.1A hardening (diagnostic & data-availability fix):
//    • Binary detection retries instead of caching a negative result
//      forever (a single transient miss must not permanently disable
//      analytics until restart).
//    • Windows launcher `py -3` probed as a third candidate.
//    • The engine's exit-2 INVALID_INPUT verdict maps to its own
//      DATA_CONTRACT_ERROR reason (spec §17.9) — a contract problem
//      is NEVER reported as PYTHON_UNAVAILABLE.
//    • Optional safe structural diagnostics via
//      PYTHON_ANALYTICS_DEBUG=1 (counters only — never content).
//
//  PHASE 5.2 — remote analytics runtime (spec §13):
//    Two transport modes behind the SAME outcome contract:
//      PYTHON_ANALYTICS_MODE=local  → subprocess (unchanged path)
//      PYTHON_ANALYTICS_MODE=remote → HTTPS call to the Python
//        analytics service (PYTHON_ANALYTICS_URL) authenticated
//        server-to-server with PYTHON_ANALYTICS_API_KEY (Bearer).
//    The browser never sees the key and never talks to the service.
//    Remote mapping (spec §10/§11/§23):
//      network unreachable (after ONE short retry) → PYTHON_UNAVAILABLE
//      abort/timeout                              → TIMEOUT
//      HTTP 400 (service rejected dataset)         → DATA_CONTRACT_ERROR
//      HTTP 401/403 (credentials)                  → SERVICE_AUTH_ERROR
//      other HTTP / crash                          → SERVICE_ERROR
//      200 with a body failing schema validation   → INVALID_OUTPUT
//    Output validation (spec §9) is DEEP and shared by both modes:
//      status, analytics blocks, evidence references, confidence
//      values are all checked — an invalid result is ANALYTICS_ERROR
//      material, never a silent pass, never "unavailable".
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
const ENV_MODE = 'PYTHON_ANALYTICS_MODE';             // 'local' (default) | 'remote'
const ENV_REMOTE_URL = 'PYTHON_ANALYTICS_URL';        // remote service base URL
const ENV_REMOTE_KEY = 'PYTHON_ANALYTICS_API_KEY';    // shared secret (server-side only)
const ENV_BIN = 'PYTHON_ANALYTICS_BIN';               // absolute python path
const ENV_SCRIPT = 'PYTHON_ANALYTICS_SCRIPT';         // engine script path
const ENV_TIMEOUT_MS = 'PYTHON_ANALYTICS_TIMEOUT_MS'; // default 20000
const ENV_CACHE_TTL_MS = 'PYTHON_ANALYTICS_CACHE_TTL_MS'; // default 600000, 0=off
const ENV_CACHE_MAX = 'PYTHON_ANALYTICS_CACHE_MAX';   // default 64 entries
const ENV_DEBUG = 'PYTHON_ANALYTICS_DEBUG';           // '1' = structural diagnostics

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_CACHE_MAX = 64;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

// Remote service endpoint (spec §5) — appended to PYTHON_ANALYTICS_URL.
const REMOTE_ANALYZE_PATH = '/analyze/employee-performance';
// Spec §23: ONE short retry for TRANSIENT CONNECTION failures only.
// Never retried: timeouts, malformed requests, auth rejections, 4xx.
const REMOTE_RETRY_DELAY_MS = 300;

// Phase 5.1A: candidates carry their own argument prefix. `py` is the
// standard Windows launcher — machines commonly have `py -3` while
// `python3` does not exist and `python` may be the Store alias stub.
const PYTHON_CANDIDATES: ReadonlyArray<{ bin: string; prefix: string[] }> = [
  { bin: 'python3', prefix: [] },
  { bin: 'python', prefix: [] },
  { bin: 'py', prefix: ['-3'] },
];

// A failed auto-detection is retried after this window instead of
// being cached for the process lifetime (Phase 5.1A root cause: a
// single transient miss — cold start, PATH race, slow disk — used to
// permanently brick analytics until restart).
const DETECTION_RETRY_MS = 30_000;

export type PythonAnalyticsFailureReason =
  | 'DISABLED'
  | 'PYTHON_UNAVAILABLE'
  | 'SCRIPT_MISSING'
  | 'DATA_CONTRACT_ERROR'
  | 'TIMEOUT'
  | 'SCRIPT_ERROR'
  | 'INVALID_OUTPUT'
  // Phase 5.2 — remote transport failures (the service itself answered,
  // so this is NEVER an availability problem):
  | 'SERVICE_ERROR'
  | 'SERVICE_AUTH_ERROR';

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
  lastFailedDetectionAt = null;
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

interface ResolvedPythonBinary {
  bin: string;
  prefix: string[];
}

let resolvedAutoBinary: ResolvedPythonBinary | null | undefined;
let lastFailedDetectionAt: number | null = null;

async function detectPythonBinary(): Promise<ResolvedPythonBinary | null> {
  const { spawnSync } = await loadCp();
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      const probe = spawnSync(
        candidate.bin,
        [...candidate.prefix, '-I', '-X', 'utf8', '-c', 'pass'],
        {
          timeout: 5_000,
          encoding: 'utf8',
          windowsHide: true, // no console flash on Windows
        },
      );
      if (!probe.error && probe.status === 0) {
        return { bin: candidate.bin, prefix: candidate.prefix };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function resolvePythonBinary(): Promise<ResolvedPythonBinary | null> {
  const configured = process.env[ENV_BIN];
  if (configured && configured.trim() !== '') {
    return { bin: configured.trim(), prefix: [] };
  }
  // Positive result cached for the process lifetime.
  if (resolvedAutoBinary) return resolvedAutoBinary;
  // Negative result: skip re-probing only inside the retry window.
  if (
    resolvedAutoBinary === null &&
    lastFailedDetectionAt !== null &&
    Date.now() - lastFailedDetectionAt < DETECTION_RETRY_MS
  ) {
    return null;
  }
  const detected = await detectPythonBinary();
  resolvedAutoBinary = detected;
  lastFailedDetectionAt = detected === null ? Date.now() : null;
  return detected;
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

/**
 * Phase 5.2 (spec §13): transport mode. 'local' (default) keeps the
 * Phase 5 subprocess behavior untouched; 'remote' sends the verified
 * dataset over HTTPS to the Python analytics service. Both modes
 * produce the EXACT same outcome contract.
 */
function analyticsMode(): 'local' | 'remote' {
  const raw = (process.env[ENV_MODE] ?? '').trim().toLowerCase();
  return raw === 'remote' ? 'remote' : 'local';
}

function normalizeRemoteUrl(raw: string | undefined): string | null {
  const value = (raw ?? '').trim().replace(/\/+$/, '');
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return value;
  } catch {
    return null;
  }
}

// ── Output validation (spec §9) ───────────────────────────────
// DEEP validation shared by BOTH transports: an incoming result
// (subprocess stdout OR remote HTTP body) must carry the expected
// status, analytics blocks, evidence references and confidence
// values. An invalid result is INVALID_OUTPUT (→ ANALYTICS_ERROR) —
// never silently accepted, never reported as unavailability.

const CONFIDENCE_VALUES: ReadonlySet<string> = new Set([
  'HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_DATA',
]);

function isConfidence(value: unknown): boolean {
  return typeof value === 'string' && CONFIDENCE_VALUES.has(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidEvidenceRefArray(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((ref) =>
    isPlainObject(ref) &&
    typeof ref.collection === 'string' &&
    Array.isArray(ref.recordIds) &&
    ref.recordIds.every((id) => typeof id === 'string') &&
    typeof ref.completeRecordList === 'boolean',
  );
}

function isValidAnalyticsResult(value: unknown): value is EmployeeAnalyticsResult {
  if (!isPlainObject(value)) return false;
  const v = value as Record<string, unknown>;
  if (
    v.schemaVersion !== ANALYTICS_SCHEMA_VERSION ||
    v.analyticsKind !== ANALYTICS_KIND ||
    v.status !== 'OK' ||
    v.deterministic !== true
  ) {
    return false;
  }
  // Engine version identifier (Phase 5.2 spec §26) — must be present
  // so production results can be attributed to an engine build.
  if (typeof v.analyticsEngineVersion !== 'string' || v.analyticsEngineVersion.length === 0) {
    return false;
  }
  // Top-level analytics blocks (spec §9 "expected fields").
  for (const block of [
    'input', 'kpiFactsEcho', 'trendAnalysis', 'patternAnalysis',
    'distributionAnalysis', 'periodComparison', 'dataQuality',
  ]) {
    if (!isPlainObject(v[block])) return false;
  }
  // Trend must carry an explicit analytical status.
  const trend = v.trendAnalysis as Record<string, unknown>;
  if (trend.status !== 'OK' && trend.status !== 'INSUFFICIENT_DATA') return false;
  // patternAnalysis + distributionAnalysis sub-blocks.
  const pattern = v.patternAnalysis as Record<string, unknown>;
  for (const block of ['observations', 'repeatedIssues', 'deductions']) {
    if (!isPlainObject(pattern[block])) return false;
  }
  const dist = v.distributionAnalysis as Record<string, unknown>;
  for (const block of ['complaints', 'capa', 'followUps', 'deals', 'attendance']) {
    if (!isPlainObject(dist[block])) return false;
  }
  // Array-valued analytics blocks.
  for (const arr of ['anomalies', 'crossDomainPatterns', 'correlations', 'noteCodes']) {
    if (!Array.isArray(v[arr])) return false;
  }
  // Data quality gap list.
  const dq = v.dataQuality as Record<string, unknown>;
  if (!Array.isArray(dq.insufficientSamples)) return false;
  // Confidence values must be from the contract enum.
  if (!isConfidence(v.overallConfidence)) return false;
  const trendConfidence = (v.trendAnalysis as Record<string, unknown>).confidence;
  if (trendConfidence !== undefined && !isConfidence(trendConfidence)) return false;
  // Evidence references (spec §9 "evidence references").
  if (!isValidEvidenceRefArray(v.evidenceReferences)) return false;
  return true;
}

// ── Safe structural diagnostics (Phase 5.1A, spec §2) ─────────
// Enabled with PYTHON_ANALYTICS_DEBUG=1. Logs STRUCTURAL counters
// only — employeeId, period, kind, schema, record counts, and
// availability flags. NEVER logs payload content, tokens, secrets
// or customer data. Logging failures are swallowed.

function debugEnabled(): boolean {
  return (process.env[ENV_DEBUG] ?? '').trim() === '1';
}

function debugLog(event: string, fields: Record<string, unknown>): void {
  if (!debugEnabled()) return;
  try {
    console.info(`[python-analytics] ${event} ${JSON.stringify(fields)}`);
  } catch {
    /* logging must never break the app */
  }
}

function datasetStructuralSummary(dataset: EmployeePerformanceDataset): Record<string, unknown> {
  return {
    employeeId: dataset?.employee?.employeeId ?? null,
    monthKey: dataset?.period?.monthKey ?? null,
    datasetKind: dataset?.datasetKind ?? null,
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    counts: {
      observations: dataset?.quality?.observations?.total ?? 0,
      deductions: dataset?.quality?.deductions?.count ?? 0,
      complaints: dataset?.complaints?.total ?? 0,
      capa: dataset?.capa?.total ?? 0,
      followUps: dataset?.followUps?.total ?? 0,
      deals: dataset?.deals?.total ?? 0,
    },
    attendanceAvailable: dataset?.attendance?.status === 'AVAILABLE',
    kpiStatus: dataset?.kpi?.overallStatus ?? null,
    valueBasis: dataset?.period?.valueBasis ?? null,
  };
}

async function runPythonOnce(
  binary: ResolvedPythonBinary,
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
      // -X utf8: force UTF-8 stdio even under -I (which ignores the
      // PYTHONUTF8 env var). Without it a piped Windows interpreter
      // defaults to the legacy ANSI codepage and Arabic labels arrive
      // as mojibake — the exact §8/§9 parity divergence this bridge
      // must never produce.
      child = spawn(binary.bin, [...binary.prefix, '-I', '-X', 'utf8', scriptPath], {
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
      // ENOENT and every other spawn error (EACCES, EPERM, …) mean the
      // runtime itself could not start — genuine PYTHON_UNAVAILABLE
      // territory (spec §6).
      settle({ ok: false, reason: 'PYTHON_UNAVAILABLE', detail: error.message });
    });

    child.on('close', (code) => {
      if (truncated) {
        settle({ ok: false, reason: 'INVALID_OUTPUT', detail: 'output exceeded size cap' });
        return;
      }
      if (code !== 0) {
        // The engine exits 2 with a JSON INVALID_INPUT body when the
        // DATASET fails its input contract — a data-contract problem,
        // NOT a Python availability problem and NOT a generic script
        // error (spec §6/§17.9: the three states stay distinct).
        try {
          const verdict = JSON.parse(stdout) as {
            status?: string;
            error?: { code?: string; message?: string };
          };
          if (verdict && verdict.status === 'INVALID_INPUT') {
            settle({
              ok: false,
              reason: 'DATA_CONTRACT_ERROR',
              detail: `engine rejected dataset: ${verdict.error?.code ?? 'UNKNOWN'} — ${verdict.error?.message ?? 'no detail'}`,
            });
            return;
          }
        } catch {
          /* not JSON — fall through to generic script error */
        }
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

// ── Remote transport (Phase 5.2, spec §13/§11/§23) ────────────

 type RemoteAttemptOutcome =
  | { kind: 'ok'; json: unknown }
  | { kind: 'timeout' }
  | { kind: 'network'; message: string }
  | { kind: 'http'; status: number; bodyText: string }
  | { kind: 'parse'; message: string };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function extractErrorCode(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { code?: string; message?: string };
    };
    if (parsed && typeof parsed === 'object' && parsed.error) {
      return parsed.error.code ?? parsed.error.message ?? 'UNKNOWN';
    }
  } catch {
    /* fall through */
  }
  return bodyText ? bodyText.slice(0, 120) : 'UNKNOWN';
}

/** One HTTP attempt against the analytics service. */
async function remoteAttemptOnce(
  url: string,
  apiKey: string,
  payload: string,
): Promise<RemoteAttemptOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), resolveTimeoutMs());
  try {
    // Server-to-server call (spec §7): the caller of THIS module has
    // already authenticated the human user; this request carries only
    // the shared service secret — never user identity, never cookies.
    const response = await fetch(`${url}${REMOTE_ANALYZE_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: payload,
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await response.text();
    if (response.status === 200) {
      try {
        return { kind: 'ok', json: JSON.parse(text) as unknown };
      } catch (error) {
        return {
          kind: 'parse',
          message: error instanceof Error ? error.message : 'unparseable response body',
        };
      }
    }
    return { kind: 'http', status: response.status, bodyText: text.slice(0, 500) };
  } catch (error) {
    if (isAbortError(error)) return { kind: 'timeout' };
    return {
      kind: 'network',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function mapRemoteOutcome(outcome: RemoteAttemptOutcome): PythonAnalyticsOutcome {
  switch (outcome.kind) {
    case 'ok':
      if (isValidAnalyticsResult(outcome.json)) {
        return { ok: true, result: outcome.json, cached: false };
      }
      return {
        ok: false,
        reason: 'INVALID_OUTPUT',
        detail: 'remote result failed schema validation (spec §9)',
      };
    case 'timeout':
      return {
        ok: false,
        reason: 'TIMEOUT',
        detail: `remote service exceeded ${resolveTimeoutMs()}ms`,
      };
    case 'parse':
      return { ok: false, reason: 'INVALID_OUTPUT', detail: outcome.message };
    case 'network':
      return {
        ok: false,
        reason: 'PYTHON_UNAVAILABLE',
        detail: `remote analytics service unreachable: ${outcome.message}`,
      };
    case 'http':
      if (outcome.status === 400) {
        // The service rejected the DATASET (spec §8) — a contract
        // problem, never an availability problem.
        return {
          ok: false,
          reason: 'DATA_CONTRACT_ERROR',
          detail: `remote service rejected dataset: ${extractErrorCode(outcome.bodyText)}`,
        };
      }
      if (outcome.status === 401 || outcome.status === 403) {
        return {
          ok: false,
          reason: 'SERVICE_AUTH_ERROR',
          detail: `remote analytics service rejected credentials (HTTP ${outcome.status})`,
        };
      }
      if (outcome.status === 429) {
        return {
          ok: false,
          reason: 'SERVICE_ERROR',
          detail: 'remote analytics service rate-limited the request (HTTP 429)',
        };
      }
      return {
        ok: false,
        reason: 'SERVICE_ERROR',
        detail: `remote analytics service returned HTTP ${outcome.status}`,
      };
  }
}

/**
 * Remote mode: HTTPS call to the Python analytics service with ONE
 * short retry for transient connection failures only (spec §23).
 * Timeouts, auth rejections, malformed requests and 4xx/5xx verdicts
 * are NEVER retried.
 */
async function runRemoteAnalytics(payload: string): Promise<PythonAnalyticsOutcome> {
  const url = normalizeRemoteUrl(process.env[ENV_REMOTE_URL]);
  if (!url) {
    return {
      ok: false,
      reason: 'PYTHON_UNAVAILABLE',
      detail: `${ENV_REMOTE_URL} is not configured (mode=remote)`,
    };
  }
  const apiKey = (process.env[ENV_REMOTE_KEY] ?? '').trim();
  if (!apiKey) {
    return {
      ok: false,
      reason: 'PYTHON_UNAVAILABLE',
      detail: `${ENV_REMOTE_KEY} is not configured (mode=remote)`,
    };
  }

  let lastNetwork: RemoteAttemptOutcome | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) await delay(REMOTE_RETRY_DELAY_MS);
    const outcome = await remoteAttemptOnce(url, apiKey, payload);
    if (outcome.kind !== 'network') return mapRemoteOutcome(outcome);
    lastNetwork = outcome;
  }
  return mapRemoteOutcome(lastNetwork as RemoteAttemptOutcome);
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
    debugLog('disabled', { reason: 'DISABLED' });
    return { ok: false, reason: 'DISABLED', detail: `${ENV_ENABLED} is disabled` };
  }

  let payload: string;
  try {
    payload = JSON.stringify({
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      dataset,
    });
  } catch (error) {
    debugLog('payload-serialization-failed', {
      error: error instanceof Error ? error.message : String(error),
    });
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
    debugLog('cache-hit', datasetStructuralSummary(dataset));
    return cached.ok ? { ...cached, cached: true } : cached;
  }

  // Phase 5.2: mode dispatch — both transports share the payload,
  // the cache, the deep output validation and the outcome contract.
  if (analyticsMode() === 'remote') {
    const host = (() => {
      try {
        return new URL((process.env[ENV_REMOTE_URL] ?? '').trim()).host;
      } catch {
        return null;
      }
    })();
    debugLog('remote-dispatch', {
      ...datasetStructuralSummary(dataset),
      serviceHost: host,
    });
    const remoteOutcome = await runRemoteAnalytics(payload);
    debugLog(remoteOutcome.ok ? 'remote-result' : 'remote-failure', remoteOutcome.ok
      ? { overallConfidence: remoteOutcome.result.overallConfidence }
      : { reason: remoteOutcome.reason, detail: remoteOutcome.detail ?? null });
    cacheSet(cacheKey, remoteOutcome);
    return remoteOutcome;
  }

  const binary = await resolvePythonBinary();
  if (!binary) {
    debugLog('runtime-missing', datasetStructuralSummary(dataset));
    return {
      ok: false,
      reason: 'PYTHON_UNAVAILABLE',
      detail: 'no Python interpreter found (set PYTHON_ANALYTICS_BIN)',
    };
  }

  const scriptPath = resolveScriptPath();
  const fsModule = await loadFs();
  if (!fsModule.existsSync(scriptPath)) {
    debugLog('script-missing', {
      ...datasetStructuralSummary(dataset),
      scriptPath,
    });
    return {
      ok: false,
      reason: 'SCRIPT_MISSING',
      detail: `engine script not found at ${scriptPath}`,
    };
  }

  debugLog('dataset-received', {
    ...datasetStructuralSummary(dataset),
    binary: binary.bin,
    payloadBytes: Buffer.byteLength(payload, 'utf8'),
  });
  const outcome = await runPythonOnce(binary, scriptPath, payload);
  debugLog(outcome.ok ? 'engine-result' : 'engine-failure', outcome.ok
    ? { overallConfidence: outcome.result.overallConfidence }
    : { reason: outcome.reason, detail: outcome.detail ?? null });
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
    // Reason-specific messages (Phase 5.1A): the operator must see
    // WHICH unavailability this is instead of one ambiguous sentence.
    const message =
      outcome.reason === 'DISABLED'
        ? 'التحليل الإحصائي معطّل بالإعدادات (PYTHON_ANALYTICS_ENABLED) — باقي التقرير يعمل بشكل طبيعي'
        : outcome.reason === 'SCRIPT_MISSING'
          ? 'ملف محرك التحليل الإحصائي غير موجود على هذا الخادم — باقي التقرير يعمل بشكل طبيعي'
          : 'خدمة التحليل الإحصائي غير قابلة للوصول حالياً — باقي التقرير يعمل بشكل طبيعي';
    return {
      status: 'ANALYTICS_UNAVAILABLE',
      reason: outcome.reason,
      message,
    };
  }
  if (outcome.reason === 'TIMEOUT') {
    // Distinct state (Phase 5.2 spec §10/§11): a timeout is neither an
    // unavailability nor a generic error — the report still renders.
    return {
      status: 'ANALYTICS_TIMEOUT',
      reason: 'TIMEOUT',
      message: 'انتهت مهلة تنفيذ التحليل الإحصائي — باقي التقرير يعمل بشكل طبيعي',
    };
  }
  if (outcome.reason === 'DATA_CONTRACT_ERROR') {
    // Contract rejection is an ERROR (Python ran), never an
    // unavailability (spec §6).
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
