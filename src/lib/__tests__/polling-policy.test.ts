// ══════════════════════════════════════════════════════════════
//  Milestone 9 — Polling policy (Part F / Part P)
//
//  Verifies the pure decision helpers both polling loops now use:
//    • Hidden tabs never poll
//    • Visible polls fire only when the interval elapsed
//    • Foreground recovery refreshes once when data is stale
//    • Auth refresh and notification polling cadences are
//      independent constants (auth no longer hammers /auth/me)
//
//  Run: npx tsx --test src/lib/__tests__/polling-policy.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldPollNow,
  shouldRefreshOnForeground,
  NOTIFICATION_POLL_INTERVAL_MS,
  AUTH_REFRESH_INTERVAL_MS,
  FOREGROUND_STALE_THRESHOLD_MS,
} from '@/lib/polling-policy';

const MIN = 60_000;

describe('shouldPollNow', () => {
  it('hidden tab never polls', () => {
    assert.equal(
      shouldPollNow({ isVisible: false, lastPollAt: null, now: 0, intervalMs: 45_000 }),
      false
    );
    assert.equal(
      shouldPollNow({ isVisible: false, lastPollAt: 0, now: 10 * MIN, intervalMs: 45_000 }),
      false
    );
  });

  it('visible + never polled → polls', () => {
    assert.equal(
      shouldPollNow({ isVisible: true, lastPollAt: null, now: 0, intervalMs: 45_000 }),
      true
    );
  });

  it('visible + fresh data → does NOT poll', () => {
    assert.equal(
      shouldPollNow({ isVisible: true, lastPollAt: 10_000, now: 30_000, intervalMs: 45_000 }),
      false
    );
  });

  it('visible + interval elapsed → polls', () => {
    assert.equal(
      shouldPollNow({ isVisible: true, lastPollAt: 0, now: 45_000, intervalMs: 45_000 }),
      true
    );
  });
});

describe('shouldRefreshOnForeground', () => {
  it('no prior fetch → refresh', () => {
    assert.equal(shouldRefreshOnForeground({ lastFetchAt: null, now: 0, staleThresholdMs: MIN }), true);
  });

  it('recently fetched (still fresh) → skip (no duplicate burst on tab flips)', () => {
    assert.equal(
      shouldRefreshOnForeground({ lastFetchAt: 10_000, now: 20_000, staleThresholdMs: MIN }),
      false
    );
  });

  it('stale data → refresh once on return', () => {
    assert.equal(
      shouldRefreshOnForeground({ lastFetchAt: 0, now: 5 * MIN, staleThresholdMs: MIN }),
      true
    );
  });
});

describe('polling cadences (behavioral anchors)', () => {
  it('notification fallback poll keeps its 45s reliability cadence', () => {
    assert.equal(NOTIFICATION_POLL_INTERVAL_MS, 45_000);
  });

  it('auth identity refresh reduced from 60s to 5 minutes (idle /auth/me fix)', () => {
    assert.equal(AUTH_REFRESH_INTERVAL_MS, 5 * MIN);
  });

  it('foreground stale threshold matches the app staleTime (30s)', () => {
    assert.equal(FOREGROUND_STALE_THRESHOLD_MS, 30_000);
  });

  it('auth and notification loops are independent (cadences differ)', () => {
    assert.notEqual(AUTH_REFRESH_INTERVAL_MS, NOTIFICATION_POLL_INTERVAL_MS);
  });
});
