// ══════════════════════════════════════════════════════════════
//  Flexible period tests (§FLEX-PERIODS) — boundary correctness,
//  overlap policy, previous-span arithmetic.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveFlexiblePeriod,
  resolvePeriodWithComparison,
  previousPeriodSpecOf,
  periodsOverlap,
  weekStartOf,
  previousWeekStartOf,
  deriveComparisonSpec,
  FLEXIBLE_PERIOD_MAX_DAYS,
} from '../flexible-period';

const NOW = new Date(2026, 10, 14); // 2026-11-14 local

describe('flexible period resolution (§4 acceptance: correct date ranges)', () => {
  it('1a · day → single-day boundaries + containing month', () => {
    const r = resolveFlexiblePeriod({ kind: 'day', date: '2026-11-03' }, NOW);
    assert.ok(r.ok);
    assert.equal(r.period.startDayKey, '2026-11-03');
    assert.equal(r.period.endDayKey, '2026-11-03');
    assert.deepEqual(r.period.monthKeys, ['2026-11']);
    assert.equal(r.period.dayCount, 1);
  });

  it('1b · week → 7-day span from the Saturday anchor', () => {
    // 2026-11-14 is a Saturday → the week spans 14–20.
    const r = resolveFlexiblePeriod({ kind: 'week', weekStart: '2026-11-14' }, NOW);
    assert.ok(r.ok);
    assert.equal(r.period.startDayKey, '2026-11-14');
    assert.equal(r.period.endDayKey, '2026-11-20');
    assert.equal(r.period.dayCount, 7);
  });

  it('1c · month → full calendar month (leap-length February included)', () => {
    const r = resolveFlexiblePeriod({ kind: 'month', monthKey: '2024-02' }, NOW);
    assert.ok(r.ok);
    assert.equal(r.period.startDayKey, '2024-02-01');
    assert.equal(r.period.endDayKey, '2024-02-29');
    assert.equal(r.period.dayCount, 29);
    assert.deepEqual(r.period.monthKeys, ['2024-02']);
  });

  it('1d · quarter → calendar quarter (Q1 vs Q2 semantics)', () => {
    const q1 = resolveFlexiblePeriod({ kind: 'quarter', year: 2026, quarter: 1 }, NOW);
    const q2 = resolveFlexiblePeriod({ kind: 'quarter', year: 2026, quarter: 2 }, NOW);
    assert.ok(q1.ok && q2.ok);
    assert.equal(q1.period.startDayKey, '2026-01-01');
    assert.equal(q1.period.endDayKey, '2026-03-31');
    assert.equal(q2.period.startDayKey, '2026-04-01');
    assert.equal(q2.period.endDayKey, '2026-06-30');
    assert.deepEqual(q1.period.monthKeys, ['2026-01', '2026-02', '2026-03']);
  });

  it('1e · six_months → calendar halves', () => {
    const h1 = resolveFlexiblePeriod({ kind: 'six_months', year: 2026, half: 1 }, NOW);
    const h2 = resolveFlexiblePeriod({ kind: 'six_months', year: 2026, half: 2 }, NOW);
    assert.ok(h1.ok && h2.ok);
    assert.equal(h1.period.endDayKey, '2026-06-30');
    assert.equal(h2.period.startDayKey, '2026-07-01');
    assert.equal(h2.period.endDayKey, '2026-12-31');
    assert.equal(h2.period.monthKeys.length, 6);
  });

  it('1f · year → full year (leap-aware)', () => {
    const leap = resolveFlexiblePeriod({ kind: 'year', year: 2024 }, NOW);
    const plain = resolveFlexiblePeriod({ kind: 'year', year: 2026 }, NOW);
    assert.ok(leap.ok && plain.ok);
    assert.equal(leap.period.dayCount, 366);
    assert.equal(plain.period.dayCount, 365);
    assert.equal(plain.period.monthKeys.length, 12);
  });

  it('1g · custom_range → inclusive boundaries + span cap', () => {
    const r = resolveFlexiblePeriod({ kind: 'custom_range', fromDate: '2026-11-01', toDate: '2026-11-14' }, NOW);
    assert.ok(r.ok);
    assert.equal(r.period.dayCount, 14);
    assert.deepEqual(r.period.monthKeys, ['2026-11']);

    const tooLong = resolveFlexiblePeriod(
      { kind: 'custom_range', fromDate: '2025-01-01', toDate: '2026-06-01' },
      NOW,
    );
    assert.ok(!tooLong.ok, 'spans beyond the cap are rejected explicitly');
  });

  it('1h · invalid inputs are explicit errors (never guessed)', () => {
    assert.ok(!resolveFlexiblePeriod({ kind: 'day', date: '2026-13-01' }, NOW).ok);
    assert.ok(!resolveFlexiblePeriod({ kind: 'month', monthKey: '2026-13' }, NOW).ok);
    assert.ok(!resolveFlexiblePeriod({ kind: 'custom_range', fromDate: '2026-11-10', toDate: '2026-11-01' }, NOW).ok);
    assert.ok(!resolveFlexiblePeriod({ kind: 'year', year: 1999 }, NOW).ok);
  });

  it('1i · a period reaching the current month is flagged partial', () => {
    const partial = resolveFlexiblePeriod({ kind: 'month', monthKey: '2026-11' }, NOW);
    const historical = resolveFlexiblePeriod({ kind: 'month', monthKey: '2026-06' }, NOW);
    assert.ok(partial.ok && historical.ok);
    assert.equal(partial.period.includesCurrentMonth, true);
    assert.equal(historical.period.includesCurrentMonth, false);
  });
});

describe('comparison periods (§4 acceptance: independent + correctly calculated)', () => {
  it('2a · November 2026 vs October 2026 — calendar previous', () => {
    const r = resolvePeriodWithComparison(
      { kind: 'month', monthKey: '2026-11' },
      { kind: 'month', monthKey: '2026-10' },
      NOW,
    );
    assert.ok(r.ok);
    assert.equal(r.value.primary.monthKeys[0], '2026-11');
    assert.equal(r.value.comparison.monthKeys[0], '2026-10');
  });

  it('2b · Nov 1–14 vs Oct 1–14 — custom vs custom', () => {
    const r = resolvePeriodWithComparison(
      { kind: 'custom_range', fromDate: '2026-11-01', toDate: '2026-11-14' },
      { kind: 'custom_range', fromDate: '2026-10-01', toDate: '2026-10-14' },
      NOW,
    );
    assert.ok(r.ok);
    assert.equal(r.value.primary.dayCount, r.value.comparison.dayCount, 'equal-length spans');
  });

  it('2c · Q1 vs Q2 — independent quarters', () => {
    const r = resolvePeriodWithComparison(
      { kind: 'quarter', year: 2026, quarter: 2 },
      { kind: 'quarter', year: 2026, quarter: 1 },
      NOW,
    );
    assert.ok(r.ok);
    assert.ok(!periodsOverlap(r.value.primary, r.value.comparison));
  });

  it('2d · previous_period auto-computes the equal-length preceding span', () => {
    // Week: current selected week vs the previous week.
    const r = resolvePeriodWithComparison(
      { kind: 'week', weekStart: '2026-11-14' },
      { kind: 'previous_period' },
      NOW,
    );
    assert.ok(r.ok);
    assert.equal(r.value.comparison.startDayKey, '2026-11-07');
    assert.equal(r.value.comparison.endDayKey, '2026-11-13');

    // Custom: Nov 1–14 vs the 14 days before it (Oct 18–31).
    const c = resolvePeriodWithComparison(
      { kind: 'custom_range', fromDate: '2026-11-01', toDate: '2026-11-14' },
      { kind: 'previous_period' },
      NOW,
    );
    assert.ok(c.ok);
    assert.equal(c.value.comparison.startDayKey, '2026-10-18');
    assert.equal(c.value.comparison.endDayKey, '2026-10-31');

    // Month: Nov vs Oct; quarter: Q1 2026 vs Q4 2025.
    assert.deepEqual(
      previousPeriodSpecOf({ kind: 'month', monthKey: '2026-11' }),
      { kind: 'month', monthKey: '2026-10' },
    );
    assert.deepEqual(
      previousPeriodSpecOf({ kind: 'quarter', year: 2026, quarter: 1 }),
      { kind: 'quarter', year: 2025, quarter: 4 },
    );
  });

  it('2e · OVERLAPPING periods are an explicit error — never a misleading comparison', () => {
    const r = resolvePeriodWithComparison(
      { kind: 'custom_range', fromDate: '2026-11-01', toDate: '2026-11-14' },
      { kind: 'custom_range', fromDate: '2026-11-10', toDate: '2026-11-20' },
      NOW,
    );
    assert.ok(!r.ok);
  });

  it('2f · a comparison INSIDE the primary span is also rejected', () => {
    const r = resolvePeriodWithComparison(
      { kind: 'quarter', year: 2026, quarter: 4 },
      { kind: 'month', monthKey: '2026-11' },
      NOW,
    );
    assert.ok(!r.ok);
  });
});

describe('week anchors (Saturday-start business week)', () => {
  it('3a · weekStartOf anchors to Saturday across the week', () => {
    assert.equal(weekStartOf('2026-11-14', NOW), '2026-11-14'); // Sat
    assert.equal(weekStartOf('2026-11-15', NOW), '2026-11-14'); // Sun
    assert.equal(weekStartOf('2026-11-19', NOW), '2026-11-14'); // Thu
    assert.equal(weekStartOf('2026-11-20', NOW), '2026-11-14'); // Fri
    assert.equal(weekStartOf('2026-11-21', NOW), '2026-11-21'); // next Sat
  });

  it('3b · previousWeekStartOf steps back exactly one week', () => {
    assert.equal(previousWeekStartOf('2026-11-14', NOW), '2026-11-07');
    assert.equal(previousWeekStartOf('2026-11-18', NOW), '2026-11-07');
  });
});

describe('deriveComparisonSpec (the chosen KIND is honored exactly)', () => {
  it('4a · month primary → day comparison = the day before the primary start', () => {
    assert.deepEqual(
      deriveComparisonSpec({ kind: 'month', monthKey: '2026-11' }, 'day'),
      { kind: 'day', date: '2026-10-31' },
    );
  });

  it('4b · month primary → month comparison = the previous calendar month', () => {
    assert.deepEqual(
      deriveComparisonSpec({ kind: 'month', monthKey: '2026-11' }, 'month'),
      { kind: 'month', monthKey: '2026-10' },
    );
  });

  it('4c · week primary → week comparison = exactly one week earlier', () => {
    assert.deepEqual(
      deriveComparisonSpec({ kind: 'week', weekStart: '2026-11-14' }, 'week'),
      { kind: 'week', weekStart: '2026-11-07' },
    );
  });

  it('4d · custom primary → custom comparison = equal-length preceding span', () => {
    assert.deepEqual(
      deriveComparisonSpec({ kind: 'custom_range', fromDate: '2026-11-01', toDate: '2026-11-14' }, 'custom_range'),
      { kind: 'custom_range', fromDate: '2026-10-18', toDate: '2026-10-31' },
    );
  });

  it('4e · calendar kinds derive from the primary first month', () => {
    assert.deepEqual(
      deriveComparisonSpec({ kind: 'quarter', year: 2026, quarter: 2 }, 'quarter'),
      { kind: 'quarter', year: 2026, quarter: 1 },
    );
    assert.deepEqual(
      deriveComparisonSpec({ kind: 'six_months', year: 2026, half: 1 }, 'six_months'),
      { kind: 'six_months', year: 2025, half: 2 },
    );
    assert.deepEqual(
      deriveComparisonSpec({ kind: 'year', year: 2026 }, 'year'),
      { kind: 'year', year: 2025 },
    );
    // A month primary asked for a QUARTER comparison → the quarter of
    // the primary's first month, stepped one back.
    assert.deepEqual(
      deriveComparisonSpec({ kind: 'month', monthKey: '2026-11' }, 'quarter'),
      { kind: 'quarter', year: 2026, quarter: 3 },
    );
  });

  it('4f · derived month comparisons never overlap the primary', () => {
    const pair = resolvePeriodWithComparison(
      { kind: 'month', monthKey: '2026-11' },
      deriveComparisonSpec({ kind: 'month', monthKey: '2026-11' }, 'month'),
      NOW,
    );
    assert.ok(pair.ok);
  });
});
