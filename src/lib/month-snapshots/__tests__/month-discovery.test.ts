// ══════════════════════════════════════════════════════════════
//  Month Close — Month DISCOVERY regression tests (hotfix spec §13)
//
//  Verifies that months with real Quality KPI activity become
//  VISIBLE/AVAILABLE on the Month Close page (via the discovery
//  builder consumed by GET /api/month-snapshots) WITHOUT being
//  finalized, fabricated, duplicated, or zero-filled — and that the
//  existing finalization + MTD semantics stay untouched.
//
//  Pure-function tests only (no Firebase): the route is a thin
//  wrapper that loads observations + snapshots and delegates to
//  buildDiscoveredMonthRows — the same pattern as
//  month-snapshots.test.ts (pure primitives the routes delegate to).
//
//  Run: npx tsx --test src/lib/month-snapshots/__tests__/month-discovery.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildDiscoveredMonthRows } from '@/lib/month-snapshots/discovery';
import type { DiscoveredMonthSummary } from '@/lib/month-snapshots/discovery';
import {
  computeApprovalStats,
  computeMonthSnapshot,
} from '@/lib/metrics/kpiMetrics';
import type { ObservationLike } from '@/lib/metrics/kpiMetrics';
import type { KpiSettings, QualityObservation } from '@/types/quality-kpi';

// ─────────────────────────────────────────────────────────────
//  Fixtures
// ─────────────────────────────────────────────────────────────

const CURRENT_MONTH = '2026-08';

const SETTINGS: KpiSettings = {
  id: 'singleton',
  schemaVersion: 1,
  defaultScore: 100,
  minimumScore: 0,
  allowBonus: true,
  maximumBonus: 20,
  approvalRequired: true,
  leaderboardEnabled: true,
  closeMonthLock: true,
  trendCalculation: 'rollingAverage',
  updatedAt: '2026-08-15T10:00:00.000Z',
};

/** Minimal discovery-shaped observation with defaults. */
function makeDiscoveryObs(
  overrides: Partial<Parameters<typeof buildDiscoveredMonthRows>[0][number]> = {},
): Parameters<typeof buildDiscoveredMonthRows>[0][number] {
  return {
    month: CURRENT_MONTH,
    employeeId: 'emp1',
    department: 'مبيعات',
    applyPointDeduction: true,
    approvalStatus: 'pending',
    ...overrides,
  };
}

/** Full QualityObservation shape for the engine-parity case. */
function makeEngineObs(overrides: Partial<QualityObservation> = {}): QualityObservation {
  return {
    id: 'obs1',
    schemaVersion: 1,
    employeeId: 'emp1',
    employeeName: 'أحمد',
    department: 'مبيعات',
    positionSnapshot: 'موظف',
    observerId: 'u1',
    observerName: 'مراقب',
    observationDate: '05/08/2026',
    month: CURRENT_MONTH,
    type: 'late_followup',
    severity: 'medium',
    categoryId: 'cat1',
    categoryName: 'تأخر متابعة',
    categoryWeight: 1,
    notes: '',
    evidence: '',
    status: 'open',
    relatedCapaId: null,
    correctiveAction: '',
    dueDate: null,
    resolvedDate: null,
    applyPointDeduction: true,
    points: 5,
    isBonus: false,
    approvalStatus: 'pending',
    createdAt: '2026-08-05T10:00:00.000Z',
    updatedAt: '2026-08-05T10:00:00.000Z',
    ...overrides,
  } as QualityObservation;
}

function monthKeys(rows: DiscoveredMonthSummary[]): string[] {
  return rows.map((r) => r.monthKey);
}

// ─────────────────────────────────────────────────────────────
//  §13.1 — Current-month observation → month appears (OPEN)
// ─────────────────────────────────────────────────────────────
describe('month discovery — current month availability', () => {
  it('discovered row exists for the month holding observations, status OPEN (not finalized)', () => {
    const rows = buildDiscoveredMonthRows(
      [makeDiscoveryObs({ month: '2026-08' })],
      new Set(),
    );

    assert.deepEqual(monthKeys(rows), ['2026-08']);
    const aug = rows[0];
    assert.equal(aug.status, 'open');
    assert.equal(aug.closedAt, null);
    assert.equal(aug.closedBy, null);
    assert.equal(aug.closedByName, null);
    assert.equal(aug.generatedAt, null);
    // Discovery ≠ close: id is the stable month key, no frozen payload.
    assert.equal(aug.id, '2026-08');
    assert.equal('employeeScores' in aug, false);
    assert.equal('kpiResults' in aug, false);
  });

  it('row carries REAL activity counts (1 employee, 1 department, real approval stats)', () => {
    const rows = buildDiscoveredMonthRows(
      [
        makeDiscoveryObs({ employeeId: 'emp1', department: 'مبيعات', approvalStatus: 'pending' }),
        makeDiscoveryObs({ employeeId: 'emp2', department: 'مبيعات', approvalStatus: 'approved' }),
      ],
      new Set(),
    );
    assert.equal(rows[0].employeeCount, 2);
    assert.equal(rows[0].departmentCount, 1);
    assert.equal(rows[0].approvalStats.pending, 1);
    assert.equal(rows[0].approvalStats.approved, 1);
  });
});

// ─────────────────────────────────────────────────────────────
//  §13.2 — Multiple observations in the same month → appears ONCE
// ─────────────────────────────────────────────────────────────
describe('month discovery — deduplication', () => {
  it('many observations in one month produce exactly one row', () => {
    const rows = buildDiscoveredMonthRows(
      [
        makeDiscoveryObs({ employeeId: 'emp1' }),
        makeDiscoveryObs({ employeeId: 'emp1', approvalStatus: 'approved' }),
        makeDiscoveryObs({ employeeId: 'emp2' }),
        makeDiscoveryObs({ employeeId: 'emp3', approvalStatus: 'rejected' }),
      ],
      new Set(),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].monthKey, '2026-08');
    // Counts are still the real distinct totals across all observations.
    assert.equal(rows[0].employeeCount, 3);
    assert.equal(rows[0].approvalStats.total, 4);
  });
});

// ─────────────────────────────────────────────────────────────
//  §13.3 — Partial / in-progress month → available, NOT finalized
// ─────────────────────────────────────────────────────────────
describe('month discovery — partial month', () => {
  it('activity on days 1–10 only still yields an OPEN (available) month', () => {
    const rows = buildDiscoveredMonthRows(
      [makeDiscoveryObs({ month: '2026-08' })], // mid-month activity; month not over
      new Set(),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'open');
    // No close metadata may ever leak from discovery.
    assert.equal(rows[0].closedAt, null);
    assert.equal(rows[0].historyCount, 0);
  });
});

// ─────────────────────────────────────────────────────────────
//  §13.4 / §8 — No activity → NO fabricated month
// ─────────────────────────────────────────────────────────────
describe('month discovery — no fabrication for empty months', () => {
  it('calendar months without observations are NOT invented (no fake zeros)', () => {
    const rows = buildDiscoveredMonthRows(
      [makeDiscoveryObs({ month: '2026-08' })],
      new Set(),
    );
    // Neighbor months (July / September) do not exist despite the calendar.
    assert.deepEqual(monthKeys(rows), ['2026-08']);
  });

  it('no observations at all → no rows at all', () => {
    const rows = buildDiscoveredMonthRows([], new Set());
    assert.equal(rows.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────
//  §13.5 / §9 — Closed month: stored doc wins, stays FINALIZED
// ─────────────────────────────────────────────────────────────
describe('month discovery — closed months are never duplicated or altered', () => {
  it('a month with a stored snapshot doc is excluded from discovery', () => {
    const rows = buildDiscoveredMonthRows(
      [makeDiscoveryObs({ month: '2026-06' })],
      new Set(['2026-06']), // stored closed document exists for June
    );
    assert.equal(rows.length, 0);
    // The route renders the STORED doc for that month verbatim — its
    // 'closed' status, frozen scores and history are untouched here.
  });

  it('a reopened month (stored doc, status open) is also left to its stored document', () => {
    const rows = buildDiscoveredMonthRows(
      [makeDiscoveryObs({ month: '2026-05' })],
      new Set(['2026-05']),
    );
    assert.equal(rows.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────
//  §13.6 — Historical month with valid data remains available
// ─────────────────────────────────────────────────────────────
describe('month discovery — historical months', () => {
  it('old months with activity are discovered, most recent first', () => {
    const rows = buildDiscoveredMonthRows(
      [
        makeDiscoveryObs({ month: '2026-03' }),
        makeDiscoveryObs({ month: '2025-12' }),
        makeDiscoveryObs({ month: '2026-08' }),
      ],
      new Set(),
    );
    assert.deepEqual(monthKeys(rows), ['2026-08', '2026-03', '2025-12']);
    for (const r of rows) assert.equal(r.status, 'open');
  });
});

// ─────────────────────────────────────────────────────────────
//  §13.7 / §11 — Archived employee lifecycle respected
// ─────────────────────────────────────────────────────────────
describe('month discovery — archived employees', () => {
  it('historical months of a later-archived employee remain available', () => {
    const rows = buildDiscoveredMonthRows(
      [makeDiscoveryObs({ month: '2025-11', employeeId: 'archived-emp', department: 'تشغيل' })],
      new Set(),
    );
    assert.deepEqual(monthKeys(rows), ['2025-11']);
    assert.equal(rows[0].employeeCount, 1);
    assert.equal(rows[0].status, 'open');
  });

  it('no post-archive zero activity is fabricated for later months', () => {
    const rows = buildDiscoveredMonthRows(
      [makeDiscoveryObs({ month: '2025-11', employeeId: 'archived-emp' })],
      new Set(),
    );
    // Months after the archive (e.g. 2026-08) get NO row — no zero records.
    assert.deepEqual(monthKeys(rows), ['2025-11']);
  });
});

// ─────────────────────────────────────────────────────────────
//  §13.8 — Missing data is NOT converted to zero
// ─────────────────────────────────────────────────────────────
describe('month discovery — honest counts, no zero-filling', () => {
  it('approval stats reflect real statuses (pending stays pending, not 0)', () => {
    const rows = buildDiscoveredMonthRows(
      [
        makeDiscoveryObs({ approvalStatus: 'pending' }),
        makeDiscoveryObs({ employeeId: 'emp2', approvalStatus: 'pending' }),
        makeDiscoveryObs({ employeeId: 'emp3', approvalStatus: 'approved' }),
        makeDiscoveryObs({ employeeId: 'emp4', approvalStatus: 'rejected' }),
        makeDiscoveryObs({ employeeId: 'emp5', applyPointDeduction: false }), // not approval-relevant
      ],
      new Set(),
    );
    const stats = rows[0].approvalStats;
    assert.equal(stats.total, 4);
    assert.equal(stats.pending, 2);
    assert.equal(stats.approved, 1);
    assert.equal(stats.rejected, 1);
  });

  it('records with missing subject fields never fabricate counts, but activity still surfaces the month', () => {
    const rows = buildDiscoveredMonthRows(
      [
        makeDiscoveryObs({ employeeId: '', department: '' }), // incomplete record
        makeDiscoveryObs({ employeeId: 'emp1', department: 'مبيعات' }),
      ],
      new Set(),
    );
    assert.equal(rows.length, 1); // month still discoverable via real activity
    assert.equal(rows[0].employeeCount, 1); // only the REAL employee is counted
    assert.equal(rows[0].departmentCount, 1);
  });

  it('month keys that fail the strict validator are never discovered', () => {
    const rows = buildDiscoveredMonthRows(
      [
        makeDiscoveryObs({ month: '2026-13' }), // month out of range
        makeDiscoveryObs({ month: 'not-a-month' }),
        makeDiscoveryObs({ month: '2026-08-15' }), // ISO datetime, not a month key
        makeDiscoveryObs({ month: '' }),
      ],
      new Set(),
    );
    assert.equal(rows.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────
//  §13.9 — MTD / engine compatibility (shared aggregation, no 2nd calc)
// ─────────────────────────────────────────────────────────────
describe('month discovery — engine parity (MTD untouched)', () => {
  it('computeApprovalStats matches the stats the canonical engine embeds', () => {
    const obs: ObservationLike[] = [
      makeEngineObs({ approvalStatus: 'pending' }),
      makeEngineObs({ id: 'obs2', employeeId: 'emp2', approvalStatus: 'approved' }),
      makeEngineObs({ id: 'obs3', employeeId: 'emp2', approvalStatus: 'rejected' }),
    ].map((o) => ({
      id: o.id,
      employeeId: o.employeeId,
      month: o.month,
      applyPointDeduction: o.applyPointDeduction,
      points: o.points,
      isBonus: o.isBonus,
      approvalStatus: o.approvalStatus,
      categoryId: o.categoryId,
      categoryWeight: o.categoryWeight,
      status: o.status,
    }));

    const computed = computeMonthSnapshot(
      obs,
      CURRENT_MONTH,
      new Map(), // engine tolerates an empty employee lookup
      new Map(),
      SETTINGS,
    );

    assert.deepEqual(computeApprovalStats(obs), computed.approvalStats);
    assert.equal(computed.approvalStats.pending, 1);
    assert.equal(computed.approvalStats.approved, 1);
    assert.equal(computed.approvalStats.rejected, 1);
  });

  it('discovery performs NO KPI calculation (no scores, no freezing) — MTD stays the only live path', () => {
    const rows = buildDiscoveredMonthRows(
      [makeDiscoveryObs({ approvalStatus: 'approved', applyPointDeduction: true })],
      new Set(),
    );
    const row = rows[0] as unknown as Record<string, unknown>;
    for (const forbidden of ['employeeScores', 'kpiResults', 'settingsSnapshot', 'topEmployees', 'bottomEmployees']) {
      assert.equal(forbidden in row, false, `discovery must not fabricate ${forbidden}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────
//  §13.10 — Finalization behavior unchanged (manual close only)
// ─────────────────────────────────────────────────────────────
describe('month discovery — finalization stays manual', () => {
  it('discovery never closes a month: every synthesized row is open with empty close metadata', () => {
    const rows = buildDiscoveredMonthRows(
      [
        makeDiscoveryObs({ month: '2026-08' }),
        makeDiscoveryObs({ month: '2026-07' }),
        makeDiscoveryObs({ month: '2026-06' }),
      ],
      new Set(),
    );
    for (const r of rows) {
      assert.equal(r.status, 'open', `discovery finalized ${r.monthKey} — forbidden`);
      assert.equal(r.closedAt, null);
      assert.equal(r.reopenCount, 0);
      assert.equal(r.historyCount, 0);
    }
  });
});
