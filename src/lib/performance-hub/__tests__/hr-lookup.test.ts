// ══════════════════════════════════════════════════════════════
//  §HR-LOOKUP — request-scoped hrDeductions index (Task B)
//
//  Proves the lookup is a pure REORGANIZATION of the exact same rows
//  the per-employee filter used to select:
//    • identical results for representative datasets (old pattern vs
//      lookup, compared element-by-element);
//    • employee scope isolation (A's rows never reach B's queries);
//    • month-boundary correctness (current vs previous vs outside);
//    • missing data stays "no data" (null block) — never zero-filled;
//    • no duplicates (each stored row appears exactly once);
//    • aggregation semantics unchanged (ALL statuses counted with
//      per-status breakdown, incl. pending — the Hub contract).
// ══════════════════════════════════════════════════════════════

import '../../__tests__/m01-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setTable, resetTestData } from '../../__tests__/m01-test-support';

import {
  buildHrDeductionLookup,
  loadHrDeductionLookup,
} from '@/lib/hr-deductions/lookup';
import type { HrDeductionRow } from '@/lib/hr-deductions/lookup';
import type { EmployeePerformanceHubDataset, GetPerformanceHubServiceInput } from '@/lib/performance-hub';

/** The EXACT per-employee selection the previous code performed. */
function legacySelect(rows: HrDeductionRow[], employeeId: string, monthKey: string): HrDeductionRow[] {
  const own = rows.filter((r) => r && r.employeeId === employeeId);
  return own.filter((r) => r.month === monthKey);
}

const MONTH = '2026-09';
const PREV = '2026-08';

const representativeRows: HrDeductionRow[] = [
  { id: 'h1', employeeId: 'emp_1', month: MONTH, amount: 2, unit: 'days', status: 'approved', type: 'late', deductionDate: '2026-09-03' },
  { id: 'h2', employeeId: 'emp_1', month: MONTH, amount: 100, unit: 'money', status: 'pending', type: 'absence', deductionDate: '2026-09-12' },
  { id: 'h3', employeeId: 'emp_1', month: PREV, amount: 1, unit: 'days', status: 'approved', type: 'late', deductionDate: '2026-08-20' },
  { id: 'h4', employeeId: 'emp_2', month: MONTH, amount: 3, unit: 'days', status: 'approved', type: 'absence', deductionDate: '2026-09-05' },
  { id: 'h5', employeeId: 'emp_2', month: '2026-07', amount: 1, unit: 'days', status: 'rejected', type: 'late', deductionDate: '2026-07-15' },
  { id: 'h6', employeeId: 'emp_1', month: MONTH, amount: 50, unit: 'money', status: 'approved', type: 'other', deductionDate: '2026-09-25' },
  // Legacy rows: no employeeId / no month — the old filter could never
  // match them to a queried employee either.
  { id: 'h7', employeeId: null, month: MONTH, amount: 9, unit: 'days', status: 'approved' },
  { id: 'h8', employeeId: 'emp_1', month: null, amount: 4, unit: 'days', status: 'approved' },
];

describe('§HR-LOOKUP — pure index semantics', () => {
  it('1 · returns EXACTLY the rows the legacy per-employee filter selected', () => {
    const lookup = buildHrDeductionLookup(representativeRows);
    for (const employeeId of ['emp_1', 'emp_2', 'emp_ghost']) {
      for (const monthKey of [MONTH, PREV, '2026-07', '2026-10']) {
        assert.deepEqual(
          lookup.forEmployeeMonth(employeeId, monthKey),
          legacySelect(representativeRows, employeeId, monthKey),
          `lookup must equal the legacy filter for (${employeeId}, ${monthKey})`,
        );
      }
    }
    assert.deepEqual(lookup.forEmployee('emp_1'), representativeRows.filter((r) => r.employeeId === 'emp_1'));
  });

  it('2 · preserves table-read order (no reordering, no dedup)', () => {
    const lookup = buildHrDeductionLookup(representativeRows);
    const emp1Current = lookup.forEmployeeMonth('emp_1', MONTH);
    assert.deepEqual(emp1Current.map((r) => r.id), ['h1', 'h2', 'h6']);
    // Duplicate-looking rows stay distinct — the lookup never dedups.
    const duplicated = buildHrDeductionLookup([
      { id: 'a', employeeId: 'e1', month: MONTH, amount: 1 },
      { id: 'b', employeeId: 'e1', month: MONTH, amount: 1 },
    ]);
    assert.equal(duplicated.forEmployeeMonth('e1', MONTH).length, 2);
  });

  it('3 · employee scope isolation — one employee never sees another\'s rows', () => {
    const lookup = buildHrDeductionLookup(representativeRows);
    for (const row of lookup.forEmployee('emp_1')) {
      assert.equal(row.employeeId, 'emp_1');
    }
    assert.equal(lookup.forEmployee('emp_2').some((r) => r.id === 'h1'), false);
    assert.equal(lookup.forEmployeeMonth('emp_1', MONTH).some((r) => r.id === 'h4'), false);
    assert.deepEqual(lookup.forEmployee('emp_unknown'), []);
  });

  it('4 · rows without a resolvable employeeId can never match any query', () => {
    const lookup = buildHrDeductionLookup(representativeRows);
    assert.equal(lookup.forEmployeeMonth('', MONTH).length, 0);
    assert.equal(lookup.size(), representativeRows.filter((r) => typeof r.employeeId === 'string' && r.employeeId.length > 0).length);
  });

  it('5 · missing data is absent, not zero — unknown employee/month → []', () => {
    const lookup = buildHrDeductionLookup(representativeRows);
    assert.deepEqual(lookup.forEmployeeMonth('emp_2', MONTH), [representativeRows[3]]);
    assert.deepEqual(lookup.forEmployeeMonth('emp_2', '2026-11'), []);
    assert.deepEqual(lookup.forEmployee('nobody'), []);
  });
});

describe('§HR-LOOKUP — hub service consumption (in-memory db)', () => {
  const serviceModule = {} as { getEmployeePerformanceHubDataset: (i: GetPerformanceHubServiceInput) => Promise<EmployeePerformanceHubDataset | null> };

  before(async () => {
    const mod = await import('@/lib/performance-hub');
    serviceModule.getEmployeePerformanceHubDataset = mod.getEmployeePerformanceHubDataset;
  });

  beforeEach(() => {
    resetTestData();
    setTable('employees', [
      { id: 'emp_1', name: 'أحمد', code: '001', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'emp_2', name: 'سارة', code: '002', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    setTable('hrDeductions', representativeRows);
    setTable('orgNodes', []);
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
  });

  it('6 · service WITHOUT a shared lookup (self-loaded) matches the legacy filter exactly', async () => {
    const dataset = await serviceModule.getEmployeePerformanceHubDataset({
      employeeId: 'emp_1',
      monthKey: MONTH,
      riskEnabled: false,
      hrAuthorized: true,
    });
    assert.ok(dataset, 'dataset must build');
    assert.ok(dataset.hr, 'HR block present when authorized');

    const legacyCurrent = legacySelect(representativeRows, 'emp_1', MONTH);
    const legacyPrev = legacySelect(representativeRows, 'emp_1', PREV);
    assert.ok(dataset.hr.current, 'current month has HR rows → present');
    assert.ok(dataset.hr.previous, 'previous month has HR rows → present');
    assert.equal(dataset.hr.current.deductionCount, legacyCurrent.length);
    assert.equal(dataset.hr.previous.deductionCount, legacyPrev.length);
  });

  it('7 · service WITH the shared lookup produces the IDENTICAL HR block', async () => {
    const shared = await loadHrDeductionLookup();
    const withShared = await serviceModule.getEmployeePerformanceHubDataset({
      employeeId: 'emp_1',
      monthKey: MONTH,
      riskEnabled: false,
      hrAuthorized: true,
      hrLookup: shared,
    });
    const selfLoaded = await serviceModule.getEmployeePerformanceHubDataset({
      employeeId: 'emp_1',
      monthKey: MONTH,
      riskEnabled: false,
      hrAuthorized: true,
    });
    assert.ok(withShared?.hr && selfLoaded?.hr);
    assert.ok(withShared.hr.current && selfLoaded.hr.current, 'current blocks present in both paths');
    assert.deepEqual(withShared.hr, selfLoaded.hr, 'shared lookup must be a pure reorganization');
    assert.deepEqual(withShared.hr.current.statusCounts, selfLoaded.hr.current.statusCounts);
    assert.deepEqual(withShared.hr.previous, selfLoaded.hr.previous);
  });

  it('8 · aggregation semantics unchanged — ALL statuses counted with breakdown (pending included)', async () => {
    const shared = await loadHrDeductionLookup();
    const dataset = await serviceModule.getEmployeePerformanceHubDataset({
      employeeId: 'emp_1',
      monthKey: MONTH,
      riskEnabled: false,
      hrAuthorized: true,
      hrLookup: shared,
    });
    assert.ok(dataset?.hr?.current);
    // h1 approved(days:2) + h2 pending(money:100) + h6 approved(money:50)
    assert.equal(dataset.hr.current.deductionCount, 3);
    assert.equal(dataset.hr.current.deductionDays, 2);
    assert.equal(dataset.hr.current.deductionAmount, 150);
    assert.equal(dataset.hr.current.statusCounts['approved'], 2);
    assert.equal(dataset.hr.current.statusCounts['pending'], 1, 'pending rows are counted, not silently dropped');
  });

  it('9 · month boundaries — current vs previous vs outside never bleed', async () => {
    const shared = await loadHrDeductionLookup();
    const dataset = await serviceModule.getEmployeePerformanceHubDataset({
      employeeId: 'emp_1',
      monthKey: MONTH,
      riskEnabled: false,
      hrAuthorized: true,
      hrLookup: shared,
    });
    assert.ok(dataset?.hr);
    assert.equal(dataset.hr.current?.deductionCount, 3); // MONTH rows only
    assert.equal(dataset.hr.previous?.deductionCount, 1); // PREV rows only
    // '2026-07' rows belong to neither period.
    const employee2026_07 = shared.forEmployeeMonth('emp_2', '2026-07');
    assert.equal(employee2026_07.length, 1);
  });

  it('10 · missing month data stays null — never converted to zero', async () => {
    const shared = await loadHrDeductionLookup();
    // emp_2 has NO rows in the previous month → previous block null.
    const dataset = await serviceModule.getEmployeePerformanceHubDataset({
      employeeId: 'emp_2',
      monthKey: MONTH,
      riskEnabled: false,
      hrAuthorized: true,
      hrLookup: shared,
    });
    assert.ok(dataset?.hr);
    assert.ok(dataset.hr.current, 'current month has rows → present');
    assert.equal(dataset.hr.previous, null, 'no rows for the previous month → null, never a zero block');
  });

  it('11 · HR rows are never read when the viewer is not authorized', async () => {
    const shared = await loadHrDeductionLookup();
    const dataset = await serviceModule.getEmployeePerformanceHubDataset({
      employeeId: 'emp_1',
      monthKey: MONTH,
      riskEnabled: false,
      hrAuthorized: false,
      hrLookup: shared,
    });
    assert.ok(dataset);
    assert.equal(dataset.hr, null, 'unauthorized viewer gets no HR block');
  });
});
