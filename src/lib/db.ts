// §SERVER-ONLY BOUNDARY — the RTDB data layer reaches the Firebase
// ADMIN SDK (via ./firebase-server). Never import from client code.
import 'server-only';
import { createId } from '@paralleldrive/cuid2';
import { getAdminDb } from './firebase-server';
// §ORG-LABELS — the PURE canonical label resolver (lib/organization
// is Firebase-free) + the graph index builder. db.ts performs the
// orgNodes read itself through its OWN cached getAll, so NO import
// cycle exists (lib/reports/employee-org is db-bound and stays out
// of this module's graph).
import { buildEmployeeOrgIndex, resolveEmployeeOrgLabels } from '@/lib/organization/labels';
// firebase-admin v14: get/set/update/remove are methods on Reference objects, not standalone exports

// ═══════════════════════════════════════════════════
//  Firebase RTDB Database Layer
// ═══════════════════════════════════════════════════

function rtdbRef(path: string) {
  return getAdminDb().ref(path);
}

// ═══════════════════════════════════════════════════
//  In-Memory Cache with TTL (Optimized)
// ═══════════════════════════════════════════════════

const cache = new Map<string, { data: any; timestamp: number; ttl: number }>();

// TTL tiers — rarely-changing data gets longer cache life
const TTL = {
  DEFAULT: 5_000,       // 5s — frequently changing data (attendance, requests)
  MEDIUM: 15_000,      // 15s — moderate change rate (employees, quality)
  LONG: 30_000,        // 30s — rarely changing (rules, biometrics)
  STATIC: 60_000,      // 60s — almost never changes (deduction rules)
  /**
   * §DOWNLOAD-OPT — polling-driven reads (notification list/stats,
   * unseen summary). Safe to hold for 30s because EVERY write path to
   * these tables goes through this module's create/update/delete
   * helpers, which invalidateCache(table) immediately — a new or
   * mutated record is visible on the very next read after the write.
   * The long window lets a fleet of pollers share ONE full-table
   * download instead of re-downloading per poll.
   */
  POLL: 30_000,
} as const;

// ═══════════════════════════════════════════════════════════════
//  §SINGLE-FLIGHT — in-flight request deduplication (NOT a cache)
//
//  Concurrent identical READS of the same table/row share ONE pending
//  RTDB operation instead of each paying their own round-trip (a
//  thundering-herd of N identical `getAll` calls on a cold cache used
//  to issue N parallel full-table downloads).
//
//  Scope and limits (deliberate, documented):
//    • Same SERVER INSTANCE only — it deduplicates concurrent callers
//      inside one Node process. It is NOT distributed deduplication:
//      separate Vercel instances still read independently.
//    • In-flight ONLY: the entry is removed the moment the operation
//      settles (resolve OR reject), so rejected operations free their
//      slot immediately and the next caller retries fresh. Completed
//      promises never linger here — persistence is the TTL cache's
//      job (§TTL policy below, unchanged).
//    • Keys include EVERY parameter that affects the result: table +
//      the effective TTL for getAll/getAllBatch (the TTL selects the
//      cache lifetime the winner will store), table + id for getById.
//      No user identity/scope parameter exists at this layer — every
//      caller of `getAll(table)` receives the same table rows, so
//      there is no cross-user surface to leak through.
//    • Result sharing matches the EXISTING cache contract: the cached
//      path already hands every caller the same array reference. The
//      flight winner's result flows into that same cache; dedup adds
//      no new mutable-sharing surface beyond it.
// ═══════════════════════════════════════════════════════════════

const inflightReads = new Map<string, Promise<unknown>>();

/**
 * Run `run()` under single-flight semantics for `key`: concurrent
 * callers join the pending operation; the registry entry is removed
 * as soon as it settles (success or failure).
 */
function singleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const pending = inflightReads.get(key);
  if (pending) return pending as Promise<T>;
  // .finally (not .then/.catch) — cleanup runs on BOTH outcomes and
  // the derived promise preserves the original resolve/reject value.
  const flight = run().finally(() => {
    inflightReads.delete(key);
  });
  inflightReads.set(key, flight);
  return flight;
}

/** Pending single-flight read count (diagnostics/monitoring). */
export function getInFlightReadCount(): number {
  return inflightReads.size;
}

function getCached(table: string): any[] | null {
  const entry = cache.get(table);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) {
    cache.delete(table);
    return null;
  }
  return entry.data;
}

function setCache(table: string, data: any[], ttl: number = TTL.DEFAULT): void {
  cache.set(table, { data, timestamp: Date.now(), ttl });
}

/** Invalidate cache for a specific table (call after writes) */
export function invalidateCache(table?: string): void {
  if (table) {
    cache.delete(table);
    // §INDEXED-QUERY — indexed-result entries for this table are keyed
    // `idx:<table>:<field>:<value>`; clear them too so a write is
    // visible to indexed readers on the very next read (the same
    // immediate-visibility guarantee the table cache has always had).
    const prefix = `idx:${table}:`;
    for (const key of Array.from(cache.keys())) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
  } else {
    cache.clear();
  }
}

/** Get current cache stats (for debugging/monitoring) */
export function getCacheStats(): { size: number; tables: string[] } {
  return {
    size: cache.size,
    tables: Array.from(cache.keys()),
  };
}

/** Shared snapshot → rows projection (getAll and getAllBatch stay identical). */
function parseSnapshotRows(data: Record<string, any>): any[] {
  return Object.entries(data).map(
    ([id, val]) => ({ id, ...(val as Record<string, any>) })
  );
}

export async function getAll<T = Record<string, any>>(table: string, ttl?: number): Promise<T[]> {
  const cached = getCached(table);
  if (cached) return cached as T[];

  // §SINGLE-FLIGHT — concurrent cold reads of the same table (+ same
  // TTL intent) share one RTDB download; the winner populates the TTL
  // cache exactly as before.
  return singleFlight(`all:${table}:${ttl ?? 'default'}`, async () => {
    const snapshot = await rtdbRef(`arm_erp/${table}`).get();
    if (!snapshot.exists()) return [];
    const result = parseSnapshotRows(snapshot.val()) as T[];
    setCache(table, result, ttl);
    return result;
  }) as Promise<T[]>;
}

/** Get multiple tables in a single parallel batch — avoids N separate sequential reads.
 *  `ttl` (optional) overrides the per-table cache lifetime for every table in the
 *  batch; defaults to TTL.DEFAULT exactly as before (backward compatible).
 *  Per-table reads flow through the §SINGLE-FLIGHT registry, so a batch
 *  table and a concurrent `getAll` of the SAME table (same TTL) share
 *  one download instead of duplicating it. */
export async function getAllBatch(tables: string[], ttl?: number): Promise<Map<string, any[]>> {
  const result = new Map<string, any[]>();
  const flights: Array<{ table: string; promise: Promise<any[]> }> = [];

  for (const table of tables) {
    const cached = getCached(table);
    if (cached) {
      result.set(table, cached);
    } else {
      flights.push({
        table,
        promise: singleFlight(`all:${table}:${ttl ?? 'default'}`, async () => {
          const snapshot = await rtdbRef(`arm_erp/${table}`).get();
          if (!snapshot.exists()) return [];
          const parsed = parseSnapshotRows(snapshot.val());
          setCache(table, parsed, ttl);
          return parsed;
        }),
      });
    }
  }

  // Same failure semantics as the previous Promise.all: the FIRST
  // table read that rejects rejects the whole batch.
  const settled = await Promise.all(flights.map((f) => f.promise));
  for (let i = 0; i < flights.length; i++) {
    result.set(flights[i]!.table, settled[i]!);
  }

  return result;
}

export async function getById<T = Record<string, any>>(table: string, id: string): Promise<T | null> {
  // §SINGLE-FLIGHT — concurrent identical point reads share one
  // round-trip. No TTL cache here (unchanged): each flight lives only
  // while the read is pending, so freshness is untouched.
  return singleFlight(`byId:${table}:${id}`, async () => {
    const snapshot = await rtdbRef(`arm_erp/${table}/${id}`).get();
    if (!snapshot.exists()) return null;
    return { id, ...(snapshot.val() as Record<string, any>) } as unknown as T;
  }) as Promise<T | null>;
}

/**
 * Lightweight connectivity probe for the public health endpoint (M0.1):
 * reads AT MOST ONE record from a small table — no full-table scan and
 * no row data is returned or exposed to unauthenticated callers.
 */
export async function pingDatabase(): Promise<void> {
  const snapshot = await getAdminDb().ref('arm_erp/deductionRules').limitToFirst(1).get();
  void snapshot; // connectivity itself is the signal; contents are irrelevant
}

export async function findWhere<T = Record<string, any>>(table: string, filters: Record<string, any>): Promise<T[]> {
  const all = await getAll<any>(table);
  return all.filter((r) => Object.entries(filters).every(([key, value]) => r[key] === value)) as T[];
}

export async function findWhereContains<T = Record<string, any>>(table: string, field: string, substring: string): Promise<T[]> {
  const all = await getAll<any>(table);
  return all.filter((r) => typeof r[field] === 'string' && r[field].includes(substring)) as T[];
}

export async function findWhereIn<T = Record<string, any>>(table: string, field: string, values: any[]): Promise<T[]> {
  const all = await getAll<any>(table);
  const valueSet = new Set(values.map((v) => String(v)));
  return all.filter((r) => valueSet.has(String(r[field]))) as T[];
}

export async function findFirst<T = Record<string, any>>(table: string, filters: Record<string, any>): Promise<T | null> {
  const results = await findWhere<T>(table, filters);
  return results.length > 0 ? results[0] : null;
}

// ─── Targeted user lookup for authentication ────────────────────────
// Tries the fast indexed query first, but ANY failure — missing index,
// timeout, or a hung RTDB connection — falls back to the legacy
// full-table scan, which is the path proven to work in this environment
// (empirically: plain .get() completes in ~17s cold, while an
// orderByChild().equalTo() query can hang indefinitely on this network).
// The indexed attempt is therefore hard-capped so the fallback always
// has time to run inside the route's 45s budget.
//
// CIRCUIT BREAKER (auth reliability): when the indexed query TIMES OUT
// (the hang signature, distinct from a fast "index not defined" error),
// repeated logins would each burn the full timeout before the fallback.
// After INDEX_BREAKER_THRESHOLD consecutive timeouts the indexed attempt
// is skipped for INDEX_BREAKER_COOLDOWN_MS and the scan serves login
// immediately. The breaker resets on the first indexed success, so a
// repaired index/network is picked up automatically.
//
// Deliberately bypasses the table cache: freshness matters more than
// latency for a credential check (suspension, role changes), and
// caching one row here would poison the whole-table cache.
const USER_QUERY_TIMEOUT_MS = 10_000;
const INDEX_BREAKER_THRESHOLD = 2;
const INDEX_BREAKER_COOLDOWN_MS = 5 * 60_000;
let userEmailFallbackWarningShown = false;
let indexedTimeoutStreak = 0;
let indexedBreakerOpenUntil = 0;

/** Internal-only diagnostic classes for the user lookup (never user-facing). */
export type UserLookupFailureKind = 'timeout' | 'error' | 'none';

export interface UserLookupDiagnostic {
  path: 'indexed' | 'scan' | 'scan-breaker-open';
  failure: UserLookupFailureKind;
  durationMs: number;
}

let lastUserLookupDiagnostic: UserLookupDiagnostic | null = null;

/** The classification of the most recent findUserByEmail call (for the login route's diagnostics). */
export function getLastUserLookupDiagnostic(): UserLookupDiagnostic | null {
  return lastUserLookupDiagnostic;
}

/**
 * Test hook — resets the indexed-query circuit breaker, the timeout
 * streak and the last diagnostic between test cases (the breaker state
 * is module-level by design; production code must never call this).
 */
export function resetUserLookupBreakerForTests(): void {
  indexedTimeoutStreak = 0;
  indexedBreakerOpenUntil = 0;
  lastUserLookupDiagnostic = null;
}

function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => {
          const err = new Error(`[db] RTDB query exceeded ${timeoutMs}ms (hung connection)`);
          (err as any).kind = 'timeout';
          reject(err);
        },
        timeoutMs
      )
    ),
  ]);
}

async function indexedUserLookup(
  normalizedEmail: string,
  queryTimeoutMs: number
): Promise<{ user: Record<string, any> | null; failure: UserLookupFailureKind }> {
  const snapshot = await raceWithTimeout(
    rtdbRef('arm_erp/users')
      .orderByChild('email')
      .equalTo(normalizedEmail)
      .limitToFirst(2)
      .get(),
    queryTimeoutMs
  );

  if (!snapshot.exists()) return { user: null, failure: 'none' };
  const data = snapshot.val() as Record<string, Record<string, any>>;
  const [id, val] = Object.entries(data)[0];
  return { user: { id, ...(val as Record<string, any>) }, failure: 'none' };
}

export async function findUserByEmail<T = Record<string, any>>(
  email: string,
  options?: { queryTimeoutMs?: number }
): Promise<T | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const queryTimeoutMs = options?.queryTimeoutMs ?? USER_QUERY_TIMEOUT_MS;
  const t0 = performance.now();

  // Breaker open → the indexed path already proved it hangs recently;
  // serve from the scan without re-paying the timeout.
  if (Date.now() < indexedBreakerOpenUntil) {
    const results = await findWhere<T>('users', { email: normalizedEmail });
    lastUserLookupDiagnostic = {
      path: 'scan-breaker-open',
      failure: 'none',
      durationMs: Math.round(performance.now() - t0),
    };
    return results.length > 0 ? results[0] : null;
  }

  try {
    const { user, failure } = await indexedUserLookup(normalizedEmail, queryTimeoutMs);
    indexedTimeoutStreak = 0;
    lastUserLookupDiagnostic = {
      path: 'indexed',
      failure,
      durationMs: Math.round(performance.now() - t0),
    };
    return (user as T) ?? null;
  } catch (err: any) {
    const kind: UserLookupFailureKind = err?.kind === 'timeout' ? 'timeout' : 'error';
    if (kind === 'timeout') {
      indexedTimeoutStreak += 1;
      if (indexedTimeoutStreak >= INDEX_BREAKER_THRESHOLD) {
        indexedBreakerOpenUntil = Date.now() + INDEX_BREAKER_COOLDOWN_MS;
      }
    }

    // Indexed lookup unavailable (missing index, hung connection, or any
    // network failure) — the scan below is what actually serves login.
    if (!userEmailFallbackWarningShown || kind === 'timeout') {
      userEmailFallbackWarningShown = true;
      const reason = String(err?.message ?? err).slice(0, 140);
      console.warn(
        `[db] findUserByEmail: indexed lookup failed (${kind}: ${reason}) — ` +
        'falling back to the full users-table scan. Login still works.' +
        (kind === 'timeout' && indexedBreakerOpenUntil > Date.now()
          ? ' Indexed path temporarily disabled (breaker open) — subsequent logins skip the hung query.'
          : '') +
        '\nFaster fix: Firebase Console → Realtime Database → Rules → add\n' +
        '  "users": { ".indexOn": ["email"] }\n' +
        'If queries keep hanging after that, check network/proxy access to the RTDB host.'
      );
    }
    const results = await findWhere<T>('users', { email: normalizedEmail });
    lastUserLookupDiagnostic = {
      path: 'scan',
      failure: kind === 'timeout' ? 'none' : kind, // the scan itself succeeded — the failure was the indexed attempt
      durationMs: Math.round(performance.now() - t0),
    };
    return results.length > 0 ? results[0] : null;
  }
}

// ─── §INDEXED-QUERY — guarded per-value child queries (Phase 2) ─────
// The same doctrine as the login lookup above, generalized: an
// indexed `orderByChild(field).equalTo(value)` fetch is attempted
// FIRST (bounded by a hard timeout), and ANY failure — missing index,
// timeout, or network error — falls back to the proven full-table
// read + in-memory filter, which produces the EXACT legacy result.
// The fallback is therefore the correctness baseline: an indexed
// result is adopted only when RTDB itself computed the same
// predicate (child value equality), so the two paths are
// row-for-row interchangeable by construction.
//
// WHY THE PREDICATES ARE EQUIVALENT: RTDB `equalTo(value)` matches a
// record iff its child value equals the query value under RTDB
// comparison; records WITHOUT the child never match an orderByChild
// query at all. The legacy in-memory filter is a strict `===` on the
// same field — for the string id/month fields queried here the two
// predicates select exactly the same rows (missing/undefined/null
// child values match neither).
//
// ORDERING PARITY: a full-node read returns children in key order;
// an `equalTo` query returns its matches in child-value order with
// ties (identical value) in key order — for a single queried value
// every returned row is a tie, so the row sequence is the same key
// order the legacy scan saw. "Last row wins" consumers keep their
// semantics.
//
// CACHING: results are cached under `idx:<table>:<field>:<value>`
// with the caller's TTL tier and invalidated together with the table
// (invalidateCache) — a write is visible to indexed readers on the
// very next read, the same guarantee the table cache has. The cache
// stores exactly the rows the legacy scan would return (same layer,
// same shared-visibility contract as the whole-table cache — the
// authorization filtering still happens downstream at the caller).
//
// CIRCUIT BREAKER (per `${table}.${field}` target): TIMEOUTS — the
// observed hang signature — count toward the streak; a fast error
// ("index not defined", network reset) does not. After
// INDEXED_QUERY_BREAKER_THRESHOLD consecutive timeouts the indexed
// attempt is skipped for INDEXED_QUERY_BREAKER_COOLDOWN_MS and the
// scan serves directly; the first indexed success resets the streak,
// so a repaired index/network is picked up automatically.
//
// DELAYED ORIGINALS: `Promise.race` cannot cancel the losing RTDB
// query (the Admin SDK exposes no cancellation), so the orphan keeps
// running server-side after the fallback started. The orphan is
// explicitly drained — its late resolution is ignored (the fallback
// already served the caller) and its late rejection is swallowed so
// it can never surface as an unhandled rejection. Concurrent
// identical queries share ONE attempt through the §SINGLE-FLIGHT
// registry, so a hung query + fallback cannot duplicate itself per
// caller.
const INDEXED_QUERY_TIMEOUT_MS = USER_QUERY_TIMEOUT_MS;
const INDEXED_QUERY_BREAKER_THRESHOLD = INDEX_BREAKER_THRESHOLD;
const INDEXED_QUERY_BREAKER_COOLDOWN_MS = INDEX_BREAKER_COOLDOWN_MS;

export type IndexedQueryFailureKind = UserLookupFailureKind;

export interface IndexedQueryDiagnostic {
  /** `${table}.${field}` — the breaker/diagnostics target. */
  target: string;
  path: 'indexed' | 'scan' | 'scan-breaker-open';
  failure: IndexedQueryFailureKind;
  durationMs: number;
}

export interface GetAllByChildOptions {
  /** TTL tier for the result cache (same tiers as getAll); default TTL.DEFAULT. */
  ttl?: number;
  /** Hard cap for the indexed attempt (default INDEXED_QUERY_TIMEOUT_MS). */
  queryTimeoutMs?: number;
}

interface IndexedBreakerState {
  timeoutStreak: number;
  openUntil: number;
}

const indexedBreakers = new Map<string, IndexedBreakerState>();
const lastIndexQueryDiagnostics = new Map<string, IndexedQueryDiagnostic>();
const indexedFallbackWarnedTargets = new Set<string>();

/** The most recent diagnostic for a `${table}.${field}` target (ops/debugging). */
export function getLastIndexedQueryDiagnostic(target: string): IndexedQueryDiagnostic | null {
  return lastIndexQueryDiagnostics.get(target) ?? null;
}

/**
 * Test hook — resets the per-target breakers, timeout streaks,
 * diagnostics and the warn-once flags between test cases (state is
 * module-level by design; production code must never call this).
 */
export function resetIndexedQueryStateForTests(): void {
  indexedBreakers.clear();
  lastIndexQueryDiagnostics.clear();
  indexedFallbackWarnedTargets.clear();
}

function breakerFor(target: string): IndexedBreakerState {
  let state = indexedBreakers.get(target);
  if (!state) {
    state = { timeoutStreak: 0, openUntil: 0 };
    indexedBreakers.set(target, state);
  }
  return state;
}

/** Snapshot rows from an indexed query — same id-injection as getAll. */
function parseQueryRows(data: Record<string, any>): any[] {
  return Object.entries(data).map(([id, val]) => ({ id, ...(val as Record<string, any>) }));
}

/**
 * The legacy computation for a child-equality filter: the proven
 * full-table read (TTL-cached, §SINGLE-FLIGHT dedup) + the strict
 * in-memory equality filter the callers ran before Phase 2.
 */
async function legacyChildScan<T>(
  table: string,
  field: string,
  value: string,
  ttl?: number,
): Promise<T[]> {
  const all = await getAll<T>(table, ttl);
  return all.filter((r) => (r as Record<string, any>)?.[field] === value) as T[];
}

/**
 * Race an indexed RTDB query against a hard timeout. The losing
 * original is drained explicitly: RTDB queries cannot be cancelled
 * through the Admin SDK, so a query that loses the race keeps
 * running server-side — its late resolution is irrelevant (the
 * fallback already served the caller) and its late rejection is
 * swallowed so it can never become an unhandled rejection.
 */
function raceIndexedQuery<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`[db] indexed RTDB query exceeded ${timeoutMs}ms (hung connection)`);
      (err as any).kind = 'timeout';
      reject(err);
    }, timeoutMs);
  });
  // Drain the orphan: ignore late results, swallow late failures,
  // and free the timer as soon as the original settles.
  promise.then(
    () => clearTimeout(timer),
    () => clearTimeout(timer),
  );
  return Promise.race([promise, timeoutPromise]);
}

/**
 * Guarded indexed fetch: all rows of `table` whose child `field`
 * equals `value` — the exact rows the legacy full-table scan's
 * `r[field] === value` filter selects, served (when the index is
 * available) by one small RTDB query instead of a whole-table
 * download. Any indexed failure transparently falls back to that
 * scan, so the result is never partial: an indexed success is a
 * complete predicate match, a fallback success IS the legacy
 * computation, and a fallback failure rejects (never a silently
 * empty dataset).
 */
export async function getAllByChildEqualTo<T = Record<string, any>>(
  table: string,
  field: string,
  value: string,
  options?: GetAllByChildOptions,
): Promise<T[]> {
  const ttl = options?.ttl;
  const queryTimeoutMs = options?.queryTimeoutMs ?? INDEXED_QUERY_TIMEOUT_MS;
  const cacheKey = `idx:${table}:${field}:${value}`;
  const target = `${table}.${field}`;

  const cached = getCached(cacheKey);
  if (cached) return cached as T[];

  // §SINGLE-FLIGHT — concurrent identical indexed queries share one
  // attempt (query + fallback), so a hung index cannot fan out into
  // one hanging query + one fallback scan per caller.
  return singleFlight(`idxq:${table}:${field}:${value}`, async () => {
    const t0 = performance.now();
    const breaker = breakerFor(target);
    const finish = (
      path: IndexedQueryDiagnostic['path'],
      failure: IndexedQueryFailureKind,
      rows: T[],
    ): T[] => {
      lastIndexQueryDiagnostics.set(target, {
        target,
        path,
        failure,
        durationMs: Math.round(performance.now() - t0),
      });
      return rows;
    };

    // Breaker open → the indexed query already hung repeatedly for
    // this target; serve from the scan without re-paying the timeout.
    if (Date.now() < breaker.openUntil) {
      const rows = await legacyChildScan<T>(table, field, value, ttl);
      setCache(cacheKey, rows, ttl);
      return finish('scan-breaker-open', 'none', rows);
    }

    try {
      const snapshot = await raceIndexedQuery(
        rtdbRef(`arm_erp/${table}`).orderByChild(field).equalTo(value).get(),
        queryTimeoutMs,
      );
      const rows = snapshot.exists() ? (parseQueryRows(snapshot.val()) as T[]) : [];
      breaker.timeoutStreak = 0;
      setCache(cacheKey, rows, ttl);
      return finish('indexed', 'none', rows);
    } catch (err: any) {
      const kind: IndexedQueryFailureKind = err?.kind === 'timeout' ? 'timeout' : 'error';
      if (kind === 'timeout') {
        breaker.timeoutStreak += 1;
        if (breaker.timeoutStreak >= INDEXED_QUERY_BREAKER_THRESHOLD) {
          breaker.openUntil = Date.now() + INDEXED_QUERY_BREAKER_COOLDOWN_MS;
        }
      }

      if (!indexedFallbackWarnedTargets.has(target) || kind === 'timeout') {
        indexedFallbackWarnedTargets.add(target);
        const reason = String(err?.message ?? err).slice(0, 140);
        console.warn(
          `[db] getAllByChildEqualTo(${target} == ${value}): indexed query failed ` +
          `(${kind}: ${reason}) — falling back to the full-table scan. ` +
          'Results are unaffected; only the read cost changes.' +
          (kind === 'timeout' && breaker.openUntil > Date.now()
            ? ` Indexed path for ${target} temporarily disabled (breaker open).`
            : '')
        );
      }

      // Fallback = the legacy computation. Its failure REJECTS — a
      // broken database must surface, never masquerade as empty data.
      // The diagnostic is recorded BEFORE the rethrow so a total
      // outage is still observable.
      try {
        const rows = await legacyChildScan<T>(table, field, value, ttl);
        setCache(cacheKey, rows, ttl);
        return finish('scan', kind, rows);
      } catch (fallbackErr) {
        lastIndexQueryDiagnostics.set(target, {
          target,
          path: 'scan',
          failure: kind,
          durationMs: Math.round(performance.now() - t0),
        });
        throw fallbackErr;
      }
    }
  }) as Promise<T[]>;
}

export async function createRecord<T = Record<string, any>>(table: string, data: Record<string, any>): Promise<T> {
  const id = createId();
  const now = new Date().toISOString();
  const record = { ...data, id, createdAt: now, updatedAt: now };
  await rtdbRef(`arm_erp/${table}/${id}`).set(record);
  invalidateCache(table);
  return record as unknown as T;
}

export async function createRecordWithId<T = Record<string, any>>(table: string, id: string, data: Record<string, any>): Promise<T> {
  const now = new Date().toISOString();
  const record = { ...data, id, createdAt: now, updatedAt: now };
  await rtdbRef(`arm_erp/${table}/${id}`).set(record);
  invalidateCache(table);
  return record as unknown as T;
}

export async function updateRecord(table: string, id: string, data: Record<string, any>): Promise<Record<string, any> | null> {
  const updates = { ...data, updatedAt: new Date().toISOString() };
  await rtdbRef(`arm_erp/${table}/${id}`).update(updates);
  invalidateCache(table);
  return getById(table, id);
}

/**
 * Bulk patch of MANY records of one table in a SINGLE RTDB multi-path
 * update (one round-trip, one cache invalidation). `updatesById` maps
 * record id → shallow patch merged into that record.
 *
 * §RTDB-PATCH-SEMANTICS — the update map is expanded into PER-FIELD
 * child paths (`id/field`). RTDB update() is shallow PER PATH: a bare
 * `id` path would REPLACE the whole record with the patch object and
 * silently destroy every sibling field (key/name/labels…). The
 * `id/field` form merges into each record and leaves unspecified
 * siblings untouched — the semantics this helper has always promised.
 * The canonical writer for reorders and "mark all notifications read" —
 * never a sequential per-id updateRecord() fan-out.
 */
export async function updateRecords(table: string, updatesById: Record<string, Record<string, any>>): Promise<number> {
  const ids = Object.keys(updatesById);
  if (ids.length === 0) return 0;
  const now = new Date().toISOString();
  const multiPath: Record<string, any> = {};
  for (const id of ids) {
    const patch = { ...updatesById[id], updatedAt: now };
    for (const [field, value] of Object.entries(patch)) {
      multiPath[`${id}/${field}`] = value;
    }
  }
  await rtdbRef(`arm_erp/${table}`).update(multiPath);
  invalidateCache(table);
  return ids.length;
}

export async function deleteRecord(table: string, id: string): Promise<void> {
  await rtdbRef(`arm_erp/${table}/${id}`).remove();
  invalidateCache(table);
}

export async function deleteWhere(table: string, filters: Record<string, any>): Promise<number> {
  const all = await getAll<any>(table);
  const toDelete = all.filter((r) => Object.entries(filters).every(([key, value]) => r[key] === value));
  if (toDelete.length > 0) {
    await Promise.all(toDelete.map((record) => rtdbRef(`arm_erp/${table}/${record.id}`).remove()));
  }
  invalidateCache(table);
  return toDelete.length;
}

export async function deleteByIds(table: string, ids: string[]): Promise<number> {
  await Promise.all(ids.map((id) => rtdbRef(`arm_erp/${table}/${id}`).remove()));
  invalidateCache(table);
  return ids.length;
}

// ═══════════════════════════════════════════════════
//  Optimized Count Functions (use cached data)
// ═══════════════════════════════════════════════════

export async function count(table: string): Promise<number> {
  return (await getAll(table)).length;
}

export async function countWhere(table: string, filters: Record<string, any>): Promise<number> {
  const all = await getAll<any>(table);
  return all.filter((r) => Object.entries(filters).every(([key, value]) => r[key] === value)).length;
}

export async function countWhereIn(table: string, field: string, values: any[]): Promise<number> {
  const all = await getAll<any>(table);
  const valueSet = new Set(values.map((v) => String(v)));
  return all.filter((r) => valueSet.has(String(r[field]))).length;
}

// ═══════════════════════════════════════════════════
//  Efficient countByEmployeeId — single-pass count
//  Returns a Map<employeeId, count> without loading
//  the entire table into a new array each time
// ═══════════════════════════════════════════════════

export async function countByEmployeeId(tables: string[], employeeIds: string[]): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>();
  
  const batch = await getAllBatch(tables);
  
  for (const table of tables) {
    const records = batch.get(table) || [];
    const countMap = new Map<string, number>();
    
    for (const r of records) {
      if (r.employeeId) {
        countMap.set(r.employeeId, (countMap.get(r.employeeId) || 0) + 1);
      }
    }
    
    result.set(table, countMap);
  }
  
  return result;
}

export async function groupByCount(table: string, field: string, whereFilters?: Record<string, any>): Promise<{ value: string | null; count: number }[]> {
  let all = await getAll<any>(table);
  if (whereFilters) all = all.filter((r) => Object.entries(whereFilters).every(([key, value]) => r[key] === value));
  const groupMap = new Map<string, number>();
  for (const r of all) { const val = String(r[field] ?? 'null'); groupMap.set(val, (groupMap.get(val) || 0) + 1); }
  return Array.from(groupMap.entries()).map(([value, count]) => ({ value: value === 'null' ? null : value, count })).sort((a, b) => b.count - a.count);
}

// ═══════════════════════════════════════════════════
//  Employee helpers (with longer cache)
// ═══════════════════════════════════════════════════

/**
 * Employee display map with CANONICAL organization labels: `department`
 * resolves from the Organization Tree via the shared pure resolver
 * (lib/organization/labels) — the stored free-text string survives
 * only for employees without an orgNodeId (or an empty tree). One
 * extra CACHED orgNodes read per TTL window (orgNodes is small and
 * rarely changing); pure in-memory resolution per row — no N+1.
 */
export async function getEmployeeMap(): Promise<Map<string, { id: string; name: string; department: string | null; position: string | null; shiftStart: string | null; team: string | null }>> {
  const [employees, orgNodes] = await Promise.all([
    getAll('employees', TTL.MEDIUM),
    getAll('orgNodes', TTL.MEDIUM),
  ]);
  const index = buildEmployeeOrgIndex(orgNodes as never);
  const out = new Map<string, { id: string; name: string; department: string | null; position: string | null; shiftStart: string | null; team: string | null }>();
  for (const e of employees as Array<Record<string, any>>) {
    const labels = resolveEmployeeOrgLabels(index, e as never);
    out.set(e.id, {
      id: e.id,
      name: e.name,
      department: labels.department,
      position: e.position || null,
      shiftStart: e.shiftStart || null,
      team: labels.team,
    });
  }
  return out;
}

export async function withEmployee<T extends { employeeId: string }>(records: T[], selectFields?: string[]): Promise<(T & { employeeName: string; employeeDepartment: string | null })[]> {
  const empMap = await getEmployeeMap();
  return records.map((r) => { const emp = empMap.get(r.employeeId); return { ...r, employeeName: emp?.name || 'غير معروف', employeeDepartment: emp?.department || null }; });
}

export async function withEmployeeFull<T extends { employeeId: string }>(records: T[]): Promise<(T & { employee: { id: string; name: string; department: string | null; shiftStart: string | null } })[]> {
  const empMap = await getEmployeeMap();
  return records.map((r) => { const emp = empMap.get(r.employeeId); return { ...r, employee: emp ? { id: emp.id, name: emp.name, department: emp.department, shiftStart: emp.shiftStart } : { id: '', name: 'غير معروف', department: null, shiftStart: null } }; });
}

// ═══════════════════════════════════════════════════
//  withRelatedCounts — Optimized: opt-in via includeCounts
//  Now uses batch loading instead of individual getAll calls
// ═══════════════════════════════════════════════════

export async function withRelatedCounts<T extends { id: string }>(
  employeeRecords: T[],
  options?: { batchData?: Map<string, any[]> }
): Promise<(T & { _count: { attendance: number; requests: number; qualityDeductions: number; biometrics: number; travelDeals: number } })[]> {
  // Use pre-fetched batch data if available (from home stats endpoint), otherwise fetch
  const tables = ['attendance', 'requests', 'qualityDeductions', 'biometrics', 'travelDeals'];
  let batch: Map<string, any[]>;
  
  if (options?.batchData) {
    batch = options.batchData;
  } else {
    batch = await getAllBatch(tables);
  }
  
  const countByEmpId = (records: any[], empId: string) => {
    let count = 0;
    for (const r of records) {
      if (r.employeeId === empId) count++;
    }
    return count;
  };
  
  const attendance = batch.get('attendance') || [];
  const requests = batch.get('requests') || [];
  const qualityDeductions = batch.get('qualityDeductions') || [];
  const biometrics = batch.get('biometrics') || [];
  const travelDeals = batch.get('travelDeals') || [];
  
  return employeeRecords.map((emp) => ({
    ...emp,
    _count: {
      attendance: countByEmpId(attendance, emp.id),
      requests: countByEmpId(requests, emp.id),
      qualityDeductions: countByEmpId(qualityDeductions, emp.id),
      biometrics: countByEmpId(biometrics, emp.id),
      travelDeals: countByEmpId(travelDeals, emp.id),
    },
  }));
}

export function sortByDateField<T extends Record<string, any>>(records: T[], field: string, direction: 'asc' | 'desc' = 'desc'): T[] {
  return [...records].sort((a, b) => { const dateA = a[field] ? new Date(a[field]).getTime() : 0; const dateB = b[field] ? new Date(b[field]).getTime() : 0; return direction === 'desc' ? dateB - dateA : dateA - dateB; });
}

export function sortByField<T extends Record<string, any>>(records: T[], field: string, direction: 'asc' | 'desc' = 'asc'): T[] {
  return [...records].sort((a, b) => { if (a[field] < b[field]) return direction === 'asc' ? -1 : 1; if (a[field] > b[field]) return direction === 'asc' ? 1 : -1; return 0; });
}

// Re-export TTL for use in API routes
export { TTL };
