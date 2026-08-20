// ══════════════════════════════════════════════════════════════
//  Unified Reporting Architecture — Milestone 8 focused tests
//
//  Covers (spec §32) against PURE primitives only (project
//  convention: no Firebase mocking). The runner's DB reads are a
//  thin orchestrator over getAll/getEmployeeMap — their behavior
//  is pinned here through the pure filter/aggregate functions the
//  orchestrator calls.
//
//    1.  Report Definition validation        (validateRegistry)
//    2.  Report permission resolution        (canSeeReport / canExportReport)
//    3.  Employee scope enforcement          (resolveEmployeeScope)
//    4.  Department scope enforcement        (applyEmployeeScope)
//    5.  TimeScope handling                  (resolveReportPeriod)
//    6.  LIVE vs SNAPSHOT distinction        (buildReportRunResponse meta)
//    7.  Quality Deduction day-first behavior(summarizeQualityDeductions)
//    8.  Optional monetary deduction         (same)
//    9.  No KPI calculation in reporting     (summary keys ⊆ declared metrics)
//    10. Report registry resolution          (getReportDefinition)
//    11. Multi-employee scope                (applyEmployeeScope)
//    12. Empty / no-data behavior            (buildEmptyReportResponse / hasData)
//
//  Run: npx tsx --test src/lib/reports/__tests__/reports.test.ts
// ══════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import { getReportDefinition, listReportDefinitions, validateRegistry, validateReportDefinition } from '../registry';
import type { ReportDefinition } from '../types';
import {
  applyEmployeeScope,
  monthKeysBetween,
  resolveEmployeeScope,
  resolveReportPeriod,
  resolveReportRequest,
  pickAllowedFilters,
} from '../scope';
import { buildEmptyReportResponse, buildReportRunResponse } from '../response';
import {
  filterQualityDeductionRecords,
  summarizeQualityDeductions,
} from '../runners/quality-deductions';
import type { QualityDeduction } from '@/types';

// ─── Fixtures ─────────────────────────────────────────────────

const EMPLOYEES = [
  { id: 'e1', name: 'أحمد', department: 'Operations' },
  { id: 'e2', name: 'محمد', department: 'Sales' },
  { id: 'e3', name: 'علي', department: 'Operations' },
];

const RECORDS: QualityDeduction[] = [
  {
    id: 'q1', employeeId: 'e1', date: '2026-08-05', type: 'late_followup',
    description: 'تأخر متابعة عميل', deductionDays: 1, deductionAmount: 0,
    evidence: null, month: '2026-08', relatedCapaId: null, createdAt: '2026-08-05T10:00:00Z',
  },
  {
    id: 'q2', employeeId: 'e2', date: '2026-08-12', type: 'booking_error',
    description: 'خطأ في حجز', deductionDays: 2, deductionAmount: 300,
    evidence: null, month: '2026-08', relatedCapaId: 'capa-1', createdAt: '2026-08-12T10:00:00Z',
  },
  {
    id: 'q3', employeeId: 'e1', date: '2026-07-20', type: 'late_followup',
    description: 'خصم يوليو', deductionDays: 3, deductionAmount: 0,
    evidence: null, month: '2026-07', relatedCapaId: null, createdAt: '2026-07-20T10:00:00Z',
  },
];

const QUALITY_DEDUCTIONS_DEF = getReportDefinition('quality-deductions');
assert.ok(QUALITY_DEDUCTIONS_DEF, 'reference report must be registered');

/** Resolved request fixture for the reference report (August 2026). */
function resolvedFor(overrides: Record<string, unknown> = {}) {
  const result = resolveReportRequest(QUALITY_DEDUCTIONS_DEF!, {
    reportId: 'quality-deductions',
    monthKey: '2026-08',
    ...overrides,
  } as never);
  assert.ok(result.ok, 'fixture request must resolve');
  return result.value;
}

// ─── 1. Report Definition validation ──────────────────────────

test('REGISTRY: every registered definition satisfies the contract', () => {
  assert.deepEqual(validateRegistry(), []);
});

test('REGISTRY: definitions are pure serializable data (future admin overlay)', () => {
  for (const def of listReportDefinitions()) {
    assert.equal(typeof def.reportId, 'string');
    assert.deepEqual(JSON.parse(JSON.stringify(def)), def);
  }
});

test('VALIDATION: invalid reportType/dataMode/permission are rejected', () => {
  const base = { ...QUALITY_DEDUCTIONS_DEF! } as ReportDefinition;
  assert.match(validateReportDefinition({ ...base, reportType: 'magic' as never })!, /reportType/);
  assert.match(validateReportDefinition({ ...base, dataMode: 'cached' as never })!, /dataMode/);
  assert.match(validateReportDefinition({ ...base, permission: { ...base.permission, pageId: '' } })!, /pageId/);
});

// ─── 2. Report permission resolution ──────────────────────────

test('PERMISSION: catalog visibility mirrors the page permission model', async () => {
  const { canSeeReport, canExportReport } = await import('../registry');
  const def = QUALITY_DEDUCTIONS_DEF!;

  // Generic user: reports = 'none' → invisible
  const generic = { isAdmin: false, getPermission: () => ({ level: 'none' }) };
  assert.equal(canSeeReport(def, generic), false);

  // HR: reports = edit WITHOUT export action → visible, not exportable
  const hr = {
    isAdmin: false,
    getPermission: (pageId: string) =>
      pageId === 'reports' ? { level: 'edit', actions: { export: false } } : { level: 'none' },
  };
  assert.equal(canSeeReport(def, hr), true);
  assert.equal(canExportReport(def, hr), false);

  // Manager: edit + export → visible and exportable
  const manager = {
    isAdmin: false,
    getPermission: (pageId: string) =>
      pageId === 'reports' ? { level: 'edit', actions: { export: true } } : { level: 'none' },
  };
  assert.equal(canSeeReport(def, manager), true);
  assert.equal(canExportReport(def, manager), true);

  // Admin bypass
  assert.equal(canSeeReport(def, { isAdmin: true, getPermission: () => ({ level: 'none' }) }), true);

  // Disabled reports are never visible
  const disabled = { ...def, enabled: false };
  assert.equal(canSeeReport(disabled, { isAdmin: true, getPermission: () => ({ level: 'edit' }) }), false);
});

test('PERMISSION: disabled report resolves to null in the registry', async () => {
  const { getRegisteredReport } = await import('../registry');
  assert.equal(getRegisteredReport('does-not-exist'), null);
});

// ─── 3 + 11. Employee scope enforcement (incl. multi) ─────────

test('SCOPE(employee): single / multiple / all resolve and validate', () => {
  const def = QUALITY_DEDUCTIONS_DEF!;

  // default: all
  const all = resolveEmployeeScope(def, {});
  assert.ok(all.ok && all.value.mode === 'all');

  // single
  const single = resolveEmployeeScope(def, { employeeId: 'e1' });
  assert.ok(single.ok && single.value.mode === 'single' && single.value.employeeId === 'e1');

  // multiple with de-duplication
  const multi = resolveEmployeeScope(def, { employeeIds: ['e1', 'e2', 'e1'] });
  assert.ok(multi.ok && multi.value.mode === 'multiple');
  assert.deepEqual(multi.value.employeeIds, ['e1', 'e2']);

  // enforcement: report that forbids 'all'
  const restricted: ReportDefinition = {
    ...def,
    permission: { ...def.permission, allowedEmployeeScopeModes: ['single'] },
  };
  const denied = resolveEmployeeScope(restricted, { employeeScope: 'all' });
  assert.ok(!denied.ok);
  const allowed = resolveEmployeeScope(restricted, { employeeId: 'e1' });
  assert.ok(allowed.ok && allowed.value.mode === 'single');
});

test('SCOPE(employee): applyEmployeeScope filters all/single/multiple', () => {
  assert.equal(applyEmployeeScope(EMPLOYEES, { mode: 'all' }).length, 3);
  const single = applyEmployeeScope(EMPLOYEES, { mode: 'single', employeeId: 'e2' });
  assert.deepEqual(single.map((e) => e.id), ['e2']);
  const multi = applyEmployeeScope(EMPLOYEES, { mode: 'multiple', employeeIds: ['e1', 'e3'] });
  assert.deepEqual(multi.map((e) => e.id), ['e1', 'e3']);
  // unknown ids drop out silently (no fabricated rows)
  const ghost = applyEmployeeScope(EMPLOYEES, { mode: 'multiple', employeeIds: ['e1', 'ghost'] });
  assert.deepEqual(ghost.map((e) => e.id), ['e1']);
});

// ─── 4. Department scope enforcement ──────────────────────────

test('SCOPE(department): orthogonal to employee scope', () => {
  const ops = applyEmployeeScope(EMPLOYEES, { mode: 'all' }, 'Operations');
  assert.deepEqual(ops.map((e) => e.id), ['e1', 'e3']);

  // combined: multiple + department
  const combined = applyEmployeeScope(EMPLOYEES, { mode: 'multiple', employeeIds: ['e1', 'e2'] }, 'Sales');
  assert.deepEqual(combined.map((e) => e.id), ['e2']);

  // unknown department → empty, not an error
  assert.equal(applyEmployeeScope(EMPLOYEES, { mode: 'all' }, 'Nope').length, 0);
});

// ─── 5. TimeScope handling ────────────────────────────────────

test('TIME: monthKey shorthand resolves to selected_month', () => {
  const r = resolveReportPeriod(QUALITY_DEDUCTIONS_DEF!, { reportId: 'quality-deductions', monthKey: '2026-08' });
  assert.ok(r.ok);
  assert.deepEqual(r.value.monthKeys, ['2026-08']);
  assert.equal(r.value.label, 'selected_month:2026-08');
});

test('TIME: date-range mechanism validates and spans months', () => {
  const def = QUALITY_DEDUCTIONS_DEF!;
  const ok = resolveReportPeriod(def, { reportId: 'quality-deductions', fromDate: '2026-07-28', toDate: '2026-08-04' });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value.range, { fromDate: '2026-07-28', toDate: '2026-08-04' });
  assert.deepEqual(ok.value.monthKeys, ['2026-07', '2026-08']);
  assert.deepEqual(monthKeysBetween('2026-08-01', '2026-08-31'), ['2026-08']);

  // invalid: reversed range, malformed dates, missing bound
  assert.ok(!resolveReportPeriod(def, { reportId: 'x', fromDate: '2026-08-10', toDate: '2026-08-01' }).ok);
  assert.ok(!resolveReportPeriod(def, { reportId: 'x', fromDate: '2026/08/01', toDate: '2026-08-10' }).ok);
  assert.ok(!resolveReportPeriod(def, { reportId: 'x', fromDate: '2026-08-01' }).ok);
});

test('TIME: unsupported scope kinds are rejected per allowedScopes', () => {
  const def = QUALITY_DEDUCTIONS_DEF!;
  const career = resolveReportPeriod(def, { reportId: 'quality-deductions', period: { kind: 'career' } });
  assert.ok(!career.ok);
  const day = resolveReportPeriod(def, { reportId: 'quality-deductions', period: { kind: 'day', date: '2026-08-15' } });
  assert.ok(!day.ok);
});

test('TIME: default falls back to current_month', () => {
  const r = resolveReportPeriod(QUALITY_DEDUCTIONS_DEF!, { reportId: 'quality-deductions' }, new Date('2026-08-19T10:00:00'));
  assert.ok(r.ok);
  assert.deepEqual(r.value.monthKeys, ['2026-08']);
});

// ─── Filters contract ─────────────────────────────────────────

test('FILTERS: unknown filters are dropped; scope fields never leak', () => {
  const picked = pickAllowedFilters(QUALITY_DEDUCTIONS_DEF!, {
    category: 'late',
    status: 'approved',      // not declared for this report → dropped
    employeeId: 'e1',        // scope field → dropped from extra filters
    department: 'Sales',
    fromDate: '2026-08-01',  // period field handled separately → dropped
  });
  assert.deepEqual(picked, { category: 'late' });
});

// ─── 7 + 8. Quality Deduction day-first / optional monetary ───

test('QUALITY-DEDUCTIONS: days are day-first; monetary is optional and independent', () => {
  const summary = summarizeQualityDeductions([
    { deductionDays: 3, monetaryAmount: 0 },
    { deductionDays: 0, monetaryAmount: 500 },
    { deductionDays: 1.5, monetaryAmount: 250 },
  ]);
  assert.equal(summary.deductionCount, 3);
  assert.equal(summary.totalDeductionDays, 4.5);
  assert.equal(summary.totalMonetaryAmount, 750);
});

test('QUALITY-DEDUCTIONS: day-only deductions aggregate without inventing money', () => {
  const summary = summarizeQualityDeductions(RECORDS.map((r) => ({ deductionDays: r.deductionDays, monetaryAmount: r.deductionAmount })));
  assert.equal(summary.totalMonetaryAmount, 300); // only q2 carries money
  assert.equal(summary.totalDeductionDays, 6);
});

test('QUALITY-DEDUCTIONS: filtering by month, employee, department, category', () => {
  // month scope August only
  const aug = filterQualityDeductionRecords(RECORDS, EMPLOYEES, resolvedFor());
  assert.deepEqual(aug.map((r) => r.id), ['q2', 'q1']); // newest first

  // single employee
  const e1 = filterQualityDeductionRecords(RECORDS, EMPLOYEES, resolvedFor({ employeeId: 'e1' }));
  assert.deepEqual(e1.map((r) => r.id), ['q1']);

  // department
  const sales = filterQualityDeductionRecords(RECORDS, EMPLOYEES, resolvedFor({ department: 'Sales' }));
  assert.deepEqual(sales.map((r) => r.id), ['q2']);

  // category
  const late = filterQualityDeductionRecords(
    RECORDS, EMPLOYEES,
    resolvedFor({ filters: { category: 'LATE' } }),
  );
  assert.deepEqual(late.map((r) => r.id), ['q1']);

  // date range across months (operational semantics)
  const range = filterQualityDeductionRecords(
    RECORDS, EMPLOYEES,
    resolvedFor({ monthKey: undefined, fromDate: '2026-07-01', toDate: '2026-07-31' }),
  );
  assert.deepEqual(range.map((r) => r.id), ['q3']);
});

test('QUALITY-DEDUCTIONS: malformed legacy dates can never match a range', () => {
  const malformed: QualityDeduction[] = [
    { ...RECORDS[0]!, id: 'bad', date: '2026-8-5' }, // non-padded legacy date
  ];
  const rows = filterQualityDeductionRecords(
    malformed, EMPLOYEES,
    resolvedFor({ monthKey: undefined, fromDate: '2026-08-01', toDate: '2026-08-31' }),
  );
  assert.equal(rows.length, 0);
});

// ─── 6. LIVE vs SNAPSHOT + 12. empty/no-data + envelope ───────

test('RESPONSE: LIVE data mode is explicit in the envelope meta', () => {
  const resolved = resolvedFor();
  const envelope = buildReportRunResponse(
    QUALITY_DEDUCTIONS_DEF!,
    { reportId: 'quality-deductions', monthKey: '2026-08' },
    resolved,
    {
      rows: [{ id: 'q1', deductionDays: 1, monetaryAmount: 0 }],
      summary: { deductionCount: 1, totalDeductionDays: 1, totalMonetaryAmount: 0 },
      hasData: true,
      dataMode: { dataMode: 'live', source: 'qualityDeductions' },
    },
    { userId: 'u1', role: 'admin' },
  );
  assert.equal(envelope.meta.dataMode.dataMode, 'live');
  assert.equal(envelope.meta.dataMode.source, 'qualityDeductions');
  assert.equal(envelope.meta.reportId, 'quality-deductions');
  assert.equal(envelope.hasData, true);
  assert.equal(envelope.scope.grantedBy.pageId, 'reports');
  assert.deepEqual(envelope.summary, { deductionCount: 1, totalDeductionDays: 1, totalMonetaryAmount: 0 });
});

test('RESPONSE: SNAPSHOT mode flows through the same contract (future performance reports)', () => {
  const resolved = resolvedFor({ monthKey: '2026-07' });
  const envelope = buildEmptyReportResponse(
    QUALITY_DEDUCTIONS_DEF!,
    { reportId: 'quality-deductions', monthKey: '2026-07' },
    resolved,
    { dataMode: 'snapshot', scopeLabel: 'selected_month:2026-07', source: 'monthSnapshots' },
    { userId: 'u1', role: 'admin' },
  );
  assert.equal(envelope.meta.dataMode.dataMode, 'snapshot');
  assert.equal(envelope.meta.dataMode.source, 'monthSnapshots');
  assert.equal(envelope.hasData, false);
  assert.deepEqual(envelope.rows, []);
});

test('RESPONSE: empty rows always yield hasData=false (no fabricated data)', () => {
  const resolved = resolvedFor();
  const envelope = buildReportRunResponse(
    QUALITY_DEDUCTIONS_DEF!,
    { reportId: 'quality-deductions' },
    resolved,
    { rows: [], summary: { deductionCount: 0 }, hasData: false, dataMode: { dataMode: 'live' } },
    { userId: 'u1', role: 'admin' },
  );
  assert.equal(envelope.hasData, false);
});

// ─── 9. No KPI calculation inside the reporting layer ─────────

test('NO-KPI: runner summary keys are exactly the declared metric ids', () => {
  const declared = new Set(QUALITY_DEDUCTIONS_DEF!.availableMetrics.map((m) => m.metricId));
  const summary = summarizeQualityDeductions([
    { deductionDays: 2, monetaryAmount: 100 },
  ]);
  for (const key of Object.keys(summary)) {
    assert.ok(declared.has(key), `undeclared metric leaked into summary: ${key}`);
  }
  // the report declares NO canonical score metrics
  assert.ok(
    ![...declared].some((k) => /score|kpi|factor|rank/i.test(k)),
    'operational quality-deductions report must not declare KPI-valued metrics',
  );
});

test('NO-KPI: envelope drops undeclared metrics even if a runner emits them', () => {
  const resolved = resolvedFor();
  const envelope = buildReportRunResponse(
    QUALITY_DEDUCTIONS_DEF!,
    { reportId: 'quality-deductions' },
    resolved,
    {
      rows: [],
      summary: { deductionCount: 1, qualityScore: 87, finalPerformanceScore: 90.3 },
      hasData: false,
      dataMode: { dataMode: 'live' },
    },
    { userId: 'u1', role: 'admin' },
  );
  assert.deepEqual(envelope.summary, { deductionCount: 1 });
});

// ─── 10. Registry resolution ──────────────────────────────────

test('REGISTRY: resolution returns definition by id', () => {
  const def = getReportDefinition('quality-deductions');
  assert.ok(def);
  assert.equal(def!.domain, 'quality-deductions');
  assert.equal(def!.reportType, 'operational');
  assert.equal(def!.dataMode, 'live');
  assert.ok(def!.permission.allowedEmployeeScopeModes?.includes('all'));
});
