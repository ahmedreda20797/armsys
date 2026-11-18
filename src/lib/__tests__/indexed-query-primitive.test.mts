// ══════════════════════════════════════════════════════════════
//  §INDEXED-QUERY (Phase 2) — getAllByChildEqualTo primitive
//
//  Covers the guarded indexed fetch in lib/db: indexed hit (rows +
//  id injection + ordering), cache behavior, the transparent
//  full-scan fallback (missing index / timeout / network error),
//  the per-target circuit breaker (timeouts open, fast errors and
//  successes do not), single-flight dedup of concurrent identical
//  queries, delayed-orphan draining, write-invalidation of indexed
//  entries, and the NEVER-PARTIAL guarantees (fallback failure
//  rejects; a timeout is never an empty dataset).
//
//  The Firebase Admin DB is mocked at the firebase-server boundary
//  (same doctrine as db-single-flight.test.mts) — no real database.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// §SERVER-ONLY stub — the tripwire package throws under standalone
// Node (tests are not client bundles). Same doctrine as
// db-single-flight.test.mts.
mock.module('server-only', { exports: {} });

// ─── Fake RTDB state ───────────────────────────────────────────
const fake = {
  tables: new Map<string, Record<string, unknown>>(), // table name → raw RTDB node
  indexedError: false,   // fast "index not defined" error
  otherError: false,     // fast network error
  hangIndexed: false,    // indexed query never settles (the observed hang)
  failPlainGet: false,   // full-node read throws (fallback failure)
  queryDelayMs: 0,       // artificial RTDB latency (indexed AND plain)
  indexedGetCalls: 0,
  plainGetCalls: 0,      // full-node reads (getAll / fallback)
  lastQuery: null as { table: string; field: string; value: string } | null,
};

function resetFake() {
  fake.tables = new Map();
  fake.indexedError = false;
  fake.otherError = false;
  fake.hangIndexed = false;
  fake.failPlainGet = false;
  fake.queryDelayMs = 0;
  fake.indexedGetCalls = 0;
  fake.plainGetCalls = 0;
  fake.lastQuery = null;
}

function setTable(name: string, rows: Record<string, unknown>) {
  fake.tables.set(name, rows);
}

/**
 * Reset the fake AND the db-layer cache/breaker state, then seed one
 * table — every in-test scenario step starts from a clean slate (a
 * timed-out call's fallback result is cached, so steps must clear it).
 */
async function freshState(name: string, rows: Record<string, unknown>) {
  resetFake();
  invalidateCache();
  resetIndexedQueryStateForTests();
  setTable(name, rows);
}

function makeSnapshot(obj: Record<string, unknown> | null) {
  return {
    exists: () => obj !== null && Object.keys(obj).length > 0,
    val: () => obj,
    forEach(cb: (child: { key: string; val: () => unknown }) => void) {
      if (!obj) return false;
      for (const [key, val] of Object.entries(obj)) cb({ key, val: () => val });
      return true;
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fakeDb = {
  ref(path: string) {
    // path: `arm_erp/<table>` or `arm_erp/<table>/<recordId>`
    const [scopedTable, recordId] = path.replace(/^arm_erp\//, '').split('/');
    return {
      // Full-node read (getAll + the scan fallback).
      async get() {
        fake.plainGetCalls += 1;
        if (fake.queryDelayMs > 0) await sleep(fake.queryDelayMs);
        if (fake.failPlainGet) throw new Error('RTDB unavailable');
        return makeSnapshot((fake.tables.get(scopedTable) as Record<string, unknown>) ?? null);
      },
      // Point write (createRecord etc.).
      async set(record: Record<string, unknown>) {
        const rows = (fake.tables.get(scopedTable) as Record<string, unknown>) ?? {};
        rows[recordId!] = record;
        fake.tables.set(scopedTable, rows);
      },
      async update(patch: Record<string, unknown>) {
        const rows = (fake.tables.get(scopedTable) as Record<string, unknown>) ?? {};
        rows[recordId!] = { ...(rows[recordId!] as Record<string, unknown>), ...patch };
        fake.tables.set(scopedTable, rows);
      },
      // Indexed query (orderByChild().equalTo()).
      orderByChild(field: string) {
        return {
          equalTo(value: string) {
            return {
              async get() {
                fake.indexedGetCalls += 1;
                fake.lastQuery = { table: scopedTable, field, value };
                if (fake.hangIndexed) return new Promise(() => {}); // never settles
                if (fake.queryDelayMs > 0) await sleep(fake.queryDelayMs);
                if (fake.indexedError) {
                  throw new Error(
                    `[Error client] Index not defined. Consider using ".indexOn": "${field}"\n at /arm_erp/${scopedTable}`
                  );
                }
                if (fake.otherError) throw new Error('connection ECONNRESET');
                const rows = (fake.tables.get(scopedTable) as Record<string, unknown>) ?? {};
                // RTDB semantics: rows whose child equals the value; ties
                // (same value) in key order — for a single queried value
                // every match is a tie, so matches come back in key order.
                const matches = Object.entries(rows)
                  .filter(([, val]) => (val as Record<string, unknown>)?.[field] === value)
                  .map(([key, val]) => [key, val] as const);
                return makeSnapshot(Object.fromEntries(matches));
              },
            };
          },
        };
      },
    };
  },
};

mock.module('@/lib/firebase-server', {
  exports: {
    getAdminDb: () => fakeDb,
  },
});

const {
  getAllByChildEqualTo,
  invalidateCache,
  createRecord,
  resetIndexedQueryStateForTests,
  getLastIndexedQueryDiagnostic,
} = await import('@/lib/db');

beforeEach(() => {
  resetFake();
  invalidateCache();
  resetIndexedQueryStateForTests();
});

// ─── Shared fixture: one table, several employees/months + edge rows ──
const ROWS: Record<string, unknown> = {
  r1: { employeeId: 'emp_a', month: '2026-09', value: 'a-sep' },
  r2: { employeeId: 'emp_b', month: '2026-09', value: 'b-sep' },
  r3: { employeeId: 'emp_a', month: '2026-10', value: 'a-oct', extraUnknownField: { nested: true } },
  // edge rows the legacy filter also never matched:
  r4: { month: '2026-09', value: 'missing-employeeId' },          // no employeeId
  r5: { employeeId: 'emp_a', value: 'missing-month' },            // no month
  r6: { employeeId: 'emp_c', month: '2026-09', value: 'other-org' },
};

describe('getAllByChildEqualTo — indexed hit semantics', () => {
  it('returns the matching rows with ids injected (shape parity with getAll)', async () => {
    setTable('attendanceResults', ROWS);
    const rows = await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a');
    // r1 + r3 + r5 — r5 (employeeId emp_a, NO month) matches the
    // employeeId query exactly as the legacy `r.employeeId === value`
    // filter did; "missing month" is irrelevant to this predicate.
    assert.deepEqual(
      rows.map((r) => (r as { value: string }).value),
      ['a-sep', 'a-oct', 'missing-month'],
    );
    for (const row of rows) {
      assert.ok(typeof (row as { id: string }).id === 'string', 'id injected');
    }
    assert.ok(
      'extraUnknownField' in (rows.find((r) => r.value === 'a-oct') as Record<string, unknown>),
      'unknown stored fields ride along',
    );
    assert.equal(fake.plainGetCalls, 0, 'no full-table read happened');
    assert.deepEqual(fake.lastQuery, { table: 'attendanceResults', field: 'employeeId', value: 'emp_a' });
  });

  it('matches the legacy in-memory filter on month equality (missing month never matches)', async () => {
    setTable('attendanceResults', ROWS);
    const rows = await getAllByChildEqualTo('attendanceResults', 'month', '2026-09');
    // r1 + r2 + r4 + r6 — r4 (month 2026-09, NO employeeId) matches
    // the month query exactly as the legacy `r.month === monthKey`
    // filter did; "missing employeeId" is irrelevant to this predicate.
    assert.deepEqual(
      rows.map((r) => (r as { value: string }).value).sort(),
      ['a-sep', 'b-sep', 'missing-employeeId', 'other-org'],
    );
  });

  it('returns [] for a legitimate miss (employee with no records) and caches the empty result', async () => {
    setTable('attendanceResults', ROWS);
    const rows = await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_ghost');
    assert.deepEqual(rows, []);
    assert.equal(fake.indexedGetCalls, 1);
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_ghost');
    assert.equal(fake.indexedGetCalls, 1, 'empty result is cached — no re-query');
  });

  it('reuses the indexed-result cache within the TTL (second call: zero RTDB ops)', async () => {
    setTable('attendanceResults', ROWS);
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a');
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a');
    assert.equal(fake.indexedGetCalls, 1);
    assert.equal(fake.plainGetCalls, 0);
  });

  it('a write invalidates the indexed cache (new record visible on the next read)', async () => {
    setTable('attendanceResults', ROWS);
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_c');
    await createRecord('attendanceResults', { employeeId: 'emp_c', month: '2026-10', value: 'c-new' });
    const rows = await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_c');
    assert.deepEqual(
      rows.map((r) => (r as { value: string }).value).sort(),
      ['c-new', 'other-org'],
    );
  });
});

describe('getAllByChildEqualTo — fallback correctness (NEVER partial)', () => {
  it('falls back to the full scan when the index is missing — same rows as the indexed path', async () => {
    setTable('attendanceResults', ROWS);
    const indexed = await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a');

    await freshState('attendanceResults', ROWS);
    fake.indexedError = true;
    const viaFallback = await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a');

    assert.deepEqual(viaFallback, indexed, 'fallback output ≡ indexed output');
    assert.equal(fake.plainGetCalls, 1, 'the legacy full-table scan served the caller');
    const diag = getLastIndexedQueryDiagnostic('attendanceResults.employeeId');
    assert.equal(diag?.path, 'scan');
    assert.equal(diag?.failure, 'error');
  });

  it('falls back on a TIMEOUT — never an empty dataset while data exists', async () => {
    setTable('attendanceResults', ROWS);
    fake.hangIndexed = true;
    const rows = await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a', { queryTimeoutMs: 30 });
    assert.deepEqual(
      rows.map((r) => (r as { value: string }).value).sort(),
      ['a-oct', 'a-sep', 'missing-month'],
    );
    const diag = getLastIndexedQueryDiagnostic('attendanceResults.employeeId');
    assert.equal(diag?.failure, 'timeout');
  });

  it('falls back on a fast network error (breaker NOT opened by it)', async () => {
    setTable('attendanceResults', ROWS);
    fake.otherError = true;
    const rows = await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a');
    assert.equal(rows.length, 3);
    assert.equal(getLastIndexedQueryDiagnostic('attendanceResults.employeeId')?.failure, 'error');
    // Breaker must NOT be open: the next call attempts the indexed query again.
    await freshState('attendanceResults', ROWS);
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a');
    assert.equal(fake.indexedGetCalls, 1, 'fast errors are not the hang signature');
  });

  it('a fallback FAILURE rejects — a broken database never masquerades as empty', async () => {
    setTable('attendanceResults', ROWS);
    fake.indexedError = true;
    fake.failPlainGet = true;
    await assert.rejects(
      () => getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a'),
      /RTDB unavailable/,
    );
    const diag = getLastIndexedQueryDiagnostic('attendanceResults.employeeId');
    assert.equal(diag?.path, 'scan');
    assert.equal(diag?.failure, 'error');
  });

  it('delayed original query resolving AFTER the fallback does not corrupt the result', async () => {
    // The indexed query settles late (150ms) — past the 30ms cap; the
    // fallback scan has already served the caller. The orphan is
    // drained: its late resolution is ignored, its late rejection can
    // never surface as an unhandled rejection, and the cached result
    // stays the fallback's. (The test run itself fails on any
    // unhandled rejection — completing cleanly is the assertion.)
    setTable('attendanceResults', ROWS);
    fake.hangIndexed = false;
    fake.queryDelayMs = 150;
    const rows = await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a', { queryTimeoutMs: 30 });
    assert.deepEqual(
      rows.map((r) => (r as { value: string }).value).sort(),
      ['a-oct', 'a-sep', 'missing-month'],
    );
    const diag = getLastIndexedQueryDiagnostic('attendanceResults.employeeId');
    assert.equal(diag?.path, 'scan');
    assert.equal(diag?.failure, 'timeout');

    await sleep(200); // let the orphan settle — nothing may happen
    await freshState('attendanceResults', ROWS);
    assert.deepEqual(
      (await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a')).map((r) => r.value),
      ['a-sep', 'a-oct', 'missing-month'],
      'subsequent reads unaffected by the orphan',
    );
  });

  it('the orphaned query is drained when it NEVER settles (hang) — no unhandled rejection', async () => {
    setTable('attendanceResults', ROWS);
    fake.hangIndexed = true;
    const rows = await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a', { queryTimeoutMs: 30 });
    assert.equal(rows.length, 3, 'the fallback served the caller despite the hang');
  });
});

describe('getAllByChildEqualTo — circuit breaker (per target)', () => {
  it('opens after TWO consecutive timeouts and serves from the scan directly', async () => {
    setTable('attendanceResults', ROWS);

    fake.hangIndexed = true;
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a', { queryTimeoutMs: 25 });
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_b', { queryTimeoutMs: 25 });
    const indexedCallsAfterHangs = fake.indexedGetCalls;
    assert.ok(indexedCallsAfterHangs >= 2);

    // Breaker open: indexed attempts are skipped entirely.
    fake.hangIndexed = false;
    invalidateCache();
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a', { queryTimeoutMs: 25 });
    assert.equal(fake.indexedGetCalls, indexedCallsAfterHangs, 'breaker open — no indexed attempt');
    assert.equal(getLastIndexedQueryDiagnostic('attendanceResults.employeeId')?.path, 'scan-breaker-open');
  });

  it('a single timeout does not open the breaker', async () => {
    setTable('attendanceResults', ROWS);
    fake.hangIndexed = true;
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a', { queryTimeoutMs: 25 });
    await freshState('attendanceResults', ROWS);
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a');
    assert.equal(fake.indexedGetCalls, 1, 'the indexed path is still being tried');
  });

  it('an indexed SUCCESS resets the timeout streak', async () => {
    setTable('attendanceResults', ROWS);
    fake.hangIndexed = true;
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a', { queryTimeoutMs: 25 });
    // success → streak reset
    await freshState('attendanceResults', ROWS);
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a');
    // exactly one more timeout → breaker must still be closed
    await freshState('attendanceResults', ROWS);
    fake.hangIndexed = true;
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a', { queryTimeoutMs: 25 });
    await freshState('attendanceResults', ROWS);
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a', { queryTimeoutMs: 25 });
    assert.equal(fake.indexedGetCalls, 1, 'breaker still closed after 1 timeout post-success');
  });

  it('breakers are per-target: a hang on one table/field does not disable another', async () => {
    setTable('attendanceResults', ROWS);
    setTable('qualityObservations', ROWS);
    fake.hangIndexed = true;
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a', { queryTimeoutMs: 25 });
    await getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_b', { queryTimeoutMs: 25 });
    // attendanceResults.employeeId breaker is now open; qualityObservations.employeeId is not.
    await freshState('attendanceResults', ROWS);
    setTable('qualityObservations', ROWS);
    await getAllByChildEqualTo('qualityObservations', 'employeeId', 'emp_a');
    assert.equal(fake.indexedGetCalls, 1, 'the other target still uses the indexed path');
  });
});

describe('getAllByChildEqualTo — concurrent duplicate protection', () => {
  it('concurrent identical queries share ONE attempt (query + fallback)', async () => {
    setTable('attendanceResults', ROWS);
    fake.hangIndexed = true;
    const [r1, r2, r3] = await Promise.all([
      getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a', { queryTimeoutMs: 30 }),
      getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a', { queryTimeoutMs: 30 }),
      getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a', { queryTimeoutMs: 30 }),
    ]);
    assert.equal(fake.indexedGetCalls, 1, 'one hanging query, not three');
    assert.equal(fake.plainGetCalls, 1, 'one fallback scan, not three');
    assert.deepEqual(r1, r2);
    assert.deepEqual(r2, r3);
  });

  it('distinct values never share a flight', async () => {
    setTable('attendanceResults', ROWS);
    await Promise.all([
      getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_a'),
      getAllByChildEqualTo('attendanceResults', 'employeeId', 'emp_b'),
      getAllByChildEqualTo('attendanceResults', 'month', '2026-09'),
    ]);
    assert.equal(fake.indexedGetCalls, 3, 'three distinct queries');
  });
});
