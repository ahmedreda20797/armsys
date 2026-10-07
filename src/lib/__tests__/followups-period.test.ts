// ══════════════════════════════════════════════════════════════
//  §PERF-FOLLOWUPS — period semantics (pure helpers)
//
//  Contract under test:
//    • monthBounds — inclusive start / EXCLUSIVE end, December
//      rollover, pure string bounds (no UTC arithmetic).
//    • resolveFollowUpsMonth — valid "YYYY-MM" preserved; anything
//      else (missing / malformed / out of range) falls back to the
//      CURRENT CALENDAR MONTH with LOCAL semantics (a fixed local
//      clock near midnight must never drift to the previous month
//      the way a UTC-derived key would).
//    • followUpMonthOptions — next + current + 11 back, unique.
//    • followUpsPeriodToken — distinct periods → distinct cache
//      identity tokens; absent period → one stable "current".
//    • DOMAIN_DEPENDENCIES — followUps mutations still invalidate by
//      the ['followUps'] PREFIX, so every month variant refetches.
//
//  Run: npx tsx --test src/lib/__tests__/followups-period.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthBounds,
  resolveFollowUpsMonth,
  followUpMonthOptions,
  followUpsPeriodToken,
} from '@/lib/followups-period';
import { DOMAIN_DEPENDENCIES } from '@/lib/cache/invalidation';

describe('monthBounds', () => {
  it('mid-year month: inclusive start, exclusive end', () => {
    assert.deepEqual(monthBounds('2026-10'), { start: '2026-10-01', endExclusive: '2026-11-01' });
  });

  it('December rolls over to January of the NEXT year', () => {
    assert.deepEqual(monthBounds('2026-12'), { start: '2026-12-01', endExclusive: '2027-01-01' });
  });

  it('a last-day record stays inside the window (exclusive-end safety)', () => {
    const { start, endExclusive } = monthBounds('2026-10');
    assert.ok('2026-10-31' >= start && '2026-10-31' < endExclusive);
    assert.ok('2026-11-01' >= endExclusive);
  });
});

describe('resolveFollowUpsMonth — default period semantics', () => {
  it('no period supplied → the current calendar month', () => {
    const now = new Date(2026, 9, 7, 14, 30); // 2026-10-07 local
    assert.equal(resolveFollowUpsMonth(undefined, now), '2026-10');
  });

  it('valid explicit month is preserved (deep-link period wins)', () => {
    const now = new Date(2026, 9, 7);
    assert.equal(resolveFollowUpsMonth('2026-09', now), '2026-09');
  });

  it('invalid values fall back to the current month, never widen', () => {
    const now = new Date(2026, 9, 7);
    assert.equal(resolveFollowUpsMonth('garbage', now), '2026-10');
    assert.equal(resolveFollowUpsMonth('2026-13', now), '2026-10');
    assert.equal(resolveFollowUpsMonth('', now), '2026-10');
    assert.equal(resolveFollowUpsMonth(42 as unknown as string, now), '2026-10');
  });

  it('local-calendar semantics: 00:30 local on the 1st is the NEW month', () => {
    // A UTC-derived key for UTC+3 clients at 2026-11-01T00:30 local
    // (2026-10-31T21:30 UTC) would wrongly say October.
    const now = new Date(2026, 10, 1, 0, 30);
    assert.equal(resolveFollowUpsMonth(undefined, now), '2026-11');
  });
});

describe('followUpMonthOptions', () => {
  it('contains next, current and the 11 previous months — all unique', () => {
    const now = new Date(2026, 9, 7);
    const options = followUpMonthOptions(now);
    assert.equal(options.length, 13);
    assert.equal(new Set(options).size, 13);
    assert.ok(options.includes('2026-10'));
    assert.ok(options.includes('2026-11'));
    assert.ok(options.includes('2025-11'));
    assert.equal(options[0], '2026-11');
    assert.equal(options[1], '2026-10');
  });

  it('December current month rolls next into the next year', () => {
    const now = new Date(2026, 11, 15);
    const options = followUpMonthOptions(now);
    assert.equal(options[0], '2027-01');
    assert.equal(options[1], '2026-12');
  });
});

describe('followUpsPeriodToken — query identity', () => {
  it('September and October produce DIFFERENT tokens', () => {
    assert.notEqual(followUpsPeriodToken('2026-09', null), followUpsPeriodToken('2026-10', null));
  });

  it('absent month collapses to one stable token', () => {
    assert.equal(followUpsPeriodToken(null, null), followUpsPeriodToken('', null));
    assert.equal(followUpsPeriodToken(null, null), 'current');
  });

  it('an explicit date range is its own identity, distinct from months', () => {
    const token = followUpsPeriodToken('2026-10', { start: '2026-09-01', end: '2026-10-31' });
    assert.equal(token, 'range:2026-09-01..2026-10-31');
    assert.notEqual(token, followUpsPeriodToken('2026-10', null));
  });

  it('different ranges never collide', () => {
    assert.notEqual(
      followUpsPeriodToken(null, { start: '2026-09-01', end: '2026-09-30' }),
      followUpsPeriodToken(null, { start: '2026-10-01', end: '2026-10-31' }),
    );
  });
});

describe('mutation invalidation still covers every month variant', () => {
  it('followUps domain invalidates by the bare [followUps] prefix', () => {
    const prefixes = DOMAIN_DEPENDENCIES.followUps.map((p) => JSON.stringify(p));
    assert.ok(prefixes.includes(JSON.stringify(['followUps'])));
  });
});
