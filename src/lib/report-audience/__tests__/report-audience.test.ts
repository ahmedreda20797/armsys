// ══════════════════════════════════════════════════════════════
//  Report audience profiles + HR sanitized projection (pure contract)
//
//  Pins the Qnalys audience-aware reporting foundation:
//    • the profile registry: HR/TEAM_LEADER/MANAGEMENT structurally
//      deny technical evidence/component math/operational records
//    • audience resolution from EXISTING effective permissions
//      (admin bypass, quality page access, people-scoped employees
//      entry, HR preset, fail-closed HR default)
//    • the HR projection: verbatim canonical values (null stays
//      null, statuses stay distinct) and STRUCTURAL exclusion of
//      every technical field (JSON-level assertion)
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_AUDIENCE_PROFILES,
  resolveReportAudience,
  audienceMayReceiveTechnicalReports,
  buildHrPerformanceReport,
  toHrPerformanceTotals,
} from '@/lib/report-audience';
import type { KpiMonthlyReport, KpiReportRow, KpiReportRowStatus, KpiValueBasis, KpiRowResultSource } from '@/lib/kpi-reporting';
import type { PermissionsMap, PagePermission, PermissionLevel } from '@/config/permissions';

// ── Profile registry ──
describe('report audience profiles', () => {
  it('TECHNICAL receives everything (existing full-detail reports unchanged)', () => {
    const g = REPORT_AUDIENCE_PROFILES.TECHNICAL;
    assert.equal(g.technicalEvidence, true);
    assert.equal(g.componentMath, true);
    assert.equal(g.operationalRecords, true);
    assert.equal(g.performanceResult, true);
  });

  it('TEAM_LEADER keeps results/status but never technical evidence', () => {
    const g = REPORT_AUDIENCE_PROFILES.TEAM_LEADER;
    assert.equal(g.identity, true);
    assert.equal(g.performanceResult, true);
    assert.equal(g.performanceStatus, true);
    assert.equal(g.technicalEvidence, false);
    assert.equal(g.componentMath, false);
    assert.equal(g.operationalRecords, false);
  });

  it('HR keeps result + org context only — evidence/math/operations structurally denied', () => {
    const g = REPORT_AUDIENCE_PROFILES.HR;
    assert.equal(g.identity, true);
    assert.equal(g.employmentContext, true);
    assert.equal(g.performanceResult, true);
    assert.equal(g.performanceStatus, true);
    assert.equal(g.schemeIdentity, true);
    assert.equal(g.periodTotals, true);
    assert.equal(g.technicalEvidence, false);
    assert.equal(g.componentMath, false);
    assert.equal(g.operationalRecords, false);
  });

  it('only TECHNICAL may receive technical reports', () => {
    assert.equal(audienceMayReceiveTechnicalReports('TECHNICAL'), true);
    assert.equal(audienceMayReceiveTechnicalReports('TEAM_LEADER'), false);
    assert.equal(audienceMayReceiveTechnicalReports('HR'), false);
    assert.equal(audienceMayReceiveTechnicalReports('MANAGEMENT'), false);
  });
});

// ── Audience resolution (existing permission maps — no new system) ──
describe('resolveReportAudience — from existing effective permissions', () => {
  it('admin → TECHNICAL (existing bypass)', () => {
    assert.equal(resolveReportAudience({ role: 'admin', permissions: null }), 'TECHNICAL');
  });

  it('quality page access → TECHNICAL (the quality function)', () => {
    const permissions: PermissionsMap = {
      quality: { level: 'edit', actions: { create: true } },
      employees: { level: 'read', scope: 'all' },
    };
    assert.equal(resolveReportAudience({ role: 'quality', permissions }), 'TECHNICAL');
  });

  it('people-scoped employees entry (subtree/team/department) → TEAM_LEADER', () => {
    for (const scope of ['subtree', 'team', 'department'] as const) {
      const permissions: PermissionsMap = {
        employees: { level: 'read', scope },
        reports: { level: 'edit' },
      };
      assert.equal(resolveReportAudience({ role: 'manager', permissions }), 'TEAM_LEADER', scope);
    }
  });

  it('HR preset shape (employees "all", no quality page) → HR', () => {
    const permissions: PermissionsMap = {
      employees: { level: 'edit', actions: { create: true, update: true }, scope: 'all' },
      reports: { level: 'edit', actions: { export: false } },
      kpiReports: 'read',
      quality: 'none',
    };
    assert.equal(resolveReportAudience({ role: 'hr', permissions }), 'HR');
  });

  it('unconfigured generic role → HR (fail-closed default, still permission-gated)', () => {
    assert.equal(resolveReportAudience({ role: 'user', permissions: { employees: 'read', reports: 'none' } }), 'HR');
    assert.equal(resolveReportAudience({ role: 'user', permissions: null }), 'HR');
  });
});

// ── HR sanitized projection ──
function canonicalRow(overrides: Partial<KpiReportRow> = {}): KpiReportRow {
  return {
    employeeId: 'e1',
    employeeName: 'أمنية السعيد',
    employeeCode: 'EMP-075',
    department: 'المبيعات',
    team: "Hanin's Sales Team",
    position: 'مندوبة مبيعات',
    employmentStatus: 'active',
    archivedButEligible: false,
    // Technical slice — must NEVER survive the projection:
    quality: {
      componentId: 'quality',
      name: 'الجودة',
      status: 'AVAILABLE',
      rawScore: 88,
      weight: 60,
      weightedContribution: 52.8,
      maxContribution: 60,
      observationCount: 3,
      deductionPoints: 2,
      bonusPoints: 0,
    },
    availableWeight: 60,
    weightedTotal: 52.8,
    overallStatus: 'INCOMPLETE',
    rowStatus: 'INCOMPLETE',
    finalized: false,
    valueBasis: 'LIVE',
    resultSource: 'LIVE',
    schemeId: 'scheme-1',
    schemeName: 'نظام مؤشرات أداء الشركة — 2026',
    schemeVersion: 1,
    finalizedAt: null,
    ...overrides,
  };
}

function canonicalMonthly(rows: KpiReportRow[]): KpiMonthlyReport {
  return {
    reportKind: 'MONTHLY',
    monthKey: '2026-09',
    valueBasis: 'LIVE',
    finalized: false,
    closedAt: null,
    closedByName: null,
    derivedLegacy: false,
    scheme: null,
    asOfDate: '2026-09-21',
    rows,
    totals: {
      eligibleCount: rows.length, withResult: 0, available: 0, zero: 0,
      pending: 0, incomplete: 0, finalized: 0, noScheme: 0, notEligibleCount: 0,
    },
    generatedAt: '2026-09-21T12:00:00.000Z',
  };
}

describe('HR projection — verbatim canonical values, structural sanitization', () => {
  it('keeps the final performance result VERBATIM (null stays null — never 0)', () => {
    const withScore = buildHrPerformanceReport(canonicalMonthly([canonicalRow()])).rows[0];
    assert.equal(withScore.performanceScore, 88);
    const withoutScore = buildHrPerformanceReport(
      canonicalMonthly([canonicalRow({ quality: null, rowStatus: 'PENDING', resultSource: 'PENDING' })]),
    ).rows[0];
    assert.equal(withoutScore.performanceScore, null);
  });

  it('status vocabulary stays verbatim and distinct (PENDING ≠ NO_SCHEME ≠ INCOMPLETE)', () => {
    const report = buildHrPerformanceReport(canonicalMonthly([
      canonicalRow({ employeeId: 'e1', rowStatus: 'PENDING', resultSource: 'PENDING', quality: null }),
      canonicalRow({ employeeId: 'e2', rowStatus: 'NO_SCHEME', resultSource: 'NO_SCHEME', quality: null, weightedTotal: null }),
      canonicalRow({ employeeId: 'e3', rowStatus: 'INCOMPLETE' }),
      canonicalRow({ employeeId: 'e4', rowStatus: 'NOT_ELIGIBLE', resultSource: 'NOT_ELIGIBLE', quality: null, weightedTotal: null, overallStatus: null }),
    ]));
    const statuses = report.rows.map((r) => r.performanceStatus);
    assert.deepEqual(statuses, ['PENDING', 'NO_SCHEME', 'INCOMPLETE', 'NOT_ELIGIBLE']);
  });

  it('STRUCTURAL exclusion: no technical field exists anywhere in the serialized output', () => {
    const report = buildHrPerformanceReport(canonicalMonthly([canonicalRow()]));
    const serialized = JSON.stringify(report);
    for (const technical of [
      'quality', 'observationCount', 'deductionPoints', 'bonusPoints',
      'availableWeight', 'weightedTotal', 'componentId', 'maxContribution',
      'weightedContribution', 'weight', 'overallStatus', 'resultSource',
      'schemeId', 'schemeVersion', 'finalizedAt',
    ]) {
      assert.ok(!serialized.includes(`"${technical}"`), `technical field leaked: ${technical}`);
    }
  });

  it('keeps identity + organizational context (name/code/dept/team/position/scheme name)', () => {
    const row = buildHrPerformanceReport(canonicalMonthly([canonicalRow()])).rows[0];
    assert.equal(row.employeeName, 'أمنية السعيد');
    assert.equal(row.employeeCode, 'EMP-075');
    assert.equal(row.department, 'المبيعات');
    assert.equal(row.team, "Hanin's Sales Team");
    assert.equal(row.position, 'مندوبة مبيعات');
    assert.equal(row.schemeName, 'نظام مؤشرات أداء الشركة — 2026');
    assert.equal(row.period, '2026-09');
    assert.equal(row.finalized, false);
    assert.equal(row.valueBasis, 'LIVE');
  });

  it('totals are counts only and consistent with the projected rows', () => {
    const report = buildHrPerformanceReport(canonicalMonthly([
      canonicalRow({ employeeId: 'e1' }),
      canonicalRow({ employeeId: 'e2', rowStatus: 'PENDING', resultSource: 'PENDING', quality: null }),
      canonicalRow({ employeeId: 'e3', rowStatus: 'NO_SCHEME', resultSource: 'NO_SCHEME', quality: null, weightedTotal: null }),
      canonicalRow({ employeeId: 'e4', rowStatus: 'FINALIZED', finalized: true, valueBasis: 'FINALIZED', resultSource: 'FROZEN_RESULT' }),
    ]));
    // Only rows WITH a performance score (e1, e4) count as withResult
    // e1 has rowStatus INCOMPLETE (default), e4 is FINALIZED
    // e2 and e3 have quality: null → no score → not counted
    assert.deepEqual(report.totals, {
      employees: 4, withResult: 2, pending: 1, incomplete: 1, finalized: 1, noScheme: 1,
    });
    assert.equal(report.reportKind, 'HR_MONTHLY_PERFORMANCE');
    assert.equal(report.audience, 'HR');
    assert.equal(report.monthKey, '2026-09');
  });

  it('toHrPerformanceTotals counts an empty population safely', () => {
    assert.deepEqual(toHrPerformanceTotals([]), {
      employees: 0, withResult: 0, pending: 0, incomplete: 0, finalized: 0, noScheme: 0,
    });
  });
});
