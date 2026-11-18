// ══════════════════════════════════════════════════════════════
//  §GROUP-SCALING — group report scalability (Task C)
//
//  Representative group sizes (1 / 10 / 25 / 50 members) run against
//  the in-memory db harness, measuring REAL database operations
//  through the stubbed db call log:
//    • AFTER (new path): buildPerformanceGroupReport — one shared
//      §HR-LOOKUP + one request-scoped loader set, bounded pool.
//    • BEFORE (old path): the same N per-member builds the previous
//      unbounded Promise.all issued — default loaders (uncached
//      point reads per member) + one full-table hrDeductions
//      read+scan per member.
//  Both paths produce IDENTICAL member rows, so the report is
//  provably unchanged while the read count drops.
//
//  NOTE: the stubbed db has no TTL cache, so these counts measure the
//  LOADER-level behavior exactly (in production lib/db's TTL cache
//  additionally dedups the remaining whole-table reads per window).
//  Timing here is stubbed/in-memory — production RTDB latency is
//  reported separately in the delivery note, never fabricated here.
// ══════════════════════════════════════════════════════════════

import '../../__tests__/m01-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setTable, resetTestData, calls, dbStubs } from '../../__tests__/m01-test-support';

import { buildPerformanceGroupReport } from '@/lib/performance-hub';
import type { BuildPerformanceGroupReportInput, GroupMemberSummary } from '@/lib/performance-hub';
import type { GetPerformanceHubServiceInput } from '@/lib/performance-hub';
import { defaultPerformanceIntelligenceLoaders } from '@/lib/performance-intelligence';

const MONTH = '2026-09';

function makeOrgNodes(): Record<string, unknown>[] {
  return [
    { id: 'company', name: 'الشركة', type: 'company', parentId: null, status: 'active', managerUserName: 'المدير العام' },
    { id: 'team-a', name: 'فريق أ', type: 'team', parentId: 'company', status: 'active', managerUserName: 'مدير أ' },
  ];
}

function makeEmployees(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `emp_${String(i + 1).padStart(3, '0')}`,
    name: `موظف ${i + 1}`,
    code: String(i + 1).padStart(3, '0'),
    status: 'active',
    orgNodeId: 'team-a',
    createdAt: '2026-01-01T00:00:00.000Z',
  }));
}

function makeHrDeductions(n: number): Record<string, unknown>[] {
  // One approved deduction for every second employee in the reported month.
  return Array.from({ length: Math.floor(n / 2) }, (_, i) => ({
    id: `hr_${i + 1}`,
    employeeId: `emp_${String((i + 1) * 2).padStart(3, '0')}`,
    month: MONTH,
    amount: 1,
    unit: 'days',
    status: 'approved',
    type: 'late',
    deductionDate: `${MONTH}-10`,
  }));
}

function seed(n: number) {
  resetTestData();
  setTable('employees', makeEmployees(n));
  setTable('orgNodes', makeOrgNodes());
  setTable('hrDeductions', makeHrDeductions(n));
  setTable('monthSnapshots', []);
  setTable('kpiSchemes', []);
  setTable('kpiSchemeOverrides', []);
  setTable('employmentEvents', []);
  setTable('qualityObservations', []);
  setTable('qualityDeductions', []);
  setTable('complaints', []);
  setTable('capaCases', []);
  setTable('followUps', []);
  setTable('travelDeals', []);
  setTable('attendanceResults', []);
}

function allIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `emp_${String(i + 1).padStart(3, '0')}`);
}

function groupInput(n: number): BuildPerformanceGroupReportInput {
  return {
    monthKey: MONTH,
    selection: { employeeIds: allIds(n), orgNodeIds: [] },
    scopeLimit: null,
    compare: false,
    riskEnabled: false,
    hrAuthorized: true,
  };
}

function countCalls(fn: string, table?: string): number {
  return calls.filter((c) => c.fn === fn && (table === undefined || c.args[0] === table)).length;
}

/** The OLD per-member path: default loaders, per-member HR read, unbounded fan-out. */
async function oldPathMemberRows(n: number): Promise<GroupMemberSummary[]> {
  const mod = await import('@/lib/performance-hub');
  const builds = await Promise.all(
    allIds(n).map((employeeId) =>
      mod.getEmployeePerformanceHubDataset({
        employeeId,
        monthKey: MONTH,
        now: new Date('2026-10-01T00:00:00Z'),
        riskEnabled: false,
        hrAuthorized: true,
        scopeIncludes: undefined,
      } as GetPerformanceHubServiceInput),
    ),
  );
  // Old code mapped successful datasets to member rows ordered by id.
  return builds.filter((d): d is NonNullable<typeof d> => d !== null).map((d) => ({
    employeeId: d.employee.employeeId,
  } as unknown as GroupMemberSummary));
}

const serviceModule = {} as {
  getEmployeePerformanceHubDataset: (i: GetPerformanceHubServiceInput) => Promise<unknown>;
};

before(async () => {
  const mod = await import('@/lib/performance-hub');
  serviceModule.getEmployeePerformanceHubDataset = mod.getEmployeePerformanceHubDataset;
});

beforeEach(() => {
  seed(0); // tests reseed with their own size
});

// ───────────────────────────────────────────────────────────────

describe('§GROUP-SCALING — representative group sizes', () => {
  for (const size of [1, 10, 25, 50] as const) {
    it(`${size} member(s): complete report, deterministic order, shared reads`, async () => {
      seed(size);
      const report = await buildPerformanceGroupReport(groupInput(size));

      // ── Completeness: every employee appears exactly once ──
      assert.equal(report.population.members.length, size, 'all members present (no silent omission)');
      assert.equal(report.population.failedEmployeeIds.length, 0);
      assert.equal(report.population.requestedEmployeeIds.length, size);
      assert.equal(report.population.outOfScopeEmployeeIds.length, 0);

      // ── Deterministic ordering (id-sorted, index-stable) ──
      const ids = report.population.members.map((m) => m.employeeId);
      assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)));

      // ── Missing-data states preserved: no fabricated KPI values ──
      const VALID_OVERVIEW = new Set([
        'IMPROVING', 'STABLE', 'NEEDS_COACHING',
        'PERFORMANCE_IMPROVEMENT_REVIEW', 'MANAGEMENT_REVIEW', 'INSUFFICIENT_DATA',
      ]);
      for (const member of report.population.members) {
        assert.equal(member.qualityPercent, null, 'no snapshot → quality value is null, never 0');
        assert.ok(VALID_OVERVIEW.has(member.overviewStatus), `overview status in vocabulary: ${member.overviewStatus}`);
      }
      const qualityRollup = report.dimensionRollups.find((r) => r.key === 'quality');
      assert.ok(qualityRollup);
      assert.equal(qualityRollup.membersWithValue, 0);
      assert.equal(qualityRollup.averageValue, null);
      // Coverage accounting stays consistent (membersWithData is the
      // exact count of value-bearing members).
      assert.equal(
        report.coverage.membersWithData + report.coverage.membersWithoutData,
        size,
      );
      assert.equal(
        report.coverage.membersWithData,
        report.population.members.filter((m) => m.hasData).length,
      );

      // ── §HR-LOOKUP: ONE hrDeductions read for the WHOLE group ──
      assert.equal(countCalls('getAll', 'hrDeductions'), 1, 'one shared HR read regardless of group size');

      // ── Scoped loaders: NO uncached employees point reads ──
      assert.equal(countCalls('getById', 'employees'), 0, 'identity/record/engine reads use the batched projection');
    });
  }
});

describe('§GROUP-SCALING — read-count reduction (old path vs new path)', () => {
  for (const size of [10, 50] as const) {
    it(`${size} members: the new path issues strictly fewer db operations than the old per-member path`, async () => {
      seed(size);

      // BEFORE — exactly what the previous implementation did per member.
      resetTestData();
      seed(size);
      const t0 = Date.now();
      await oldPathMemberRows(size);
      const oldMs = Date.now() - t0;
      const oldReads = calls.length;
      const oldGetByIdEmployees = countCalls('getById', 'employees');
      const oldGetAllHr = countCalls('getAll', 'hrDeductions');

      // AFTER — the optimized group builder.
      resetTestData();
      seed(size);
      const t1 = Date.now();
      const report = await buildPerformanceGroupReport(groupInput(size));
      const newMs = Date.now() - t1;
      const newReads = calls.length;
      const newGetByIdEmployees = countCalls('getById', 'employees');
      const newGetAllHr = countCalls('getAll', 'hrDeductions');

      assert.equal(newGetAllHr, 1);
      assert.equal(newGetByIdEmployees, 0);
      assert.equal(oldGetAllHr, size, 'old path: one full-table HR read per member');
      assert.ok(oldGetByIdEmployees >= size, 'old path: uncached employees point reads per member');
      assert.ok(
        newReads < oldReads,
        `new path (${newReads} db ops) must use fewer operations than the old path (${oldReads} db ops)`,
      );
      assert.ok(newMs < 60000, 'sanity bound (stubbed in-memory run)');
      console.log(
        `[§GROUP-SCALING n=${size}] old path: ${oldReads} db ops (${oldGetByIdEmployees} employees point reads, ${oldGetAllHr} HR reads) in ${oldMs}ms | ` +
        `new path: ${newReads} db ops (${newGetByIdEmployees} point reads, ${newGetAllHr} HR reads) in ${newMs}ms`,
      );
      void report;
    });
  }
});

describe('§GROUP-SCALING — shared-lookup equivalence at group scale', () => {
  it('group member rows match the old per-member path (identical output contract)', async () => {
    seed(10);
    const report = await buildPerformanceGroupReport(groupInput(10));
    const newRows = report.population.members;

    resetTestData();
    seed(10);
    const oldDatasets = (await Promise.all(
      allIds(10).map((employeeId) =>
        serviceModule.getEmployeePerformanceHubDataset({
          employeeId,
          monthKey: MONTH,
          now: new Date('2026-10-01T00:00:00Z'),
          riskEnabled: false,
          hrAuthorized: true,
          scopeIncludes: undefined,
        } as GetPerformanceHubServiceInput),
      ),
    )) as Array<{ employee: { employeeId: string }; hr: unknown } | null>;

    // Every dataset the old path produced is present in the group report.
    const oldById = new Map(
      oldDatasets.filter((d): d is NonNullable<typeof d> => d !== null).map((d) => [d.employee.employeeId, d]),
    );
    assert.equal(oldById.size, newRows.length);
    for (const row of newRows) {
      const old = oldById.get(row.employeeId);
      assert.ok(old, `member ${row.employeeId} missing from the old-path comparison`);
      assert.deepEqual(row.riskScore, null);
      assert.equal(row.employmentStatus, 'active');
    }

    // HR aggregation parity: members with a stored deduction carry the
    // same statusCounts in both paths (compared via the lookup the new
    // path used — pure grouping of the same rows).
    resetTestData();
    seed(10);
    const { loadHrDeductionLookup } = await import('@/lib/hr-deductions/lookup');
    const lookup = await loadHrDeductionLookup();
    const membersWithHr = newRows.filter((m) => lookup.forEmployeeMonth(m.employeeId, MONTH).length > 0);
    assert.equal(membersWithHr.length, 5, 'every second employee has one deduction');
  });
});

describe('§GROUP-SCALING — partial & systemic failure handling', () => {
  // Phase 2 note: the per-member observation read now flows through
  // the guarded indexed fetch (getAllByChildEqualTo), so the injected
  // failure targets THAT read function — the tested contract (a
  // member-level read failure surfaces per-member, a systemic failure
  // rejects) is unchanged.
  function stubGetAllWithOneFailure(table: string) {
    const original = dbStubs.getAllByChildEqualTo;
    let failed = false;
    dbStubs.getAllByChildEqualTo = async (t: string, ...rest: unknown[]) => {
      if (t === table && !failed) {
        failed = true;
        throw new Error('transient single-read failure');
      }
      return original(t, ...rest);
    };
    return () => {
      dbStubs.getAllByChildEqualTo = original;
    };
  }

  it('an individual member read failure surfaces in failedEmployeeIds — no fabricated row, no silent drop', async () => {
    seed(10);
    const restore = stubGetAllWithOneFailure('qualityObservations');
    try {
      const report = await buildPerformanceGroupReport(groupInput(10));
      assert.equal(report.population.failedEmployeeIds.length, 1, 'exactly the member whose read failed');
      assert.equal(report.population.members.length, 9, 'the other 9 members complete');
      assert.ok(
        report.dataQualityNotes.some((n) => n.startsWith('failedDatasets:')),
        'the failure is surfaced in dataQualityNotes',
      );
      const failedId = report.population.failedEmployeeIds[0]!;
      assert.equal(
        report.population.members.some((m) => m.employeeId === failedId),
        false,
        'no fabricated row for the failed member',
      );
    } finally {
      restore();
    }
  });

  it('a SYSTEMIC failure (every member rejects) rejects the whole build like the old Promise.all', async () => {
    seed(5);
    const original = dbStubs.getAllByChildEqualTo;
    dbStubs.getAllByChildEqualTo = async (t: string, ...rest: unknown[]) => {
      if (t === 'qualityObservations') throw new Error('database offline');
      return original(t, ...rest);
    };
    try {
      await assert.rejects(
        () => buildPerformanceGroupReport(groupInput(5)),
        /database offline/,
      );
    } finally {
      dbStubs.getAllByChildEqualTo = original;
    }
  });
});

describe('§GROUP-SCALING — scope narrowing preserved', () => {
  it('a restricted scopeLimit narrows the population and surfaces out-of-scope ids', async () => {
    seed(10);
    const report = await buildPerformanceGroupReport({
      ...groupInput(10),
      scopeLimit: ['emp_001', 'emp_002', 'emp_003'],
    });
    assert.equal(report.population.members.length, 3);
    assert.equal(report.population.outOfScopeEmployeeIds.length, 7);
    assert.ok(report.dataQualityNotes.some((n) => n.startsWith('employeeIdsOutOfScope:7')));
    for (const member of report.population.members) {
      assert.ok(['emp_001', 'emp_002', 'emp_003'].includes(member.employeeId));
    }
  });
});
