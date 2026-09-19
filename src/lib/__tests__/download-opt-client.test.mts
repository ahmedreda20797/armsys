// ══════════════════════════════════════════════════════════════
//  §DOWNLOAD-OPT — client-side notification merge + polling policy
//  + shared server TTL cache (real db.ts against a counting fake).
//
//  Covers milestone behaviors A/B/D/E (dedup + reliability at the
//  logic level), G/H/I (visibility-aware polling decisions), and the
//  getAllBatch(ttl) plumbing that lets polling routes share one
//  full-table download across a fleet of pollers.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { AppNotification } from '@/types';

// ─── Fixtures ──────────────────────────────────────────────────
let seq = 0;
function notif(overrides: Partial<AppNotification> = {}): AppNotification {
  seq += 1;
  return {
    id: `n${seq}`,
    title: `t${seq}`,
    description: '',
    priority: 'medium',
    status: 'unread',
    category: 'system',
    sourceModule: 'manual',
    employeeId: null,
    assignedTo: null,
    createdBy: null,
    ruleId: null,
    ruleName: null,
    actionUrl: null,
    sourceType: null,
    targetPage: null,
    createdAt: new Date(Date.parse('2026-09-19T10:00:00Z') + seq * 1000).toISOString(),
    ...overrides,
  } as AppNotification;
}

// ─── §DEDUP / reliability (behaviors A, B, D, E, F) ────────────
const { mergeIncomingNotifications, NOTIFICATION_PANEL_CAP } = await import('@/lib/notifications/client-merge');

describe('§DOWNLOAD-OPT — client-merge (ID-based dedup, history cap)', () => {
  it('A. a NEW notification is received and merged', () => {
    const { merged, added } = mergeIncomingNotifications([], [notif()]);
    assert.equal(merged.length, 1);
    assert.equal(added.length, 1);
  });

  it('B. unread status of a new notification is preserved (object identity, no mutation)', () => {
    const fresh = notif({ status: 'unread' });
    const { merged } = mergeIncomingNotifications([], [fresh]);
    assert.equal(merged[0], fresh, 'same object — no status rewriting');
    assert.equal(merged[0].status, 'unread');
  });

  it('D. the same notification re-delivered by realtime + polling appears ONCE (id identity)', () => {
    const n1 = notif();
    const once = mergeIncomingNotifications([], [n1]);
    const twice = mergeIncomingNotifications(once.merged, [n1, n1]);
    assert.equal(twice.merged.length, 1);
    assert.equal(twice.added.length, 0);
  });

  it('D2. mixed batch: only genuinely-new ids are added, sorted newest-first', () => {
    const older = notif();
    const newer = notif();
    const state = mergeIncomingNotifications([], [older]).merged;
    const { merged, added } = mergeIncomingNotifications(state, [older, newer]);
    assert.deepEqual(added.map((n) => n.id), [newer.id]);
    assert.deepEqual(merged.map((n) => n.id), [newer.id, older.id]);
  });

  it('E. reconnect re-poll of the full window adds nothing and loses nothing', () => {
    const history = [notif(), notif(), notif()];
    const before = mergeIncomingNotifications([], history).merged;
    const after = mergeIncomingNotifications(before, history); // full re-sync
    assert.equal(after.added.length, 0);
    assert.deepEqual(after.merged.map((n) => n.id), before.map((n) => n.id));
  });

  it('F. no title-based dedup — distinct notifications with equal titles both survive', () => {
    const a = notif({ title: 'same title' });
    const b = notif({ title: 'same title' });
    const { merged } = mergeIncomingNotifications([], [a, b]);
    assert.equal(merged.length, 2);
  });

  it('panel history stays capped at 100 (existing UI behavior)', () => {
    const prev = Array.from({ length: 150 }, () => notif());
    const { merged } = mergeIncomingNotifications(prev, [notif()]);
    assert.equal(NOTIFICATION_PANEL_CAP, 100);
    assert.equal(merged.length, 100);
  });
});

// ─── §VISIBILITY (behaviors G, H, I) ───────────────────────────
const { shouldPollNow, shouldRefreshOnForeground, NOTIFICATION_POLL_INTERVAL_MS } = await import('@/lib/polling-policy');

describe('§DOWNLOAD-OPT — visibility-aware polling policy', () => {
  it('G. hidden tab never polls — regardless of staleness', () => {
    assert.equal(shouldPollNow({ isVisible: false, lastPollAt: null, now: 1000, intervalMs: 45000 }), false);
    assert.equal(shouldPollNow({ isVisible: false, lastPollAt: 0, now: 3_600_000, intervalMs: 45000 }), false);
  });

  it('visible tab polls on the normal cadence (45s for notifications)', () => {
    assert.equal(NOTIFICATION_POLL_INTERVAL_MS, 45_000);
    assert.equal(shouldPollNow({ isVisible: true, lastPollAt: null, now: 1000, intervalMs: 45000 }), true);
    assert.equal(shouldPollNow({ isVisible: true, lastPollAt: 1000, now: 1000 + 45_000, intervalMs: 45000 }), true);
    assert.equal(shouldPollNow({ isVisible: true, lastPollAt: 1000, now: 1000 + 44_999, intervalMs: 45000 }), false);
  });

  it('H. returning to a visible tab refreshes ONCE when stale, not repeatedly when fresh', () => {
    const stale = shouldRefreshOnForeground({ lastFetchAt: 1000, now: 1000 + 31_000, staleThresholdMs: 30_000 });
    assert.equal(stale, true, 'one controlled reconciliation after being hidden');
    // Simulate the refresh completing: lastFetchAt moves to now.
    const afterRefresh = shouldRefreshOnForeground({ lastFetchAt: 31_000, now: 31_001, staleThresholdMs: 30_000 });
    assert.equal(afterRefresh, false, 'no duplicate refetch for repeated visibility events');
  });

  it('I. fresh foreground events do not force refetches', () => {
    assert.equal(shouldRefreshOnForeground({ lastFetchAt: 50_000, now: 50_002, staleThresholdMs: 30_000 }), false);
    assert.equal(shouldRefreshOnForeground({ lastFetchAt: null, now: 50_002, staleThresholdMs: 30_000 }), true);
  });
});

// ─── §SHARED-CACHE — real db.ts TTL plumbing (getAllBatch ttl) ──
const reads: string[] = [];
let currentMockedTime = Date.now();

mock.module('server-only', { exports: {} });

mock.module('@/lib/firebase-server', {
  exports: {
    getAdminDb: () => ({
      ref(path: string) {
        return {
          async get() {
            reads.push(path);
            // Non-empty snapshot — db.ts does not cache empty tables
            // (pre-existing: `!snapshot.exists()` returns before setCache).
            return { exists: () => true, val: () => ({ x1: { v: 1 } }) };
          },
        };
      },
    }),
  },
});

// The TTL logic reads Date.now() — mock it so expiry is deterministic.
mock.timers.enable({ apis: ['Date'] });
currentMockedTime = Date.now();

const { getAllBatch, getAll, invalidateCache, TTL } = await import('@/lib/db');

describe('§DOWNLOAD-OPT — getAllBatch(ttl) shares one download across pollers', () => {
  beforeEach(() => {
    reads.length = 0;
    invalidateCache();
    mock.timers.reset();
    mock.timers.enable({ apis: ['Date'] });
  });

  it('J-infra. ttl argument is honored: within the window repeat calls cost ZERO RTDB reads', async () => {
    await getAllBatch(['alpha'], TTL.POLL);
    await getAllBatch(['alpha'], TTL.POLL);
    await getAllBatch(['alpha'], TTL.POLL);
    assert.equal(reads.filter((p) => p === 'arm_erp/alpha').length, 1, 'one download shared by all pollers');
  });

  it('J-infra. POLL window (30s) expires only after 30s', async () => {
    await getAllBatch(['alpha'], TTL.POLL);
    mock.timers.tick(29_000);
    await getAllBatch(['alpha'], TTL.POLL);
    assert.equal(reads.filter((p) => p === 'arm_erp/alpha').length, 1);
    mock.timers.tick(2_000); // now +31s since the read
    await getAllBatch(['alpha'], TTL.POLL);
    assert.equal(reads.filter((p) => p === 'arm_erp/alpha').length, 2, 're-downloaded after expiry');
  });

  it('J-infra. default behavior is UNCHANGED (5s) when ttl is omitted — backward compatible', async () => {
    await getAllBatch(['beta']);
    mock.timers.tick(6_000);
    await getAllBatch(['beta']);
    assert.equal(reads.filter((p) => p === 'arm_erp/beta').length, 2, 'default 5s TTL still expires quickly');

    // A POLL-cached table read at the same moment is still fresh at +6s.
    await getAllBatch(['gamma'], TTL.POLL);
    mock.timers.tick(6_000);
    await getAllBatch(['gamma'], TTL.POLL);
    assert.equal(reads.filter((p) => p === 'arm_erp/gamma').length, 1);
  });

  it('getAll (single-table) default TTL is untouched', async () => {
    await getAll('delta');
    mock.timers.tick(6_000);
    await getAll('delta');
    assert.equal(reads.filter((p) => p === 'arm_erp/delta').length, 2);
  });
});
