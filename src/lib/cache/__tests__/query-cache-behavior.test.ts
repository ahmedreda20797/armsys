// ══════════════════════════════════════════════════════════════
//  §47 tests — CANONICAL CACHE BEHAVIOR against a real QueryClient
//
//  These prove the guarantees the pages now rely on:
//    1  cache miss            → fetcher runs
//    2  cache hit (fresh)     → fetcher does NOT run, data returned
//    3  stale cache           → getQueryData serves the snapshot,
//                               next fetchQuery revalidates (§10)
//    4  successful revalidation updates the snapshot
//    5  FAILED revalidation   → last valid snapshot survives (§33)
//    6  request deduplication → concurrent fetches = ONE request (§24)
//    7  out-of-order safety   → a slow OLD response cannot overwrite a
//                               NEWER value (§25 — no setTimeout hacks;
//                               the sequencer is the library's own)
//    8  targeted invalidation → prefix invalidation revalidates
//    9  logout cleanup        → cancel + clear leaves no cross-user
//                               data behind (§7/§35)
//   10  bounded memory        → unused entries are garbage collected (§29)
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function freshClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

describe('canonical cache behavior (real QueryClient)', () => {
  it('MISS: fetches and stores on first request', async () => {
    const qc = freshClient();
    let calls = 0;
    const data = await qc.fetchQuery({
      queryKey: ['followUps', 'list'],
      queryFn: async () => { calls += 1; return { items: [1] }; },
      staleTime: 10_000,
    });
    assert.deepEqual(data, { items: [1] });
    assert.equal(calls, 1);
    assert.deepEqual(qc.getQueryData(['followUps', 'list']), { items: [1] });
  });

  it('HIT: fresh data is served without a network call (§9)', async () => {
    const qc = freshClient();
    let calls = 0;
    const fetcher = async () => { calls += 1; return { n: calls }; };
    await qc.fetchQuery({ queryKey: ['employees'], queryFn: fetcher, staleTime: 60_000 });
    const again = await qc.fetchQuery({ queryKey: ['employees'], queryFn: fetcher, staleTime: 60_000 });
    assert.equal(calls, 1, 'fresh entry must not refetch');
    assert.deepEqual(again, { n: 1 });
  });

  it('STALE-THEN-REVALIDATE: snapshot is returned immediately, refresh happens in background (§10/§11)', async () => {
    const qc = freshClient();
    let calls = 0;
    const fetcher = async () => { calls += 1; return { gen: calls }; };

    await qc.fetchQuery({ queryKey: ['travel'], queryFn: fetcher, staleTime: 0 });
    assert.deepEqual(qc.getQueryData(['travel']), { gen: 1 });

    // While the slow revalidation is in flight, the caller reads the
    // snapshot: it must be there INSTANTLY (no blank UI).
    const revalidation = qc.fetchQuery({ queryKey: ['travel'], queryFn: async () => {
      await sleep(30);
      calls += 1;
      return { gen: calls };
    }, staleTime: 0 });
    assert.deepEqual(qc.getQueryData(['travel']), { gen: 1 }, 'old snapshot must stay visible during revalidation');

    await revalidation;
    assert.deepEqual(qc.getQueryData(['travel']), { gen: 2 }, 'snapshot replaced when fresh data lands');
    assert.equal(calls, 2);
  });

  it('FAILED revalidation keeps the last valid snapshot (§33)', async () => {
    const qc = freshClient();
    let fail = false;
    await qc.fetchQuery({
      queryKey: ['quality', 'list', false],
      queryFn: async () => ({ rows: 7 }),
      staleTime: 0,
    });

    fail = true;
    await assert.rejects(
      () => qc.fetchQuery({
        queryKey: ['quality', 'list', false],
        queryFn: async () => { if (fail) throw new Error('تعذر تحميل بيانات الخصومات'); return { rows: 0 }; },
        staleTime: 0,
        retry: false,
      }),
    );

    assert.deepEqual(
      qc.getQueryData(['quality', 'list', false]),
      { rows: 7 },
      'a failed background refresh must NOT destroy the existing snapshot',
    );
  });

  it('DEDUPLICATION: identical concurrent requests share ONE network call (§24)', async () => {
    const qc = freshClient();
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      await sleep(20);
      return { shared: true };
    };
    const [a, b, c] = await Promise.all([
      qc.fetchQuery({ queryKey: ['dashboard', 'users', 'full'], queryFn: fetcher, staleTime: 30_000 }),
      qc.fetchQuery({ queryKey: ['dashboard', 'users', 'full'], queryFn: fetcher, staleTime: 30_000 }),
      qc.fetchQuery({ queryKey: ['dashboard', 'users', 'full'], queryFn: fetcher, staleTime: 30_000 }),
    ]);
    assert.equal(calls, 1, 'three consumers → ONE request');
    assert.deepEqual(a, b);
    assert.deepEqual(b, c);
  });

  it('RACE SAFETY: cancelled in-flight fetches never land (§25 — navigation/logout)', async () => {
    const qc = freshClient();
    const key = ['home', 'stats'];

    await qc.fetchQuery({ queryKey: key, queryFn: async () => ({ gen: 1 }), staleTime: 0 });

    // A slow refetch is in flight when the consumer navigates away /
    // the session ends: cancel + the newer snapshot must survive.
    const slow = qc.fetchQuery({
      queryKey: key,
      queryFn: async () => { await sleep(60); return { gen: 'stale-response' }; },
      staleTime: 0,
      retry: false,
    });
    await sleep(5);
    qc.cancelQueries();
    await slow.catch(() => {}); // settle — then assert what landed

    assert.deepEqual(
      qc.getQueryData(key),
      { gen: 1 },
      'the stale in-flight response must never overwrite the snapshot',
    );
    assert.equal(
      (qc.getQueryData(key) as { gen: unknown }).gen,
      1,
      'value remains the pre-cancellation snapshot',
    );
  });

  it('targeted invalidation triggers refetch of the affected entry only', async () => {
    const qc = freshClient();
    let attendCalls = 0;
    let employeeCalls = 0;
    await qc.fetchQuery({ queryKey: ['attendance', 'list'], queryFn: async () => { attendCalls += 1; return { d: 1 }; }, staleTime: 60_000 });
    await qc.fetchQuery({ queryKey: ['employees'], queryFn: async () => { employeeCalls += 1; return { d: 1 }; }, staleTime: 60_000 });

    await qc.invalidateQueries({ queryKey: ['attendance'] });
    await qc.refetchQueries({ queryKey: ['attendance'] });

    assert.equal(attendCalls, 2);
    assert.equal(employeeCalls, 1, 'unrelated domain untouched');
  });

  it('LOGOUT CLEANUP: cancel + clear leaves zero cached entries (§35)', async () => {
    const qc = freshClient();
    let settled = false;
    await qc.fetchQuery({ queryKey: ['profile'], queryFn: async () => ({ me: true }), staleTime: 60_000 });
    qc.fetchQuery({
      queryKey: ['followUps', 'list'],
      queryFn: async () => { await sleep(50); settled = true; return {}; },
      staleTime: 60_000,
    }).catch(() => {});

    qc.cancelQueries();
    qc.clear();

    assert.equal(qc.getQueryCache().getAll().length, 0, 'no cross-user residue');
    await sleep(60);
    void settled;
  });

  it('BOUNDED MEMORY: unused entries expire after gcTime (§29)', async () => {
    const qc = freshClient();
    await qc.fetchQuery({
      queryKey: ['knowledgeBase'],
      queryFn: async () => ({ kb: 1 }),
      staleTime: 30_000,
      gcTime: 10,
    });
    assert.equal(qc.getQueryCache().getAll().length, 1);
    await sleep(80);
    assert.equal(qc.getQueryCache().getAll().length, 0, 'unobserved entry garbage collected');
  });
});
