// ══════════════════════════════════════════════════════════════
//  Phase 1 — Configurable KPI Framework regression tests
//
//  Covers the 16 mandatory Phase-1 scenarios:
//    1.  Valid 15/15/10/60 scheme
//    2.  Invalid total weight (activation blocked)
//    3.  Quality raw score preserved (0–100, never replaced)
//    4.  Quality weighted contribution calculated correctly
//    5.  Quality-only data produces INCOMPLETE company KPI
//    6.  Missing component is NOT treated as zero
//    7.  No weight redistribution
//    8.  Employee-specific scheme override (incl. fail-safe)
//    9.  Default scheme resolution
//    10. Scheme version change (v1 → v2)
//    11. Historical result remains tied to the old version
//    12. Effective date behavior
//    13. Archived employee handling (no artificial zero)
//    14. Unauthorized access (route permission-gate contracts)
//    15. No undefined values written to Firebase
//    16. Existing Quality KPI engine untouched (dependency direction)
//
//  Pure-function convention: no Firebase mocking. The db-bound
//  pipelines are exercised through their injectable loaders (the
//  project's established DI pattern, same as employee-performance).
//
//  Run: npx tsx --test src/lib/kpi-framework/__tests__/kpi-framework.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  // validation
  validateSchemeWeightTotal,
  validateSchemeComponents,
  validateSchemeInput,
  validateEffectiveWindow,
  schemeCoversPeriod,
  findConflictingActiveSchemes,
  stripUndefinedForRtdb,
  monthDayRange,
  activeComponentsWeightTotal,
  // resolution
  resolveSchemeForEmployee,
  // adapter + aggregator
  buildQualityComponentResult,
  aggregateEmployeeKpi,
  // service (pure + DI)
  buildEmployeeKpiResult,
  withFinalizedAt,
  isEmployeeEligibleForPeriod,
  computeEmployeeKpiResultWithLoaders,
  buildMonthKpiResultsWithLoaders,
  DEFAULT_KPI_SCHEME_COMPONENTS,
  DEFAULT_KPI_SCHEME_ID,
  KPI_FRAMEWORK_CALCULATION_VERSION,
} from '@/lib/kpi-framework';
import type {
  KpiScheme,
  KpiSchemeComponent,
  EmployeeKpiResult,
} from '@/lib/kpi-framework';
import type { EmployeeResultLoaders, KpiMonthResultsLoaders } from '@/lib/kpi-framework';
import type { EmployeeScoreEntry, MonthSnapshot } from '@/types/quality-kpi';
import {
  buildClosedSnapshot,
  buildReclosedSnapshot,
  buildLivePreview,
} from '@/lib/month-snapshots';
import { computeEmployeeScore } from '@/lib/metrics/kpiMetrics';
import type { KpiSettings } from '@/types/quality-kpi';

// ─────────────────────────────────────────────────────────────
//  Fixtures
// ─────────────────────────────────────────────────────────────

const NOW = new Date('2026-09-01T10:00:00.000Z');
const ACTOR = { id: 'admin-1', name: 'مدير النظام' };

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
  updatedAt: NOW.toISOString(),
};

function makeComponent(overrides: Partial<KpiSchemeComponent> = {}): KpiSchemeComponent {
  return {
    componentId: 'quality',
    name: 'الجودة',
    weight: 15,
    owner: 'quality',
    calculationType: 'quality_engine',
    status: 'ACTIVE',
    configuration: null,
    ...overrides,
  };
}

/** The current company structure as a scheme: Quality 15 / Manager 15 / HR 10 / Target 60. */
function makeScheme(overrides: Partial<KpiScheme> = {}): KpiScheme {
  return {
    id: 'scheme_v1',
    schemaVersion: 1,
    name: 'نظام مؤشرات الأداء — 2026',
    description: null,
    status: 'ACTIVE',
    version: 1,
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    isDefault: true,
    applicableDepartments: null,
    components: [
      makeComponent(),
      makeComponent({ componentId: 'direct_manager', name: 'المدير المباشر', weight: 15, owner: 'management', calculationType: 'none' }),
      makeComponent({ componentId: 'hr', name: 'الموارد البشرية', weight: 10, owner: 'hr', calculationType: 'none' }),
      makeComponent({ componentId: 'target', name: 'المستهدف', weight: 60, owner: 'management', calculationType: 'none' }),
    ],
    previousSchemeId: null,
    createdBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeScoreEntry(employeeId: string, score: number): EmployeeScoreEntry {
  return {
    employeeSnapshot: {
      employeeId,
      employeeName: `موظف ${employeeId}`,
      departmentId: 'المبيعات',
      departmentName: 'المبيعات',
      position: 'مندوب',
      supervisorId: null,
    },
    score,
    deductionPoints: 100 - score,
    bonusPoints: 0,
    weightedPoints: 100 - score,
    observationCount: 3,
    approvedCount: 3,
    pendingCount: 0,
    rejectedCount: 0,
    categoryTotals: { late_followup: 100 - score },
    rank: 1,
    dept: 'المبيعات',
  };
}

function makeEmployeeResultLoaders(
  overrides: Partial<EmployeeResultLoaders> = {},
): EmployeeResultLoaders {
  return {
    loadEmployee: async () => ({ id: 'emp1', name: 'موظف تجريبي', department: 'المبيعات' }),
    loadEmploymentEvents: async () => [],
    loadSchemes: async () => [makeScheme()],
    loadOverrides: async () => [],
    loadSnapshot: async () => null,
    loadLiveQualityScore: async () => ({
      score: 88,
      deductionPoints: 12,
      bonusPoints: 0,
      observationCount: 3,
    }),
    ...overrides,
  };
}

function makeMonthLoaders(overrides: Partial<KpiMonthResultsLoaders> = {}): KpiMonthResultsLoaders {
  return {
    loadEmployees: async () => [
      { id: 'emp1', name: 'موظف أ', department: 'المبيعات' },
      { id: 'emp2', name: 'موظف ب', department: 'المبيعات' },
    ],
    loadEmploymentEventsByEmployee: async () => new Map(),
    loadSchemes: async () => [makeScheme()],
    loadOverrides: async () => [],
    ...overrides,
  };
}

/** Deep-scan a value for any `undefined` (the RTDB-illegal value). */
function findUndefined(value: unknown, probe = ''): string | null {
  if (value === undefined) return probe || '<root>';
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findUndefined(value[i], `${probe}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const hit = findUndefined(v, probe ? `${probe}.${k}` : k);
      if (hit) return hit;
    }
    return null;
  }
  return null;
}

function makeComputedPayload(
  monthKey: string,
  kpiResults: Record<string, EmployeeKpiResult>,
): Omit<MonthSnapshot, 'id'> {
  return {
    schemaVersion: 1,
    monthKey,
    status: 'closed',
    closedAt: null,
    closedBy: null,
    closedByName: null,
    reopenCount: 0,
    reopenReason: '',
    auditLog: [],
    generatedAt: NOW.toISOString(),
    settingsSnapshot: SETTINGS,
    employeeScores: { emp1: makeScoreEntry('emp1', 88) },
    departmentScores: {},
    topEmployees: [],
    bottomEmployees: [],
    categoryTotals: {},
    approvalStats: { total: 3, pending: 0, approved: 3, rejected: 0, avgApprovalHours: 0 },
    kpiResults,
  };
}

// ─────────────────────────────────────────────────────────────
//  1 & 2 — Weight validation (the 100% rule)
// ─────────────────────────────────────────────────────────────

describe('Phase 1 — scheme weight validation', () => {
  it('1. accepts the valid 15/15/10/60 company scheme', () => {
    const check = validateSchemeWeightTotal(DEFAULT_KPI_SCHEME_COMPONENTS);
    assert.equal(check.valid, true);
    assert.equal(activeComponentsWeightTotal(DEFAULT_KPI_SCHEME_COMPONENTS), 100);

    const scheme = makeScheme();
    assert.equal(validateSchemeWeightTotal(scheme.components).valid, true);
    // The seeded default scheme id is deterministic (idempotent seed).
    assert.equal(DEFAULT_KPI_SCHEME_ID, 'arm_default_scheme_v1');
  });

  it('2. rejects an invalid total weight (20/20/10/60 = 110)', () => {
    const invalid = [
      makeComponent({ weight: 20 }),
      makeComponent({ componentId: 'direct_manager', name: 'المدير المباشر', weight: 20, owner: 'management', calculationType: 'none' }),
      makeComponent({ componentId: 'hr', name: 'الموارد البشرية', weight: 10, owner: 'hr', calculationType: 'none' }),
      makeComponent({ componentId: 'target', name: 'المستهدف', weight: 60, owner: 'management', calculationType: 'none' }),
    ];
    const check = validateSchemeWeightTotal(invalid);
    assert.equal(check.valid, false);
    assert.match(check.error ?? '', /100/);

    // INACTIVE components do not count toward the total.
    const withInactive = [
      ...invalid,
      makeComponent({ componentId: 'extra', name: 'إضافي', weight: 0, status: 'INACTIVE' }),
    ];
    assert.equal(activeComponentsWeightTotal(withInactive), 110);
  });

  it('validates component shape (duplicates, ranges, enums)', () => {
    assert.equal(validateSchemeComponents([]).valid, false);
    assert.equal(
      validateSchemeComponents([makeComponent(), makeComponent()]).valid,
      false,
      'duplicate componentId must be rejected',
    );
    assert.equal(
      validateSchemeComponents([makeComponent({ weight: 150 })]).valid,
      false,
      'weight > 100 must be rejected',
    );
    assert.equal(
      validateSchemeComponents([makeComponent({ owner: 'nobody' as never })]).valid,
      false,
      'unknown owner must be rejected',
    );
    const ok = validateSchemeInput({
      name: 'نظام تجريبي',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      components: [makeComponent()],
    });
    assert.equal(ok.valid, true);
  });
});

// ─────────────────────────────────────────────────────────────
//  3 & 4 — Quality adapter: raw score preserved, contribution correct
// ─────────────────────────────────────────────────────────────

describe('Phase 1 — quality adapter', () => {
  it('3. preserves the raw 0–100 quality score verbatim', () => {
    const result = buildQualityComponentResult({
      component: { componentId: 'quality', name: 'الجودة', weight: 15, owner: 'quality' },
      qualityScore: { score: 88, deductionPoints: 12, bonusPoints: 0, observationCount: 3 },
      origin: 'live_engine',
    });
    assert.equal(result.rawScore, 88);
    assert.equal(result.status, 'AVAILABLE');
    // Evidence references the producing engine.
    assert.equal(result.evidence?.source, 'quality_engine');
    assert.equal(result.evidence?.observationCount, 3);
  });

  it('4. computes the weighted contribution from the CONFIGURED weight (88 × 15% = 13.2)', () => {
    const result = buildQualityComponentResult({
      component: { componentId: 'quality', name: 'الجودة', weight: 15, owner: 'quality' },
      qualityScore: { score: 88, deductionPoints: 12, bonusPoints: 0, observationCount: 3 },
      origin: 'live_engine',
    });
    assert.equal(result.weightedContribution, 13.2);
    assert.equal(result.maxContribution, 15);

    // The weight is configurable — a 20% scheme yields 17.6, proving
    // "Quality = 15%" is NOT hardcoded anywhere in the framework.
    const alt = buildQualityComponentResult({
      component: { componentId: 'quality', name: 'الجودة', weight: 20, owner: 'quality' },
      qualityScore: { score: 88 },
      origin: 'live_engine',
    });
    assert.equal(alt.weightedContribution, 17.6);
  });

  it('marks a computed zero as ZERO (real data, not missing) and absence as PENDING', () => {
    const zero = buildQualityComponentResult({
      component: { componentId: 'quality', name: 'الجودة', weight: 15, owner: 'quality' },
      qualityScore: { score: 0, deductionPoints: 100, bonusPoints: 0, observationCount: 2 },
      origin: 'month_snapshot',
    });
    assert.equal(zero.status, 'ZERO');
    assert.equal(zero.rawScore, 0);
    assert.equal(zero.weightedContribution, 0);

    const missing = buildQualityComponentResult({
      component: { componentId: 'quality', name: 'الجودة', weight: 15, owner: 'quality' },
      qualityScore: null,
      origin: 'live_engine',
    });
    assert.equal(missing.status, 'PENDING');
    assert.equal(missing.rawScore, null);
    assert.equal(missing.weightedContribution, null);
  });
});

// ─────────────────────────────────────────────────────────────
//  5, 6 & 7 — Aggregator: INCOMPLETE, no zero-fill, no redistribution
// ─────────────────────────────────────────────────────────────

describe('Phase 1 — aggregator', () => {
  const scheme = makeScheme();

  it('5. quality-only data produces an INCOMPLETE company KPI (13.2 / 15 available of 100)', () => {
    const quality = buildQualityComponentResult({
      component: { componentId: 'quality', name: 'الجودة', weight: 15, owner: 'quality' },
      qualityScore: { score: 88, deductionPoints: 12, bonusPoints: 0, observationCount: 3 },
      origin: 'live_engine',
    });
    const result = aggregateEmployeeKpi({
      scheme,
      employeeId: 'emp1',
      period: '2026-08',
      componentResults: [quality],
    });

    assert.equal(result.overallStatus, 'INCOMPLETE');
    assert.equal(result.weightedTotal, 13.2);
    assert.equal(result.availableWeight, 15);
    assert.equal(result.schemeId, 'scheme_v1');
    assert.equal(result.schemeVersion, 1);
    assert.equal(result.calculationVersion, KPI_FRAMEWORK_CALCULATION_VERSION);
    assert.equal(result.finalizedAt, null);
    assert.equal(result.components.length, 4, 'all four scheme components are represented');
  });

  it('6. missing components are explicit PENDING placeholders — never zero', () => {
    const result = aggregateEmployeeKpi({
      scheme,
      employeeId: 'emp1',
      period: '2026-08',
      componentResults: [],
    });
    for (const c of result.components) {
      assert.equal(c.status, 'PENDING');
      assert.equal(c.rawScore, null, `${c.componentId} rawScore must be null, not 0`);
      assert.equal(c.weightedContribution, null);
    }
    assert.equal(result.weightedTotal, 0, 'no available contributions → total is zero-by-emptiness, not by fabrication');
    assert.equal(result.overallStatus, 'INCOMPLETE');
  });

  it('7. never redistributes missing weights (total stays 13.2 — not rescaled to /100)', () => {
    const quality = buildQualityComponentResult({
      component: { componentId: 'quality', name: 'الجودة', weight: 15, owner: 'quality' },
      qualityScore: { score: 88 },
      origin: 'live_engine',
    });
    const result = aggregateEmployeeKpi({
      scheme,
      employeeId: 'emp1',
      period: '2026-08',
      componentResults: [quality],
    });
    // 13.2 stays 13.2 — NOT 88 (score swap), NOT 13.2/15*100 (rescale),
    // NOT padded by the missing 85 weight.
    assert.equal(result.weightedTotal, 13.2);
    assert.equal(result.availableWeight, 15);
    const manager = result.components.find((c) => c.componentId === 'direct_manager');
    assert.equal(manager?.weightedContribution, null);
    assert.equal(manager?.weight, 15, 'missing component keeps its weight — nothing redistributed');
  });

  it('a COMPLETE result requires every ACTIVE component to carry a value', () => {
    const all: KpiSchemeComponent[] = [
      makeComponent({ weight: 15 }),
      makeComponent({ componentId: 'direct_manager', name: 'المدير المباشر', weight: 15, owner: 'management', calculationType: 'none' }),
      makeComponent({ componentId: 'hr', name: 'الموارد البشرية', weight: 10, owner: 'hr', calculationType: 'none' }),
      makeComponent({ componentId: 'target', name: 'المستهدف', weight: 60, owner: 'management', calculationType: 'none' }),
    ];
    const provided = all.map((c) => ({
      componentId: c.componentId,
      name: c.name,
      owner: c.owner,
      weight: c.weight,
      status: 'AVAILABLE' as const,
      rawScore: 90,
      weightedContribution: (90 * c.weight) / 100,
      maxContribution: c.weight,
      evidence: null,
    }));
    const result = aggregateEmployeeKpi({
      scheme: { ...scheme, components: all },
      employeeId: 'emp1',
      period: '2026-08',
      componentResults: provided,
    });
    assert.equal(result.overallStatus, 'COMPLETE');
    assert.equal(result.weightedTotal, 90 * 15 / 100 + 90 * 15 / 100 + 90 * 10 / 100 + 90 * 60 / 100);
  });

  it('INACTIVE scheme components are excluded from aggregation entirely', () => {
    const schemeWithInactive = makeScheme({
      components: [
        makeComponent(),
        makeComponent({ componentId: 'direct_manager', name: 'المدير المباشر', weight: 15, owner: 'management', calculationType: 'none', status: 'INACTIVE' }),
        makeComponent({ componentId: 'hr', name: 'الموارد البشرية', weight: 10, owner: 'hr', calculationType: 'none' }),
        makeComponent({ componentId: 'target', name: 'المستهدف', weight: 60, owner: 'management', calculationType: 'none' }),
      ],
    });
    const result = aggregateEmployeeKpi({
      scheme: schemeWithInactive,
      employeeId: 'emp1',
      period: '2026-08',
      componentResults: [],
    });
    assert.equal(result.components.length, 3);
    assert.ok(!result.components.some((c) => c.componentId === 'direct_manager'));
  });
});

// ─────────────────────────────────────────────────────────────
//  8 & 9 — Scheme resolution: override ▸ department ▸ default
// ─────────────────────────────────────────────────────────────

describe('Phase 1 — scheme resolution', () => {
  const deptScheme = makeScheme({
    id: 'scheme_sales',
    isDefault: false,
    applicableDepartments: ['المبيعات'],
    effectiveFrom: '2026-01-01',
  });

  it('9. resolves the active default scheme when nothing more specific applies', () => {
    const resolution = resolveSchemeForEmployee({
      employee: { id: 'emp1', department: 'المستودع' },
      overrides: [],
      schemes: [makeScheme()],
      period: '2026-08',
    });
    assert.equal(resolution.status, 'RESOLVED');
    assert.equal(resolution.source, 'default');
    assert.equal(resolution.scheme?.id, 'scheme_v1');
  });

  it('resolves a department-matching scheme over the default', () => {
    const resolution = resolveSchemeForEmployee({
      employee: { id: 'emp1', department: 'المبيعات' },
      overrides: [],
      schemes: [makeScheme(), deptScheme],
      period: '2026-08',
    });
    assert.equal(resolution.status, 'RESOLVED');
    assert.equal(resolution.source, 'department');
    assert.equal(resolution.scheme?.id, 'scheme_sales');
  });

  it('8. the employee-specific override wins over everything', () => {
    const resolution = resolveSchemeForEmployee({
      employee: { id: 'emp1', department: 'المبيعات' },
      overrides: [{ id: 'emp1', employeeId: 'emp1', schemeId: 'scheme_v1', updatedBy: 'admin', updatedAt: NOW.toISOString() }],
      schemes: [makeScheme(), deptScheme],
      period: '2026-08',
    });
    assert.equal(resolution.status, 'RESOLVED');
    assert.equal(resolution.source, 'employee_override');
    assert.equal(resolution.scheme?.id, 'scheme_v1');
  });

  it('8b. an unresolvable override FAILS SAFE — it never falls through to the default', () => {
    // Override points to an ARCHIVED scheme → explicit failure.
    const archivedTarget = makeScheme({ id: 'scheme_old', status: 'ARCHIVED' });
    const r1 = resolveSchemeForEmployee({
      employee: { id: 'emp1', department: 'المبيعات' },
      overrides: [{ id: 'emp1', employeeId: 'emp1', schemeId: 'scheme_old', updatedBy: null, updatedAt: '' }],
      schemes: [makeScheme(), archivedTarget],
      period: '2026-08',
    });
    assert.equal(r1.status, 'OVERRIDE_NOT_RESOLVABLE');
    assert.equal(r1.scheme, null);

    // Override points to a scheme not covering the period → same.
    const futureScheme = makeScheme({ id: 'scheme_future', effectiveFrom: '2027-01-01' });
    const r2 = resolveSchemeForEmployee({
      employee: { id: 'emp1', department: 'المبيعات' },
      overrides: [{ id: 'emp1', employeeId: 'emp1', schemeId: 'scheme_future', updatedBy: null, updatedAt: '' }],
      schemes: [makeScheme(), futureScheme],
      period: '2026-08',
    });
    assert.equal(r2.status, 'OVERRIDE_NOT_RESOLVABLE');

    // Override to a nonexistent scheme id → same.
    const r3 = resolveSchemeForEmployee({
      employee: { id: 'emp1', department: 'المبيعات' },
      overrides: [{ id: 'emp1', employeeId: 'emp1', schemeId: 'scheme_ghost', updatedBy: null, updatedAt: '' }],
      schemes: [makeScheme()],
      period: '2026-08',
    });
    assert.equal(r3.status, 'OVERRIDE_NOT_RESOLVABLE');
  });

  it('fails safely (AMBIGUOUS) when two default schemes overlap — never picks one arbitrarily', () => {
    const v2 = makeScheme({ id: 'scheme_v2', name: 'نظام مؤشرات الأداء — 2026', version: 2 });
    const resolution = resolveSchemeForEmployee({
      employee: { id: 'emp1', department: 'المستودع' },
      overrides: [],
      schemes: [makeScheme(), v2],
      period: '2026-08',
    });
    assert.equal(resolution.status, 'AMBIGUOUS');
    assert.equal(resolution.scheme, null);
    assert.equal(resolution.candidates, 2);
  });

  it('fails safely (AMBIGUOUS) when two department schemes overlap for the same department', () => {
    const deptA = makeScheme({ id: 'dept_a', isDefault: false, applicableDepartments: ['المبيعات'] });
    const deptB = makeScheme({ id: 'dept_b', isDefault: false, applicableDepartments: ['المبيعات'] });
    const resolution = resolveSchemeForEmployee({
      employee: { id: 'emp1', department: 'المبيعات' },
      overrides: [],
      schemes: [deptA, deptB],
      period: '2026-08',
    });
    assert.equal(resolution.status, 'AMBIGUOUS');
  });

  it('NO_SCHEME when no active scheme covers the period', () => {
    const resolution = resolveSchemeForEmployee({
      employee: { id: 'emp1', department: null },
      overrides: [],
      schemes: [makeScheme({ status: 'DRAFT' })],
      period: '2026-08',
    });
    assert.equal(resolution.status, 'NO_SCHEME');
  });

  it('DRAFT and ARCHIVED schemes never resolve (only ACTIVE)', () => {
    for (const status of ['DRAFT', 'ARCHIVED'] as const) {
      const resolution = resolveSchemeForEmployee({
        employee: { id: 'emp1', department: null },
        overrides: [],
        schemes: [makeScheme({ status })],
        period: '2026-08',
      });
      assert.equal(resolution.status, 'NO_SCHEME', `${status} must not resolve`);
    }
  });
});

// ─────────────────────────────────────────────────────────────
//  12 — Effective dates
// ─────────────────────────────────────────────────────────────

describe('Phase 1 — effective dates', () => {
  it('monthDayRange returns inclusive month bounds', () => {
    assert.deepEqual(monthDayRange('2026-08'), { start: '2026-08-01', end: '2026-08-31' });
    assert.deepEqual(monthDayRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
    assert.deepEqual(monthDayRange('2024-02'), { start: '2024-02-01', end: '2024-02-29' });
  });

  it('a scheme covers a period when its window overlaps ANY day of the month', () => {
    const midMonth = makeScheme({ effectiveFrom: '2026-08-15', effectiveTo: null });
    assert.equal(schemeCoversPeriod(midMonth, '2026-08'), true, 'from Aug 15 overlaps August');
    assert.equal(schemeCoversPeriod(midMonth, '2026-09'), true, 'open-ended window covers the future');
    assert.equal(schemeCoversPeriod(midMonth, '2026-07'), false, 'starts Aug 15 — July is untouched');
  });

  it('a future scheme never affects historical periods', () => {
    const future = makeScheme({ effectiveFrom: '2026-09-01', effectiveTo: null });
    assert.equal(schemeCoversPeriod(future, '2026-08'), false);
    assert.equal(schemeCoversPeriod(future, '2026-09'), true);
  });

  it('an expired scheme stops covering after effectiveTo', () => {
    const expired = makeScheme({ effectiveFrom: '2026-01-01', effectiveTo: '2026-08-31' });
    assert.equal(schemeCoversPeriod(expired, '2026-08'), true);
    assert.equal(schemeCoversPeriod(expired, '2026-09'), false);
  });

  it('window validation requires to > from and valid YYYY-MM-DD keys', () => {
    assert.equal(validateEffectiveWindow('2026-01-01', null).valid, true);
    assert.equal(validateEffectiveWindow('2026-01-01', '2026-12-31').valid, true);
    assert.equal(validateEffectiveWindow('2026-01-01', '2026-01-01').valid, false);
    assert.equal(validateEffectiveWindow('2026-13-01', null).valid, false);
    assert.equal(validateEffectiveWindow('2026-02-30', null).valid, false, 'impossible calendar day rejected');
    assert.equal(validateEffectiveWindow('01-2026', null).valid, false);
  });
});

// ─────────────────────────────────────────────────────────────
//  Conflict detection (activation guard)
// ─────────────────────────────────────────────────────────────

describe('Phase 1 — activation conflicts (fail-safe)', () => {
  it('detects an overlapping ACTIVE default scheme as a conflict', () => {
    const existing = makeScheme({ id: 'existing', effectiveFrom: '2024-01-01', effectiveTo: null });
    const candidate = makeScheme({ id: 'candidate', status: 'DRAFT', effectiveFrom: '2026-01-01', effectiveTo: null });
    const conflicts = findConflictingActiveSchemes(candidate, [existing]);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].id, 'existing');
  });

  it('non-overlapping windows do NOT conflict (version transitions stay possible)', () => {
    const v1 = makeScheme({ id: 'v1', effectiveFrom: '2024-01-01', effectiveTo: '2026-08-31' });
    const v2 = makeScheme({ id: 'v2', status: 'DRAFT', effectiveFrom: '2026-09-01', effectiveTo: null });
    assert.equal(findConflictingActiveSchemes(v2, [v1]).length, 0);
  });

  it('DRAFT/ARCHIVED schemes and disjoint departments do not conflict', () => {
    const draft = makeScheme({ id: 'draft', status: 'DRAFT' });
    const deptOther = makeScheme({ id: 'dept_other', isDefault: false, applicableDepartments: ['المستودع'] });
    const candidate = makeScheme({ id: 'candidate', status: 'DRAFT', isDefault: false, applicableDepartments: ['المبيعات'] });
    assert.equal(findConflictingActiveSchemes(candidate, [draft, deptOther]).length, 0);
  });
});

// ─────────────────────────────────────────────────────────────
//  10 & 11 — Versioning + frozen historical results
// ─────────────────────────────────────────────────────────────

describe('Phase 1 — versioning and historical immutability', () => {
  it('every result stamps the exact scheme id/version used', () => {
    const result = buildEmployeeKpiResult({
      employee: { id: 'emp1' },
      scheme: makeScheme({ id: 'scheme_x', version: 7, name: 'نظام سابع' }),
      period: '2026-08',
      qualityScore: { score: 88 },
      origin: 'live_engine',
    });
    assert.equal(result.schemeId, 'scheme_x');
    assert.equal(result.schemeVersion, 7);
    assert.equal(result.schemeName, 'نظام سابع');
  });

  it('11. a FROZEN result in a closed snapshot is returned verbatim — v2 schemes cannot alter it', async () => {
    const frozenV1: EmployeeKpiResult = {
      employeeId: 'emp1',
      period: '2026-08',
      schemeId: 'scheme_v1',
      schemeVersion: 1,
      schemeName: 'نظام مؤشرات الأداء — 2026',
      components: [
        {
          componentId: 'quality', name: 'الجودة', owner: 'quality',
          weight: 15, status: 'AVAILABLE', rawScore: 88,
          weightedContribution: 13.2, maxContribution: 15, evidence: null,
        },
        { componentId: 'direct_manager', name: 'المدير المباشر', owner: 'management', weight: 15, status: 'PENDING', rawScore: null, weightedContribution: null, maxContribution: 15, evidence: null },
        { componentId: 'hr', name: 'الموارد البشرية', owner: 'hr', weight: 10, status: 'PENDING', rawScore: null, weightedContribution: null, maxContribution: 10, evidence: null },
        { componentId: 'target', name: 'المستهدف', owner: 'management', weight: 60, status: 'PENDING', rawScore: null, weightedContribution: null, maxContribution: 60, evidence: null },
      ],
      availableWeight: 15,
      weightedTotal: 13.2,
      overallStatus: 'INCOMPLETE',
      calculationVersion: '1',
      finalizedAt: '2026-09-01T08:00:00.000Z',
    };

    // The scheme table has MOVED ON to v2 with different weights —
    // the frozen result must still come back exactly as stored.
    const v2Scheme = makeScheme({
      id: 'scheme_v2',
      version: 2,
      components: [
        makeComponent({ weight: 20 }),
        makeComponent({ componentId: 'direct_manager', name: 'المدير المباشر', weight: 20, owner: 'management', calculationType: 'none' }),
        makeComponent({ componentId: 'hr', name: 'الموارد البشرية', weight: 10, owner: 'hr', calculationType: 'none' }),
        makeComponent({ componentId: 'target', name: 'المستهدف', weight: 50, owner: 'management', calculationType: 'none' }),
      ],
    });

    const outcome = await computeEmployeeKpiResultWithLoaders(
      { employeeId: 'emp1', period: '2026-08' },
      makeEmployeeResultLoaders({
        loadSnapshot: async () => ({
          status: 'closed',
          closedAt: '2026-09-01T08:00:00.000Z',
          employeeScores: { emp1: { score: 88, deductionPoints: 12, bonusPoints: 0, observationCount: 3 } },
          kpiResults: { emp1: frozenV1 },
        }),
        loadSchemes: async () => [v2Scheme],
      }),
    );

    assert.equal(outcome.status, 'FROZEN_RESULT');
    assert.deepEqual(outcome.result, frozenV1);
    assert.equal(outcome.result?.schemeVersion, 1);
    assert.equal(outcome.result?.weightedTotal, 13.2);
  });

  it('10. a legacy closed snapshot (no stored result) derives a read-only view tied to the frozen quality score', async () => {
    const outcome = await computeEmployeeKpiResultWithLoaders(
      { employeeId: 'emp1', period: '2026-08' },
      makeEmployeeResultLoaders({
        loadSnapshot: async () => ({
          status: 'closed',
          closedAt: '2026-09-01T08:00:00.000Z',
          employeeScores: { emp1: { score: 88, deductionPoints: 12, bonusPoints: 0, observationCount: 3 } },
          kpiResults: null,
        }),
        // Even if the live engine would give a different score today,
        // the derived view consumes the FROZEN score (no recompute).
        loadLiveQualityScore: async () => ({ score: 10, deductionPoints: 0, bonusPoints: 0, observationCount: 0 }),
      }),
    );
    assert.equal(outcome.status, 'RESOLVED');
    assert.equal(outcome.result?.finalizedAt, '2026-09-01T08:00:00.000Z');
    const quality = outcome.result?.components.find((c) => c.componentId === 'quality');
    assert.equal(quality?.rawScore, 88, 'derived view consumes the frozen score');
    assert.equal(quality?.weightedContribution, 13.2);
  });

  it('withFinalizedAt stamps the close timestamp on every result (pure)', () => {
    const results: Record<string, EmployeeKpiResult> = {
      emp1: {
        employeeId: 'emp1', period: '2026-08', schemeId: 's', schemeVersion: 1, schemeName: 's',
        components: [], availableWeight: 15, weightedTotal: 13.2, overallStatus: 'INCOMPLETE',
        calculationVersion: '1', finalizedAt: null,
      },
    };
    const finalized = withFinalizedAt(results, '2026-09-01T08:00:00.000Z');
    assert.equal(finalized.emp1.finalizedAt, '2026-09-01T08:00:00.000Z');
    assert.equal(results.emp1.finalizedAt, null, 'input untouched (immutability)');
  });
});

// ─────────────────────────────────────────────────────────────
//  13 — Archived employee handling
// ─────────────────────────────────────────────────────────────

describe('Phase 1 — employee lifecycle', () => {
  it('an employee with no ledger events (legacy) is eligible', () => {
    assert.equal(
      isEmployeeEligibleForPeriod({ id: 'e1', name: 'x', department: null }, [], '2026-08'),
      true,
    );
  });

  it('13. an employee archived BEFORE the period gets NO KPI result — never an artificial zero', async () => {
    const outcome = await computeEmployeeKpiResultWithLoaders(
      { employeeId: 'emp1', period: '2026-08' },
      makeEmployeeResultLoaders({
        loadEmploymentEvents: async () => [
          { kind: 'archived' as const, effectiveAt: '2026-05-10T00:00:00.000Z' },
        ],
      }),
    );
    assert.equal(outcome.status, 'NOT_ELIGIBLE_PERIOD');
    assert.equal(outcome.result, null);
  });

  it('a RESTORED employee is eligible again (ACTIVE → ARCHIVED → RESTORED → ACTIVE)', async () => {
    const outcome = await computeEmployeeKpiResultWithLoaders(
      { employeeId: 'emp1', period: '2026-08' },
      makeEmployeeResultLoaders({
        loadEmploymentEvents: async () => [
          { kind: 'archived' as const, effectiveAt: '2026-05-10T00:00:00.000Z' },
          { kind: 'restored' as const, effectiveAt: '2026-06-01T00:00:00.000Z' },
        ],
      }),
    );
    assert.equal(outcome.status, 'RESOLVED');
    assert.ok(outcome.result);
  });

  it('an employee archived MID-month remains eligible for that month (end-inclusive)', () => {
    assert.equal(
      isEmployeeEligibleForPeriod(
        { id: 'e1', name: 'x', department: null },
        [{ kind: 'archived', effectiveAt: '2026-08-20T00:00:00.000Z' }],
        '2026-08',
      ),
      true,
    );
  });

  it('the record-level archivedAt guard covers a missing ledger entry', () => {
    assert.equal(
      isEmployeeEligibleForPeriod(
        { id: 'e1', name: 'x', department: null, status: 'archived', archivedAt: '2026-05-10T00:00:00.000Z' },
        [],
        '2026-08',
      ),
      false,
    );
  });

  it('buildMonthKpiResults omits ineligible employees and keeps eligible ones', async () => {
    const results = await buildMonthKpiResultsWithLoaders(
      '2026-08',
      {
        emp1: makeScoreEntry('emp1', 88),
        emp2: makeScoreEntry('emp2', 95),
      },
      makeMonthLoaders({
        loadEmploymentEventsByEmployee: async () =>
          new Map([['emp2', [{ kind: 'archived' as const, effectiveAt: '2026-05-10T00:00:00.000Z' }]]]),
      }),
    );
    assert.ok(results.emp1, 'eligible employee has a framework result');
    assert.equal(results.emp1.components.find((c) => c.componentId === 'quality')?.rawScore, 88);
    assert.equal(results.emp2, undefined, 'archived employee gets NO fabricated entry');
    assert.equal(Object.keys(results).length, 1);
  });

  it('buildMonthKpiResults returns {} when no ACTIVE scheme exists (graceful)', async () => {
    const results = await buildMonthKpiResultsWithLoaders(
      '2026-08',
      { emp1: makeScoreEntry('emp1', 88) },
      makeMonthLoaders({ loadSchemes: async () => [makeScheme({ status: 'DRAFT' })] }),
    );
    assert.deepEqual(results, {});
  });
});

// ─────────────────────────────────────────────────────────────
//  End-to-end DI pipeline outcomes
// ─────────────────────────────────────────────────────────────

describe('Phase 1 — computeEmployeeKpiResult outcomes', () => {
  it('RESOLVED: live quality 88 → INCOMPLETE company KPI with 13.2 contribution', async () => {
    const outcome = await computeEmployeeKpiResultWithLoaders(
      { employeeId: 'emp1', period: '2026-08' },
      makeEmployeeResultLoaders(),
    );
    assert.equal(outcome.status, 'RESOLVED');
    assert.equal(outcome.result?.overallStatus, 'INCOMPLETE');
    assert.equal(outcome.result?.weightedTotal, 13.2);
    assert.equal(outcome.result?.availableWeight, 15);
    assert.equal(outcome.resolution?.source, 'default');
  });

  it('EMPLOYEE_NOT_FOUND for an unknown employee', async () => {
    const outcome = await computeEmployeeKpiResultWithLoaders(
      { employeeId: 'ghost', period: '2026-08' },
      makeEmployeeResultLoaders({ loadEmployee: async () => null }),
    );
    assert.equal(outcome.status, 'EMPLOYEE_NOT_FOUND');
    assert.equal(outcome.result, null);
  });

  it('NO_SCHEME outcome carries the resolution diagnostics (no fabricated result)', async () => {
    const outcome = await computeEmployeeKpiResultWithLoaders(
      { employeeId: 'emp1', period: '2030-01' },
      makeEmployeeResultLoaders({
        loadSchemes: async () => [makeScheme({ effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' })],
      }),
    );
    assert.equal(outcome.status, 'NO_SCHEME');
    assert.equal(outcome.result, null);
    assert.ok(outcome.resolution?.message);
  });
});

// ─────────────────────────────────────────────────────────────
//  15 — Firebase RTDB safety
// ─────────────────────────────────────────────────────────────

describe('Phase 1 — RTDB safety (no undefined writes)', () => {
  it('stripUndefinedForRtdb removes undefined recursively (keeps null semantics)', () => {
    const input = {
      a: 1,
      b: undefined,
      c: { d: undefined, e: null, f: [1, undefined, { g: undefined, h: 'x' }] },
      i: new Date('2026-01-01T00:00:00.000Z'),
    };
    const out = stripUndefinedForRtdb(input) as Record<string, unknown>;
    assert.equal(findUndefined(out), null);
    assert.deepEqual(Object.keys(out).sort(), ['a', 'c', 'i']);
    assert.equal((out.c as Record<string, unknown>).e, null);
    assert.equal(((out.c as Record<string, unknown>).f as unknown[]).length, 2);
  });

  it('a fully-built employee result contains NO undefined values anywhere', () => {
    const result = buildEmployeeKpiResult({
      employee: { id: 'emp1' },
      scheme: makeScheme(),
      period: '2026-08',
      qualityScore: null, // PENDING path — the null-heavy shape
      origin: 'live_engine',
    });
    assert.equal(findUndefined(result), null);
    // Optional evidence stays null (RTDB strips null keys; readers
    // normalize undefined back to null).
    assert.equal(result.components[0].evidence, null);
  });
});

// ─────────────────────────────────────────────────────────────
//  Snapshot integration (Month Close compatibility)
// ─────────────────────────────────────────────────────────────

describe('Phase 1 — monthly snapshot integration', () => {
  const kpiResults: Record<string, EmployeeKpiResult> = {
    emp1: {
      employeeId: 'emp1',
      period: '2026-08',
      schemeId: 'scheme_v1',
      schemeVersion: 1,
      schemeName: 'نظام مؤشرات الأداء — 2026',
      components: [],
      availableWeight: 15,
      weightedTotal: 13.2,
      overallStatus: 'INCOMPLETE',
      calculationVersion: '1',
      finalizedAt: null,
    },
  };

  it('buildClosedSnapshot carries the framework results through', () => {
    const snapshot = buildClosedSnapshot(
      makeComputedPayload('2026-08', kpiResults),
      '2026-08',
      null,
      ACTOR,
      NOW,
    );
    assert.deepEqual(snapshot.kpiResults, kpiResults);
  });

  it('legacy payloads WITHOUT framework results still build (backward compatible)', () => {
    const computed = makeComputedPayload('2026-08', kpiResults);
    delete (computed as Partial<typeof computed>).kpiResults;
    const snapshot = buildClosedSnapshot(computed, '2026-08', null, ACTOR, NOW);
    assert.equal(snapshot.kpiResults, undefined);
  });

  it('a re-close archives the previous framework results into snapshotHistory', () => {
    const previous = buildClosedSnapshot(
      makeComputedPayload('2026-08', kpiResults),
      '2026-08',
      null,
      ACTOR,
      NOW,
    );
    const reopened = { ...previous, status: 'open' as const };
    const reclosed = buildReclosedSnapshot(
      makeComputedPayload('2026-08', kpiResults),
      reopened,
      ACTOR,
      NOW,
    );
    assert.deepEqual(reclosed.kpiResults, kpiResults);
    const archived = reclosed.snapshotHistory ?? [];
    assert.equal(archived.length, 1);
    assert.deepEqual(archived[0].kpiResults, kpiResults, 'superseded version keeps its own framework results');
  });

  it('buildLivePreview carries live (unfinalized) framework results', () => {
    const preview = buildLivePreview(makeComputedPayload('2026-08', kpiResults), '2026-08');
    assert.deepEqual(preview.kpiResults, kpiResults);
  });
});

// ─────────────────────────────────────────────────────────────
//  14 & 16 — Permission gates + engine-independence (source contracts)
// ─────────────────────────────────────────────────────────────

describe('Phase 1 — route permission gates & engine independence', () => {
  const read = (p: string): string =>
    fs.readFileSync(path.join(process.cwd(), p), 'utf8');

  it('14. scheme listing requires an authenticated kpiDashboard view', () => {
    const src = read('src/app/api/kpi-schemes/route.ts');
    assert.ok(src.includes("requireAuth(request)"), 'GET must authenticate');
    assert.ok(src.includes("verifyPermission(request, 'kpiDashboard', 'view')"), 'GET must gate on kpiDashboard view');
    assert.ok(src.includes("verifyPermission(request, 'kpiSettings', 'update')"), 'POST must gate on kpiSettings update');
  });

  it('14. activation and updates require kpiSettings update', () => {
    assert.ok(
      read('src/app/api/kpi-schemes/[id]/route.ts').includes("verifyPermission(request, 'kpiSettings', 'update')"),
    );
    assert.ok(
      read('src/app/api/kpi-schemes/[id]/activate/route.ts').includes("verifyPermission(request, 'kpiSettings', 'update')"),
    );
  });

  it('14. employee endpoints enforce the existing employee scope (no new auth system)', () => {
    const resultSrc = read('src/app/api/kpi-framework/employee-result/route.ts');
    assert.ok(resultSrc.includes("verifyPermission(request, 'kpiDashboard', 'view')"));
    assert.ok(resultSrc.includes('employeeInScope('));

    const overrideSrc = read('src/app/api/kpi-framework/employee-scheme/route.ts');
    assert.ok(overrideSrc.includes("verifyPermission(request, 'kpiSettings', 'update')"));
    assert.ok(overrideSrc.includes('employeeInScope('));
  });

  it('14. the existing Month Close gate is untouched (regression)', () => {
    const src = read('src/app/api/month-snapshots/[id]/close/route.ts');
    assert.ok(src.includes("verifyPermission(request, 'monthClose', 'approve')"));
  });

  it('16. the canonical Quality engine does NOT depend on the framework (no duplication, one-way adapter)', () => {
    const engine = read('src/lib/metrics/kpiMetrics.ts');
    assert.ok(!engine.includes('kpi-framework'), 'engine must never import the framework');
    // The framework consumes the engine (dependency direction).
    const adapter = read('src/lib/kpi-framework/employee-result.ts');
    assert.ok(adapter.includes("from '@/lib/metrics/kpiMetrics'"));
  });

  it('16. the existing quality scoring behavior is unchanged (engine smoke check)', () => {
    const score = computeEmployeeScore(
      [
        {
          id: 'o1', employeeId: 'emp1', month: '2026-08', applyPointDeduction: true,
          points: 12, isBonus: false, approvalStatus: 'approved', categoryId: 'c1',
          categoryWeight: 1, status: 'resolved',
        },
      ],
      SETTINGS,
      'emp1',
    );
    assert.equal(score.score, 88, '100 default − 12 approved deduction = 88');
  });

  it('the month snapshot pipeline consumes the framework (integration wired)', () => {
    const src = read('src/lib/month-snapshots.ts');
    assert.ok(src.includes('buildMonthKpiResults'), 'computeFreshMonthSnapshot must attach framework results');
    assert.ok(src.includes('withFinalizedAt'), 'close must freeze results with the close timestamp');
  });
});
