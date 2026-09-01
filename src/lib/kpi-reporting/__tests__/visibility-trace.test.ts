// ══════════════════════════════════════════════════════════════
//  Phase 6.3 — KPI Visibility Trace (spec §33-§37)
//
//  Maps to §49-D: employee WITH observations appears when eligible
//  (43), employee WITHOUT observations appears when eligible (44),
//  archived eligible historical employee (45), ineligible excluded
//  (46), employeeId relationship (47), month mismatch (48), scope
//  exclusion (16-style), scheme failure rows still exist (§36),
//  no KPI formula touched (51 — the trace computes NO values).
//  In-memory loaders — the project's no-Firebase-mocking convention.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { traceEmployeeKpiVisibility } from '../visibility-trace';
import type { KpiReportingLoaders, ReportEmployee } from '../../kpi-reporting/loaders';
import type { MonthSnapshot } from '@/types/quality-kpi';
import type { QualityObservation } from '@/types/quality-kpi';
import type { EmploymentEventLike } from '@/lib/kpi-framework/employee-result';
import type { KpiScheme, KpiSchemeOverride } from '@/lib/kpi-framework/types';

// ── In-memory world ──────────────────────────────────────────

const SCHEME: KpiScheme = {
  id: 'scheme-1',
  name: 'المخطط الافتراضي',
  version: 1,
  status: 'ACTIVE',
  isDefault: true,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  components: [
    { componentId: 'quality', name: 'الجودة', weight: 40, calculationType: 'quality_engine', owner: 'quality', status: 'ACTIVE' },
  ],
} as unknown as KpiScheme;

function makeEmployee(overrides: Partial<ReportEmployee> = {}): ReportEmployee {
  return {
    id: 'emp-1',
    code: 'E-001',
    name: 'أحمد تجريبي',
    department: 'الجودة',
    position: 'فني',
    status: 'active',
    hireDate: '2025-01-01',
    createdAt: '2025-01-01T00:00:00.000Z',
    archivedAt: null,
    orgNodeId: null,
    ...overrides,
  };
}

interface World {
  employees: ReportEmployee[];
  observations: QualityObservation[];
  events: Map<string, EmploymentEventLike[]>;
  schemes: KpiScheme[];
  overrides: KpiSchemeOverride[];
  monthDetail: MonthSnapshot | null;
}

function makeLoaders(world: Partial<World> = {}): KpiReportingLoaders {
  const w: World = {
    employees: [makeEmployee()],
    observations: [],
    events: new Map(),
    schemes: [SCHEME],
    overrides: [],
    monthDetail: null,
    ...world,
  };
  return {
    ...({} as KpiReportingLoaders), // the trace uses only the loaders below
    loadEmployeeRecord: async (id) => w.employees.find((e) => e.id === id) ?? null,
    loadEmployees: async () => w.employees,
    loadEmploymentEventsByEmployee: async () => w.events,
    loadSchemes: async () => w.schemes,
    loadOverrides: async () => w.overrides,
    loadMonthDetail: async () => w.monthDetail,
    loadObservations: async (monthKey: string) =>
      w.observations.filter((o) => o.month === monthKey),
  } as KpiReportingLoaders;
}

function obs(id: string, employeeId: string, month: string): QualityObservation {
  return { id, employeeId, month } as unknown as QualityObservation;
}

const MONTH = '2026-08';
const NOW = new Date('2026-08-20T10:00:00Z');
const UNRESTRICTED = { inScope: true, unrestricted: true };

describe('eligible employee — with or WITHOUT observations — appears (§36, §49-43/44)', () => {
  it('employee WITH observations → visible with a live row', async () => {
    const trace = await traceEmployeeKpiVisibility(
      { monthKey: MONTH, employeeId: 'emp-1', now: NOW },
      makeLoaders({
        observations: [obs('o1', 'emp-1', MONTH)],
        monthDetail: {
          id: MONTH,
          monthKey: MONTH,
          status: 'open',
          employeeScores: { 'emp-1': { score: 92 } },
        } as unknown as MonthSnapshot,
      }),
      UNRESTRICTED,
    );
    assert.equal(trace.wouldAppearInReport, true);
    assert.equal(trace.firstMissingLayer, null);
    assert.equal(trace.layers.find((l) => l.key === 'observations')?.ok, true);
    assert.match(trace.rowStatus ?? '', /LIVE/);
  });

  it('employee WITHOUT observations → STILL visible as PENDING (never hidden)', async () => {
    const trace = await traceEmployeeKpiVisibility(
      { monthKey: MONTH, employeeId: 'emp-1', now: NOW },
      makeLoaders(),
      UNRESTRICTED,
    );
    assert.equal(trace.wouldAppearInReport, true);
    assert.equal(trace.rowStatus, 'PENDING');
  });

  it('observations exist but in ANOTHER month → visible, zero observations this month (§49-48)', async () => {
    const trace = await traceEmployeeKpiVisibility(
      { monthKey: MONTH, employeeId: 'emp-1', now: NOW },
      makeLoaders({ observations: [obs('o1', 'emp-1', '2026-07')] }),
      UNRESTRICTED,
    );
    assert.equal(trace.wouldAppearInReport, true);
    assert.equal(trace.rowStatus, 'PENDING');
    assert.match(trace.layers[0].detail, /لا توجد ملاحظات/);
  });
});

describe('the FIRST disappearing layer is identified (§34, §49-47)', () => {
  it('observation employeeId matching NO employee record → employeeRecord layer', async () => {
    const trace = await traceEmployeeKpiVisibility(
      { monthKey: MONTH, employeeId: 'ghost-id', now: NOW },
      makeLoaders({ observations: [obs('o1', 'ghost-id', MONTH)] }),
      UNRESTRICTED,
    );
    assert.equal(trace.firstMissingLayer, 'employeeRecord');
    assert.equal(trace.wouldAppearInReport, false);
    assert.match(trace.verdict, /مفقود من جدول الموظفين/);
  });

  it('out-of-scope employee → scope layer (and out-of-scope ids get the generic answer at the route)', async () => {
    const trace = await traceEmployeeKpiVisibility(
      { monthKey: MONTH, employeeId: 'emp-1', now: NOW },
      makeLoaders(),
      { inScope: false, unrestricted: false },
    );
    assert.equal(trace.firstMissingLayer, 'scope');
    assert.equal(trace.wouldAppearInReport, false);
  });
});

describe('archive / restore compatibility (§40, §49-45/46)', () => {
  it('archived DURING the month → still eligible (employed part of it)', async () => {
    const trace = await traceEmployeeKpiVisibility(
      { monthKey: MONTH, employeeId: 'emp-1', now: NOW },
      makeLoaders({
        employees: [makeEmployee({ status: 'archived', archivedAt: '2026-08-15T00:00:00.000Z' })],
        events: new Map([['emp-1', [{ kind: 'archived', effectiveAt: '2026-08-15T00:00:00.000Z' }]]]),
        observations: [obs('o1', 'emp-1', MONTH)],
      }),
      UNRESTRICTED,
    );
    assert.equal(trace.wouldAppearInReport, true);
  });

  it('archived BEFORE the month with no restore → ineligible, excluded by DESIGN (no fake zero)', async () => {
    const trace = await traceEmployeeKpiVisibility(
      { monthKey: MONTH, employeeId: 'emp-1', now: NOW },
      makeLoaders({
        employees: [makeEmployee({ status: 'archived', archivedAt: '2026-05-01T00:00:00.000Z' })],
        events: new Map([['emp-1', [{ kind: 'archived', effectiveAt: '2026-05-01T00:00:00.000Z' }]]]),
        observations: [obs('o1', 'emp-1', MONTH)], // post-archive observations exist — reported, not judged
      }),
      UNRESTRICTED,
    );
    assert.equal(trace.firstMissingLayer, 'eligibility');
    assert.equal(trace.wouldAppearInReport, false);
  });

  it('archived then RESTORED → eligible again (multiple periods are first-class)', async () => {
    const trace = await traceEmployeeKpiVisibility(
      { monthKey: MONTH, employeeId: 'emp-1', now: NOW },
      makeLoaders({
        employees: [makeEmployee({ status: 'active' })],
        events: new Map([['emp-1', [
          { kind: 'archived', effectiveAt: '2026-05-01T00:00:00.000Z' },
          { kind: 'restored', effectiveAt: '2026-07-01T00:00:00.000Z' },
        ]]]),
      }),
      UNRESTRICTED,
    );
    assert.equal(trace.wouldAppearInReport, true);
  });

  it('hired AFTER the month → ineligible', async () => {
    const trace = await traceEmployeeKpiVisibility(
      { monthKey: MONTH, employeeId: 'emp-1', now: NOW },
      makeLoaders({
        employees: [makeEmployee({ hireDate: '2026-09-01', createdAt: '2026-09-01T00:00:00.000Z' })],
      }),
      UNRESTRICTED,
    );
    assert.equal(trace.firstMissingLayer, 'eligibility');
  });
});

describe('scheme resolution states (§35, §36)', () => {
  it('no scheme resolvable → the row STILL exists as NO_SCHEME (not a disappearance)', async () => {
    const trace = await traceEmployeeKpiVisibility(
      { monthKey: MONTH, employeeId: 'emp-1', now: NOW },
      makeLoaders({ schemes: [] }),
      UNRESTRICTED,
    );
    assert.equal(trace.wouldAppearInReport, true);
    assert.equal(trace.rowStatus, 'NO_SCHEME');
  });
});

describe('frozen months (§39, MTD/FINALIZED distinction)', () => {
  it('closed month with a frozen result → FINALIZED row', async () => {
    const trace = await traceEmployeeKpiVisibility(
      { monthKey: MONTH, employeeId: 'emp-1', now: NOW },
      makeLoaders({
        monthDetail: {
          id: MONTH,
          monthKey: MONTH,
          status: 'closed',
          kpiResults: { 'emp-1': { employeeId: 'emp-1' } },
          employeeScores: { 'emp-1': { score: 90 } },
        } as unknown as MonthSnapshot,
      }),
      UNRESTRICTED,
    );
    assert.equal(trace.valueBasis, 'FINALIZED');
    assert.equal(trace.rowStatus, 'FINALIZED');
    assert.equal(trace.wouldAppearInReport, true);
  });

  it('open current month → MTD basis', async () => {
    const trace = await traceEmployeeKpiVisibility(
      { monthKey: '2026-08', employeeId: 'emp-1', now: new Date('2026-08-20T10:00:00Z') },
      makeLoaders(),
      UNRESTRICTED,
    );
    assert.equal(trace.valueBasis, 'MTD');
  });
});

describe('diagnostic purity (§1/§51 — the trace computes NO KPI values)', () => {
  it('never produces scores or contributions — only layer verdicts', async () => {
    const trace = await traceEmployeeKpiVisibility(
      { monthKey: MONTH, employeeId: 'emp-1', now: NOW },
      makeLoaders({ observations: [obs('o1', 'emp-1', MONTH)] }),
      UNRESTRICTED,
    );
    const serialized = JSON.stringify(trace);
    assert.ok(!serialized.includes('rawScore'));
    assert.ok(!serialized.includes('weightedContribution'));
    assert.ok(!serialized.includes('deductionPoints'));
  });
});
