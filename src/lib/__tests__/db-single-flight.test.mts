// ══════════════════════════════════════════════════════════════
//  §SINGLE-FLIGHT — in-flight read deduplication in lib/db
//
//  Covers: concurrent identical reads share ONE RTDB operation,
//  different tables/params/TTLs never share, rejected flights are
//  removed from the registry (the next caller retries fresh), the
//  registry empties when everything settles, identical getById calls
//  share one point read, getAllBatch and getAll share the same flight,
//  and the TTL cache behavior (hit / invalidate) is unchanged.
//
//  The Firebase Admin DB is mocked at the firebase-server boundary
//  (same doctrine as find-user-by-email.test.mts) — no real database.
//  Reads are gated with a small controllable delay so concurrency can
//  be orchestrated deterministically.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// §SERVER-ONLY stub — the tripwire package throws under standalone
// Node (tests are not client bundles). Registered as a module mock so
// this ESM suite is self-contained even when tsx's tsconfig mapping
// (tsconfig.test.json) is not in effect. Same doctrine as the .ts
// harness (m01-test-support).
mock.module('server-only', { exports: {} });

// ─── Fake RTDB state ───────────────────────────────────────────
const fake = {
  tables: new Map<string, Record<string, unknown>>(), // path under arm_erp → raw node
  readDelayMs: 40,
  startedReads: 0,
  failReads: false,
  lastPaths: [] as string[],
};

function resetFake() {
  fake.tables = new Map();
  fake.readDelayMs = 40;
  fake.startedReads = 0;
  fake.failReads = false;
  fake.lastPaths = [];
}

function setTable(name: string, rows: Record<string, unknown>) {
  fake.tables.set(name, rows);
}

function makeSnapshot(obj: Record<string, unknown> | null) {
  return {
    exists: () => obj !== null && Object.keys(obj).length > 0,
    val: () => obj,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fakeDb = {
  ref(path: string) {
    return {
      async get() {
        fake.startedReads += 1;
        fake.lastPaths.push(path);
        if (fake.failReads) {
          // Fail AFTER the delay so concurrent sharers have already joined.
          await sleep(fake.readDelayMs);
          throw new Error('fake RTDB outage');
        }
        await sleep(fake.readDelayMs);
        // path is `arm_erp/<table>` (full table) or `arm_erp/<table>/<id>` (point read).
        const segments = path.replace('arm_erp/', '').split('/');
        const tableNode = fake.tables.get(segments[0]!) ?? {};
        if (segments.length === 1) return makeSnapshot(tableNode);
        // Real RTDB point read: val() IS the row object itself.
        const row = tableNode[segments[1]!];
        return makeSnapshot(row ?? null);
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
  getAll,
  getAllBatch,
  getById,
  invalidateCache,
  getInFlightReadCount,
} = await import('@/lib/db');

beforeEach(() => {
  resetFake();
  invalidateCache();
});

// ───────────────────────────────────────────────────────────────

describe('getAll — §SINGLE-FLIGHT deduplication', () => {
  it('concurrent identical reads share ONE RTDB operation and all get the data', async () => {
    setTable('hrDeductions', {
      r1: { employeeId: 'e1', month: '2026-09', amount: 2 },
      r2: { employeeId: 'e2', month: '2026-09', amount: 1 },
    });

    const [a, b, c] = await Promise.all([
      getAll('hrDeductions'),
      getAll('hrDeductions'),
      getAll('hrDeductions'),
    ]);

    assert.equal(fake.startedReads, 1, 'three concurrent cold reads must share one download');
    assert.equal(a.length, 2);
    assert.deepEqual(a, b);
    assert.deepEqual(b, c);
    assert.equal(getInFlightReadCount(), 0, 'completed flights must not linger');
  });

  it('different tables never share a flight', async () => {
    setTable('employees', { e1: { name: 'أ' } });
    setTable('followUps', { f1: { employeeId: 'e1' } });

    await Promise.all([getAll('employees'), getAll('followUps')]);

    assert.equal(fake.startedReads, 2);
  });

  it('the same table with DIFFERENT ttl intent does not share a flight (key includes ttl)', async () => {
    setTable('employees', { e1: { name: 'أ' } });

    await Promise.all([getAll('employees'), getAll('employees', 30_000)]);

    assert.equal(fake.startedReads, 2, 'TTL affects the cache entry the winner stores — kept out of shared flights');
  });

  it('a rejected flight removes itself from the registry and the next call retries fresh', async () => {
    setTable('employees', { e1: { name: 'أ' } });
    fake.failReads = true;

    const results = await Promise.allSettled([getAll('employees'), getAll('employees')]);
    assert.equal(results.every((r) => r.status === 'rejected'), true, 'all concurrent sharers see the rejection');
    assert.equal(fake.startedReads, 1, 'the failure itself is still deduplicated');
    assert.equal(getInFlightReadCount(), 0, 'rejected flights must be removed immediately');

    // Retry after failure — the failed flight is gone, a NEW read runs and succeeds.
    fake.failReads = false;
    const rows = await getAll('employees');
    assert.equal(fake.startedReads, 2);
    assert.equal(rows.length, 1);
    assert.equal(getInFlightReadCount(), 0);
  });

  it('sequential cache hits do not start new reads (TTL cache behavior unchanged)', async () => {
    setTable('employees', { e1: { name: 'أ' } });

    await getAll('employees');
    assert.equal(fake.startedReads, 1);

    const second = await getAll('employees');
    assert.equal(fake.startedReads, 1, 'second read must come from the TTL cache');
    assert.equal(second.length, 1);

    invalidateCache('employees');
    await getAll('employees');
    assert.equal(fake.startedReads, 2, 'invalidation forces a fresh read exactly as before');
  });

  it('empty tables return [] without populating the cache (behavior preserved)', async () => {
    await getAll('emptyTable');
    assert.equal(fake.startedReads, 1);

    await getAll('emptyTable');
    assert.equal(fake.startedReads, 2, 'empty result was never cached before — unchanged');
  });
});

describe('getById — §SINGLE-FLIGHT deduplication', () => {
  it('concurrent identical point reads share ONE operation; different ids do not', async () => {
    setTable('employees', { e1: { name: 'أ' }, e2: { name: 'ب' } });

    const [a, b, c, d] = await Promise.all([
      getById('employees', 'e1'),
      getById('employees', 'e1'),
      getById('employees', 'e2'),
      getById('employees', 'e3'),
    ]);

    assert.equal(fake.startedReads, 3, 'e1 twice deduped, e2 and e3 are distinct keys');
    assert.deepEqual(a, { id: 'e1', name: 'أ' });
    assert.deepEqual(b, { id: 'e1', name: 'أ' });
    assert.deepEqual(c, { id: 'e2', name: 'ب' });
    assert.equal(d, null, 'missing row stays null');
    assert.equal(getInFlightReadCount(), 0);
  });

  it('a failed getById flight is retried on the next call', async () => {
    setTable('employees', { e1: { name: 'أ' } });
    fake.failReads = true;

    await assert.rejects(() => getById('employees', 'e1'), /fake RTDB outage/);
    assert.equal(getInFlightReadCount(), 0);

    fake.failReads = false;
    const row = await getById('employees', 'e1');
    assert.deepEqual(row, { id: 'e1', name: 'أ' });
  });

  it('point reads are never cached — sequential calls re-read (freshness preserved)', async () => {
    setTable('employees', { e1: { name: 'أ' } });
    await getById('employees', 'e1');
    await getById('employees', 'e1');
    assert.equal(fake.startedReads, 2, 'no persistent cache was introduced for getById');
  });
});

describe('getAllBatch — §SINGLE-FLIGHT deduplication', () => {
  it('batch tables and a concurrent getAll of the SAME table share one flight', async () => {
    setTable('employees', { e1: { name: 'أ' } });
    setTable('orgNodes', { n1: { name: 'N' } });

    const [batch, direct] = await Promise.all([
      getAllBatch(['employees', 'orgNodes']),
      getAll('employees'),
    ]);

    assert.equal(fake.startedReads, 2, 'employees shared, orgNodes read once');
    assert.equal(batch.get('employees')!.length, 1);
    assert.equal(batch.get('orgNodes')!.length, 1);
    assert.deepEqual(direct, batch.get('employees'));
  });

  it('batch preserves per-table data and honors the shared ttl parameter', async () => {
    setTable('employees', { e1: { name: 'أ' }, e2: { name: 'ب' } });

    const batch = await getAllBatch(['employees'], 30_000);
    assert.equal(batch.get('employees')!.length, 2);

    // Warm cache — a repeat batch must not hit the network.
    const warm = await getAllBatch(['employees'], 30_000);
    assert.equal(fake.startedReads, 1);
    assert.equal(warm.get('employees')!.length, 2);
  });

  it('a failing table rejects the whole batch (previous Promise.all semantics)', async () => {
    setTable('employees', { e1: { name: 'أ' } });
    fake.failReads = true;

    await assert.rejects(() => getAllBatch(['employees', 'orgNodes']), /fake RTDB outage/);
    // Drain the microtask queue so the sibling flight's finally-cleanup runs.
    await new Promise((r) => setImmediate(r));
    assert.equal(getInFlightReadCount(), 0);
  });
});

describe('§SINGLE-FLIGHT — data isolation', () => {
  it('callers of different tables never observe each other\'s rows', async () => {
    setTable('hrDeductions', { h1: { employeeId: 'e1', secret: 'hr' } });
    setTable('employees', { e1: { name: 'أ', secret: 'emp' } });

    const [hr, emp] = await Promise.all([getAll('hrDeductions'), getAll('employees')]);

    assert.equal(hr[0].secret, 'hr');
    assert.equal(emp[0].secret, 'emp');
    // Keys are per table — no cross-table registry collision is possible.
    assert.equal(fake.startedReads, 2);
  });
});
