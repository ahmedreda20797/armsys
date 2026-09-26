// ══════════════════════════════════════════════════════════════
//  Smart Quality Report UI — Tests (Phase 4, spec §32/§33/§34)
//
//  Two complementary layers:
//    A. VIEW-MODEL UNIT TESTS — every report section mapped from a
//       full EmployeePerformanceDataset fixture: header, hero (raw
//       vs contribution), component status, MTD/finalized display,
//       trend (missing months never zero), observations, repeated
//       issues, deductions, complaints, CAPA, follow-ups, deals,
//       attendance context, evidence reconciliation, data quality,
//       archived-employee history, explicit unavailable states.
//    B. STATIC SOURCE-CONTRACT TESTS — the same proven pattern as
//       the Phase 3 route-contract tests: the page must keep its
//       single Performance Intelligence data source, type-only
//       dataset imports, the reused 'kpiReports' permission key,
//       error/unauthorized states, print support, and contain NO
//       AI/LLM integration of any kind.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import {
  UNAVAILABLE,
  buildReportHeader,
  buildKpiHero,
  buildKpiComponents,
  buildTrend,
  buildObservations,
  buildRepeatedIssues,
  buildDeductions,
  buildComplaints,
  buildCapa,
  buildFollowUps,
  buildDeals,
  buildAttendance,
  buildEvidenceGroups,
  buildDataQuality,
  formatSignedPoints,
  previousMonthKey,
} from '@/components/pages/quality-kpi/smart-report/view-model';

// ─────────────────────────────────────────────────────────────
//  Fixture — a complete, realistic dataset (all sections populated)
// ─────────────────────────────────────────────────────────────

const OBSERVATION_IDS = Array.from({ length: 14 }, (_, i) => `obs_${i + 1}`);
const DEAL_IDS = Array.from({ length: 22 }, (_, i) => `deal_${i + 1}`);
const FOLLOWUP_IDS = Array.from({ length: 8 }, (_, i) => `fu_${i + 1}`);

function makeDataset(overrides?: {
  employee?: Partial<EmployeePerformanceDataset['employee']>;
  period?: Partial<EmployeePerformanceDataset['period']>;
  kpi?: Partial<EmployeePerformanceDataset['kpi']>;
  trendPoints?: EmployeePerformanceDataset['trend']['points'];
  mom?: EmployeePerformanceDataset['trend']['mom'] | null;
  direction?: EmployeePerformanceDataset['trend']['direction'];
  complaints?: Partial<EmployeePerformanceDataset['complaints']>;
  followUps?: Partial<EmployeePerformanceDataset['followUps']>;
  attendance?: EmployeePerformanceDataset['attendance'];
  dataQuality?: Partial<EmployeePerformanceDataset['dataQuality']>;
}): EmployeePerformanceDataset {
  const base: EmployeePerformanceDataset = {
    datasetKind: 'EMPLOYEE_PERFORMANCE_INTELLIGENCE',
    employee: {
      employeeId: 'emp_001',
      employeeName: 'أحمد محمد',
      employeeCode: '001',
      department: 'المبيعات',
      team: null,
      position: 'مستشار سفر',
      employmentStatus: 'active',
      eligibleForPeriod: true,
      archivedButEligible: false,
      archivedAt: null,
      restoredAt: null,
      relationship: 'CONFIRMED',
      ...overrides?.employee,
    },
    period: {
      monthKey: '2026-08',
      valueBasis: 'MTD',
      finalized: false,
      finalizedAt: null,
      ...overrides?.period,
    },
    kpi: {
      outcomeStatus: 'RESOLVED',
      message: null,
      scheme: { schemeId: 'sch_1', schemeName: 'مخطط جودة الحجوزات', schemeVersion: 3, qualityWeight: 15, frozen: false },
      components: [],
      quality: {
        componentId: 'quality',
        name: 'الجودة',
        status: 'AVAILABLE',
        rawScore: 91,
        weight: 15,
        weightedContribution: 13.65,
        maxContribution: 15,
        observationCount: 14,
        deductionPoints: 2,
        bonusPoints: 1,
      },
      availableWeight: 15,
      weightedTotal: 13.65,
      overallStatus: 'INCOMPLETE',
      rowStatus: 'INCOMPLETE',
      calculationVersion: 'v1.0',
      source: 'kpi_engine',
      ...overrides?.kpi,
    },
    trend: {
      windowMonths: ['2026-05', '2026-06', '2026-07', '2026-08'],
      points:
        overrides?.trendPoints ?? [
          { monthKey: '2026-05', valueBasis: 'FINALIZED', available: true, rawScore: 82, weightedContribution: 12.3, weight: 15, rowStatus: 'FINALIZED', finalized: true, schemeId: 'sch_1', schemeVersion: 2 },
          { monthKey: '2026-06', valueBasis: 'FINALIZED', available: true, rawScore: 86, weightedContribution: 12.9, weight: 15, rowStatus: 'FINALIZED', finalized: true, schemeId: 'sch_1', schemeVersion: 2 },
          { monthKey: '2026-07', valueBasis: 'FINALIZED', available: true, rawScore: 88, weightedContribution: 13.2, weight: 15, rowStatus: 'FINALIZED', finalized: true, schemeId: 'sch_1', schemeVersion: 3 },
          { monthKey: '2026-08', valueBasis: 'MTD', available: true, rawScore: 91, weightedContribution: 13.65, weight: 15, rowStatus: 'INCOMPLETE', finalized: false, schemeId: 'sch_1', schemeVersion: 3 },
        ],
      mom:
        overrides?.mom === null
          ? null
          : overrides?.mom ?? {
              currentMonth: '2026-08',
              previousMonth: '2026-07',
              currentRawScore: 91,
              previousRawScore: 88,
              deltaPoints: 3,
              growthPercent: 3.41,
            },
      direction: overrides?.direction === undefined ? 'UP' : overrides.direction,
    },
    quality: {
      observations: {
        total: 14,
        approved: 10,
        pending: 3,
        rejected: 1,
        byResolutionStatus: { open: 4, in_review: 2, resolved: 6, closed: 2 },
        bySeverity: { low: 5, medium: 6, high: 2, critical: 1 },
        byCategory: [
          { categoryId: 'cat_follow', categoryName: 'توقيت المتابعة', count: 7 },
          { categoryId: '_unclassified', categoryName: 'بلا فئة', count: 2 },
        ],
        monthly: [{ month: '2026-08', count: 14 }],
      },
      repeatedIssues: {
        groupBasis: { category: 'categoryId', type: 'type' },
        minOccurrences: 2,
        byCategory: [
          {
            issueKey: 'cat_follow',
            label: 'توقيت المتابعة',
            occurrenceCount: 7,
            firstOccurrence: '03/08/2026',
            lastOccurrence: '27/08/2026',
            observationIds: OBSERVATION_IDS.slice(0, 7),
          },
        ],
        byType: [
          {
            issueKey: 'follow_up_timing',
            label: 'Follow-up Timing',
            occurrenceCount: 4,
            firstOccurrence: '05/08/2026',
            lastOccurrence: '22/08/2026',
            observationIds: OBSERVATION_IDS.slice(0, 4),
          },
        ],
        windowByCategory: [
          {
            issueKey: 'cat_follow',
            label: 'توقيت المتابعة',
            occurrenceCount: 12,
            monthsPresent: 4,
            firstMonth: '2026-05',
            lastMonth: '2026-08',
            observationIds: OBSERVATION_IDS,
          },
        ],
      },
      deductions: {
        count: 2,
        totalDays: 1.5,
        totalAmount: 900,
        byType: [{ categoryId: 'type_late', categoryName: 'تأخير متابعة', count: 2 }],
        records: [
          { id: 'ded_1', date: '10/08/2026', month: '2026-08', type: 'تأخير', description: 'تأخير متابعة عميل', deductionDays: 1, deductionAmount: 600, relatedCapaId: 'capa_1' },
          { id: 'ded_2', date: '18/08/2026', month: '2026-08', type: 'تأخير', description: 'تأخير توثيق عرض', deductionDays: 0.5, deductionAmount: 300, relatedCapaId: null },
        ],
      },
    },
    complaints: {
      relationship: 'CONFIRMED',
      total: 3,
      byStatus: { resolved: 2, open: 1 },
      byType: { service: 2, pricing: 1 },
      bySeverity: { high: 1, medium: 2 },
      repeatedTypes: [],
      resolvedOrClosed: 2,
      stillOpen: 1,
      viaDealCount: 2,
      avgResolutionDays: 4.5,
      monthly: [{ month: '2026-08', count: 3 }],
      ...overrides?.complaints,
    },
    capa: {
      relationship: 'CONFIRMED',
      total: 1,
      byStatus: { in_progress: 1 },
      byPriority: { high: 1 },
      bySource: { complaint: 1 },
      active: 1,
      terminal: 0,
      overdue: 1,
      avgOverdueDays: 3,
      correctiveStatus: { not_started: 0, in_progress: 1, completed: 0 },
      preventiveStatus: { not_started: 1, in_progress: 0, completed: 0 },
      closedCount: 0,
      avgClosureDays: null,
      indirectCount: 2,
      monthly: [{ month: '2026-08', count: 1 }],
    },
    followUps: {
      relationship: 'CONFIRMED',
      total: 8,
      byStatus: { resolved: 5, open: 3 },
      active: 3,
      terminal: 5,
      overdue: 2,
      dueToday: 1,
      avgOverdueDays: null,
      completed: 5,
      completionRate: 62.5,
      byType: { call: 6, visit: 2 },
      byPriority: { medium: 8 },
      monthly: [{ month: '2026-08', count: 8 }],
      ...overrides?.followUps,
    },
    deals: {
      relationship: 'CONFIRMED',
      travelTotal: 22,
      byStatus: { upcoming: 5, in_progress: 3, completed: 12, canceled: 2 },
      canceled: 2,
      active: 8,
      completionRate: 54.55,
      monthly: [{ month: '2026-08', count: 22 }],
      closedTotal: 7,
      closedMonthly: [{ month: '2026-08', count: 7 }],
      closedUnknownMonth: 5,
      createdTotal: 9,
      createdMonthly: [{ month: '2026-08', count: 9 }],
      closedWithEmployeeTotal: 22,
      closedWithEmployeeInPeriod: 9,
      closedWithEmployeeMonthly: [{ month: '2026-08', count: 9 }],
      closedWithEmployeeUnknownMonth: 3,
      statusAllTime: { upcoming: 5, in_progress: 3, completed: 12, canceled: 2 },
    },
    attendance:
      overrides?.attendance ?? {
        status: 'AVAILABLE',
        source: 'attendanceResults',
        result: {
          month: '2026-08',
          workDays: 26,
          presentDays: 24,
          lateDays: 2,
          absentDays: 0,
          exemptDays: 0,
          unaccountedDays: 0,
          totalMinutesLate: 55,
          lateDeductionDays: 0.5,
          absenceDeductionDays: 0,
          attendanceDeductionDays: 0.5,
          compliance: 92.3,
          engineVersion: 'v1.0',
          generatedAt: '2026-08-30T09:00:00.000Z',
        },
      },
    dataQuality: {
      windowMonths: ['2026-05', '2026-06', '2026-07', '2026-08'],
      unattributedRecords: [{ collection: 'qualityObservations', count: 2 }],
      notes: ['سجلا ملاحظات بلا تاريخ قابل للإسناد الحتمي'],
      ...overrides?.dataQuality,
    },
    evidence: {
      kpi: [
        { collection: 'monthSnapshots', recordIds: ['ms_2026_08'] },
        { collection: 'kpiSchemes', recordIds: ['sch_1'] },
      ],
      observations: { collection: 'qualityObservations', recordIds: OBSERVATION_IDS },
      deductions: { collection: 'qualityDeductions', recordIds: ['ded_1', 'ded_2'] },
      complaints: { collection: 'complaints', recordIds: ['cm_1', 'cm_2', 'cm_3'] },
      capa: { collection: 'capaCases', recordIds: ['capa_1'] },
      followUps: { collection: 'followUps', recordIds: FOLLOWUP_IDS },
      deals: { collection: 'travelDeals', recordIds: DEAL_IDS },
      attendance: { collection: 'attendanceResults', recordIds: ['att_2026_08'] },
    },
    generatedAt: '2026-08-30T10:00:00.000Z',
  };
  return base;
}

// ─────────────────────────────────────────────────────────────
//  A. View-model unit tests
// ─────────────────────────────────────────────────────────────

describe('smart report §32.1 — employee header', () => {
  it('shows identity facts, scheme and period from the dataset', () => {
    const header = buildReportHeader(makeDataset());
    assert.equal(header.employeeName, 'أحمد محمد');
    assert.equal(header.employeeCode, '001');
    assert.equal(header.periodLabel, 'أغسطس 2026');
    assert.equal(header.schemeLabel, 'مخطط جودة الحجوزات — إصدار 3');
    const dept = header.facts.find((f) => f.label === 'القسم');
    assert.equal(dept?.value, 'المبيعات');
    const employment = header.facts.find((f) => f.label === 'حالة التوظيف');
    assert.equal(employment?.value, 'نشط');
  });

  it('shows an explicit unavailable state for team and missing fields (never invented)', () => {
    const header = buildReportHeader(makeDataset());
    const team = header.facts.find((f) => f.label === 'الفريق');
    assert.equal(team?.value, UNAVAILABLE);
    assert.equal(team?.unavailable, true);

    const noPosition = buildReportHeader(
      makeDataset({ employee: { position: null } }),
    );
    const position = noPosition.facts.find((f) => f.label === 'المسمى الوظيفي');
    assert.equal(position?.value, UNAVAILABLE);
    assert.equal(position?.unavailable, true);
  });
});

describe('smart report §32.21 — archived employee historical report', () => {
  it('flags archived-but-eligible employees with a historical badge', () => {
    const header = buildReportHeader(
      makeDataset({ employee: { employmentStatus: 'archived', archivedButEligible: true, archivedAt: '2026-07-01' } }),
    );
    assert.equal(
      header.lifecycleBadges.some((b) => b.label.includes('فترة تاريخية')),
      true,
    );
    const employment = header.facts.find((f) => f.label === 'حالة التوظيف');
    assert.equal(employment?.value, 'مؤرشف');
  });
});

describe('smart report §32.2/§32.3 — KPI hero: raw score vs contribution', () => {
  it('displays the raw score and the weighted contribution as DISTINCT values', () => {
    const hero = buildKpiHero(makeDataset());
    assert.equal(hero.rawScoreDisplay, '91%');
    assert.equal(hero.hasRawScore, true);
    assert.equal(hero.contributionDisplay, '13.65 / 15');
    assert.equal(hero.weightPercent, 15);
  });

  it('shows previous month score and the percentage-point change', () => {
    const hero = buildKpiHero(makeDataset());
    assert.equal(hero.previousScoreDisplay, '88%');
    assert.equal(hero.deltaDisplay, '+3');
    assert.equal(hero.deltaToneValue, 'good');
    assert.equal(hero.directionLabel, '▲ اتجاه صاعد');
  });

  it('marks the company KPI INCOMPLETE when components are unavailable (never "Company KPI" complete)', () => {
    const hero = buildKpiHero(makeDataset());
    assert.equal(hero.rowStatusLabel, 'INCOMPLETE');
    assert.equal(hero.overallStatusLabel, 'INCOMPLETE');
  });

  it('never renders a missing quality value as zero', () => {
    const hero = buildKpiHero(
      makeDataset({
        kpi: {
          outcomeStatus: 'PENDING' as EmployeePerformanceDataset['kpi']['outcomeStatus'],
          message: 'لم يتم احتساب المؤشر بعد لهذه الفترة',
          quality: null,
          availableWeight: null,
          weightedTotal: null,
          overallStatus: null,
          rowStatus: 'PENDING',
        },
        trendPoints: [],
        mom: null,
        direction: null,
      }),
    );
    assert.equal(hero.rawScoreDisplay, UNAVAILABLE);
    assert.equal(hero.hasRawScore, false);
    assert.equal(hero.contributionDisplay, UNAVAILABLE);
    assert.equal(hero.previousScoreDisplay, null);
    assert.equal(hero.deltaDisplay, null);
    assert.equal(hero.outcomeMessage, 'لم يتم احتساب المؤشر بعد لهذه الفترة');
  });
});

describe('smart report §32.4 — KPI component status', () => {
  it('lists the quality row as AVAILABLE and the overall row as INCOMPLETE', () => {
    const view = buildKpiComponents(makeDataset());
    assert.equal(view.rows.length, 2);
    assert.equal(view.rows[0].label, 'الجودة');
    assert.equal(view.rows[0].available, true);
    assert.equal(view.rows[0].statusLabel, 'AVAILABLE');
    assert.equal(view.rows[0].contributionDisplay, '13.65 / 15');
    assert.equal(view.rows[1].isOverall, true);
    assert.equal(view.rows[1].statusLabel, 'INCOMPLETE');
    assert.equal(view.hasUnavailableComponents, true);
  });
});

describe('smart report §32.5/§32.22 — MTD vs finalized display', () => {
  it('labels the current month MTD and never FINALIZED', () => {
    const header = buildReportHeader(makeDataset());
    assert.equal(header.valueBasis, 'MTD');
    assert.equal(header.valueBasisLabel.includes('MTD'), true);
    assert.equal(header.valueBasisLabel.includes('مجمّدة'), false);
  });

  it('labels a closed historical month as finalized', () => {
    const header = buildReportHeader(
      makeDataset({ period: { monthKey: '2026-06', valueBasis: 'FINALIZED', finalized: true, finalizedAt: '2026-07-02T10:00:00.000Z' } }),
    );
    assert.equal(header.valueBasis, 'FINALIZED');
    assert.equal(header.valueBasisLabel, 'مجمّدة نهائية');
  });

  it('labels a never-closed past month as LIVE (not finalized)', () => {
    const header = buildReportHeader(
      makeDataset({ period: { monthKey: '2026-06', valueBasis: 'LIVE', finalized: false } }),
    );
    assert.equal(header.valueBasisLabel.includes('غير نهائية'), true);
  });
});

describe('smart report §32.7 — trend', () => {
  it('renders available months with scores and missing months as UNAVAILABLE (not zero)', () => {
    const view = buildTrend(
      makeDataset({
        trendPoints: [
          { monthKey: '2026-05', valueBasis: 'FINALIZED', available: true, rawScore: 82, weightedContribution: 12.3, weight: 15, rowStatus: 'FINALIZED', finalized: true, schemeId: 'sch_1', schemeVersion: 2 },
          { monthKey: '2026-06', valueBasis: 'LIVE', available: false, rawScore: null, weightedContribution: null, weight: null, rowStatus: 'PENDING', finalized: false, schemeId: null, schemeVersion: null },
          { monthKey: '2026-07', valueBasis: 'FINALIZED', available: true, rawScore: 88, weightedContribution: 13.2, weight: 15, rowStatus: 'FINALIZED', finalized: true, schemeId: 'sch_1', schemeVersion: 3 },
          { monthKey: '2026-08', valueBasis: 'MTD', available: true, rawScore: 91, weightedContribution: 13.65, weight: 15, rowStatus: 'INCOMPLETE', finalized: false, schemeId: 'sch_1', schemeVersion: 3 },
        ],
        mom: null,
        direction: null,
      }),
    );
    assert.equal(view.points.length, 4);
    assert.equal(view.points[0].scoreDisplay, '82%');
    assert.equal(view.points[1].available, false);
    assert.equal(view.points[1].scoreDisplay, UNAVAILABLE);
    assert.notEqual(view.points[1].scoreDisplay, '0%');
    assert.equal(view.availableCount, 3);
    assert.equal(view.insufficient, false);
  });

  it('reports insufficient historical data when no point is available', () => {
    const view = buildTrend(
      makeDataset({
        trendPoints: [
          { monthKey: '2026-08', valueBasis: 'MTD', available: false, rawScore: null, weightedContribution: null, weight: null, rowStatus: 'PENDING', finalized: false, schemeId: null, schemeVersion: null },
        ],
        mom: null,
        direction: null,
      }),
    );
    assert.equal(view.insufficient, true);
    assert.equal(view.availableCount, 0);
    assert.equal(view.directionLabel, null);
    assert.equal(view.deltaDisplay, null);
  });

  it('keeps the DOWN direction and negative delta semantically bad', () => {
    const view = buildTrend(
      makeDataset({
        direction: 'DOWN',
        mom: { currentMonth: '2026-08', previousMonth: '2026-07', currentRawScore: 84, previousRawScore: 88, deltaPoints: -4, growthPercent: -4.55 },
      }),
    );
    assert.equal(view.deltaDisplay, '-4');
    assert.equal(view.deltaToneValue, 'bad');
    assert.equal(view.previousScoreDisplay, '88%');
  });
});

describe('smart report §32.8 — observation aggregation', () => {
  it('uses the engine totals verbatim (no re-aggregation)', () => {
    const view = buildObservations(makeDataset());
    assert.equal(view.total, 14);
    assert.equal(view.approved, 10);
    assert.equal(view.pending, 3);
    assert.equal(view.rejected, 1);
    const critical = view.severityChips.find((c) => c.label === 'حرجة');
    assert.equal(critical?.count, 1);
    assert.equal(view.categoryRows.length, 2);
    assert.equal(view.typeRows.length, 1);
    assert.equal(view.minOccurrences, 2);
  });
});

describe('smart report §32.9 — repeated issues', () => {
  it('shows deterministic groups with occurrence counts and first/last dates', () => {
    const view = buildRepeatedIssues(makeDataset());
    assert.equal(view.empty, false);
    assert.equal(view.categoryRows.length, 1);
    const row = view.categoryRows[0];
    assert.equal(row.occurrenceCount, 7);
    assert.equal(row.firstOccurrence, '03/08/2026');
    assert.equal(row.lastOccurrence, '27/08/2026');
    assert.equal(row.windowSummary, '12 مرات عبر 4 أشهر');
    assert.equal(row.recordCount, 7);
  });

  it('maps the engine unclassified key to an explicit label', () => {
    const view = buildObservations(makeDataset());
    assert.equal(view.categoryRows[1].categoryName, 'غير مصنّف');
  });
});

describe('smart report §32.10 — deductions', () => {
  it('keeps day-based and monetary totals separate', () => {
    const view = buildDeductions(makeDataset());
    assert.equal(view.count, 2);
    assert.equal(view.totalDays, 1.5);
    assert.equal(view.totalAmount, 900);
    assert.equal(view.records.length, 2);
    assert.equal(view.records[0].relatedCapaId, 'capa_1');
    assert.equal(view.empty, false);
  });
});

describe('smart report §32.11 — complaints', () => {
  it('shows counts, resolution split and average resolution time', () => {
    const view = buildComplaints(makeDataset());
    assert.equal(view.total, 3);
    assert.equal(view.resolvedOrClosed, 2);
    assert.equal(view.stillOpen, 1);
    assert.equal(view.viaDealCount, 2);
    assert.equal(view.avgResolutionDisplay, '4.5 يوم');
    assert.equal(view.relationshipLabel, 'ربط مباشر مؤكد');
  });

  it('shows resolution time as explicitly unavailable when not measurable', () => {
    const view = buildComplaints(makeDataset({ complaints: { avgResolutionDays: null } }));
    assert.equal(view.avgResolutionDisplay, UNAVAILABLE);
  });

  it('flags indirect-only attribution instead of asserting the employee', () => {
    const view = buildComplaints(makeDataset({ complaints: { relationship: 'INDIRECT' } }));
    assert.equal(view.relationship, 'INDIRECT');
    assert.equal(view.relationshipLabel.includes('غير مباشر'), true);
  });
});

describe('smart report §32.12 — CAPA', () => {
  it('preserves canonical counts and corrective/preventive status', () => {
    const view = buildCapa(makeDataset());
    assert.equal(view.total, 1);
    assert.equal(view.active, 1);
    assert.equal(view.terminal, 0);
    assert.equal(view.overdue, 1);
    assert.equal(view.indirectCount, 2);
    const corrective = view.correctiveChips.find((c) => c.label === 'قيد التنفيذ');
    assert.equal(corrective?.count, 1);
    const preventive = view.preventiveChips.find((c) => c.label === 'لم تبدأ');
    assert.equal(preventive?.count, 1);
    assert.equal(view.avgClosureDisplay, UNAVAILABLE);
    assert.equal(view.avgOverdueDisplay, '3 يوم');
  });
});

describe('smart report §32.13 — follow-ups', () => {
  it('uses the canonical overdue definition values and completion rate', () => {
    const view = buildFollowUps(makeDataset());
    assert.equal(view.total, 8);
    assert.equal(view.completed, 5);
    assert.equal(view.active, 3);
    assert.equal(view.overdue, 2);
    assert.equal(view.completionRateDisplay, '62.5%');
  });

  it('shows "Completion delay: Not available" rather than estimating', () => {
    const view = buildFollowUps(makeDataset());
    assert.equal(view.avgOverdueDisplay, UNAVAILABLE);
  });
});

describe('smart report §32.14 — deals', () => {
  it('uses the stored status vocabulary and engine completion rate', () => {
    const view = buildDeals(makeDataset());
    assert.equal(view.travelTotal, 22);
    assert.equal(view.canceled, 2);
    assert.equal(view.active, 8);
    assert.equal(view.completionRateDisplay, '54.55%');
    const upcoming = view.statusChips.find((c) => c.label === 'قادمة');
    assert.equal(upcoming?.count, 5);
    const canceled = view.statusChips.find((c) => c.label === 'ملغاة');
    assert.equal(canceled?.count, 2);
  });

  it('§DEAL-DATES — keeps the CLOSED dimension separate from the TRAVEL snapshot', () => {
    const view = buildDeals(makeDataset());
    // Closed deals are counted by closedAt (7), NOT from the
    // byStatus.completed status snapshot (12) — the difference is the
    // completed deals whose closure month is unknown (5).
    assert.equal(view.closedTotal, 7);
    assert.equal(view.closedUnknownMonth, 5);
  });
});

describe('smart report §32.15 — attendance context', () => {
  it('renders stored attendance facts as context only', () => {
    const view = buildAttendance(makeDataset());
    assert.equal(view.available, true);
    const late = view.facts.find((f) => f.label === 'أيام التأخير');
    assert.equal(late?.value, '2');
    const compliance = view.facts.find((f) => f.label === 'نسبة الالتزام');
    assert.equal(compliance?.value, '92.3%');
  });

  it('shows an explicit NOT_AVAILABLE state without a stored result', () => {
    const view = buildAttendance(
      makeDataset({
        attendance: { status: 'NOT_AVAILABLE', source: 'attendanceResults', result: null },
      }),
    );
    assert.equal(view.available, false);
    assert.equal(view.facts.length, 0);
  });
});

describe('smart report §32.16/§32.17 — evidence counts reconcile', () => {
  it('derives every evidence count from recordIds.length of the dataset', () => {
    const groups = buildEvidenceGroups(makeDataset());
    const byCollection = new Map(groups.map((g) => [g.collection, g]));
    assert.equal(byCollection.get('qualityObservations')?.count, 14);
    assert.equal(byCollection.get('qualityDeductions')?.count, 2);
    assert.equal(byCollection.get('complaints')?.count, 3);
    assert.equal(byCollection.get('capaCases')?.count, 1);
    assert.equal(byCollection.get('followUps')?.count, 8);
    assert.equal(byCollection.get('travelDeals')?.count, 22);
    assert.equal(byCollection.get('attendanceResults')?.count, 1);
    assert.equal(byCollection.get('monthSnapshots')?.count, 1);
    assert.equal(byCollection.get('kpiSchemes')?.count, 1);
    for (const g of groups) assert.equal(g.count, g.recordIds.length);
  });

  it('maps source pages only where the application actually navigates', () => {
    const groups = buildEvidenceGroups(makeDataset());
    const byCollection = new Map(groups.map((g) => [g.collection, g]));
    assert.equal(byCollection.get('qualityObservations')?.targetPage, 'observations');
    assert.equal(byCollection.get('complaints')?.targetPage, 'complaints');
    assert.equal(byCollection.get('capaCases')?.targetPage, 'capa');
    assert.equal(byCollection.get('followUps')?.targetPage, 'followUps');
    assert.equal(byCollection.get('travelDeals')?.targetPage, 'travel');
    assert.equal(byCollection.get('attendanceResults')?.targetPage, 'attendance');
    // qualityDeductions has no dedicated page — ids stay visible, no link.
    assert.equal(byCollection.get('qualityDeductions')?.targetPage, null);
  });
});

describe('smart report §32.17/§32.18 — data quality', () => {
  it('surfaces unattributed records and notes without hiding them', () => {
    const view = buildDataQuality(makeDataset());
    assert.equal(view.hasIssues, true);
    assert.equal(view.unattributedChips.length, 1);
    assert.equal(view.unattributedChips[0].count, 2);
    assert.equal(view.notes.length, 1);
  });

  it('reports no issues section when the dataset is clean', () => {
    const view = buildDataQuality(
      makeDataset({ dataQuality: { unattributedRecords: [], notes: [] } }),
    );
    assert.equal(view.hasIssues, false);
  });
});

describe('smart report §32.18 — missing data is never zero', () => {
  it('formatSignedPoints passes null through instead of fabricating 0', () => {
    assert.equal(formatSignedPoints(null), null);
    assert.equal(formatSignedPoints(undefined), null);
    assert.equal(formatSignedPoints(0), '0');
    assert.equal(formatSignedPoints(5), '+5');
    assert.equal(formatSignedPoints(-4), '-4');
  });

  it('previousMonthKey handles year boundaries', () => {
    assert.equal(previousMonthKey('2026-01'), '2025-12');
    assert.equal(previousMonthKey('2026-08'), '2026-07');
  });
});

// ─────────────────────────────────────────────────────────────
//  B. Static source-contract tests
// ─────────────────────────────────────────────────────────────

const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const SMART_DIR = join(
  PROJECT_ROOT, 'src', 'components', 'pages', 'quality-kpi', 'smart-report',
);
const pageSrc = readFileSync(join(SMART_DIR, 'SmartQualityReportPage.tsx'), 'utf8');
const sectionsSrc = readFileSync(join(SMART_DIR, 'report-sections.tsx'), 'utf8');
const viewmodelSrc = readFileSync(join(SMART_DIR, 'view-model.ts'), 'utf8');

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('smart report §27 — single Performance Intelligence data source', () => {
  it('the page consumes exactly the usePerformanceIntelligence hook', () => {
    const src = stripComments(pageSrc);
    const matches = src.match(/usePerformanceIntelligence\(/g) ?? [];
    assert.equal(matches.length, 1, 'the report must build from ONE analytical dataset');
  });

  it('the page performs no independent section fetches (no fetch/useQuery/other endpoints)', () => {
    const src = stripComments(pageSrc);
    assert.equal(/\bfetch\(/.test(src), false, 'no raw fetch in the report page (refetch() is fine)');
    assert.equal(/useQuery\(/.test(src), false, 'no ad-hoc useQuery in the report page');
    assert.equal(/\/api\//.test(src), false, 'no direct endpoint calls — the hook owns the URL');
  });
});

describe('smart report §1 — presentation-only client bundle', () => {
  it('imports the dataset type TYPE-ONLY (server barrel never enters the client)', () => {
    assert.equal(
      /import\s+type\s+\{\s*EmployeePerformanceDataset\s*\}.*from\s+'@\/lib\/performance-intelligence'/.test(
        stripComments(pageSrc),
      ),
      true,
      'page must use `import type` for the dataset shape',
    );
    assert.equal(
      /import\s+type\s+\{[^}]*\}\s+from\s+'@\/lib\/performance-intelligence'/.test(stripComments(viewmodelSrc)),
      true,
      'view-model must use `import type` for the dataset shape',
    );
  });

  it('contains no new KPI or business calculations (view models map verbatim)', () => {
    const src = stripComments(viewmodelSrc);
    assert.equal(
      /rawScore\s*[*\-+\/]=|weightedContribution\s*[*\-+\/]=|\bweights\s*[*\/]/.test(src),
      false,
      'no arithmetic over engine scores/weights in the UI layer',
    );
  });
});

describe('smart report §28 — permission reuse', () => {
  it('mounts under the EXISTING kpiReports permission key (no new permission system)', () => {
    const permSrc = stripComments(
      readFileSync(join(PROJECT_ROOT, 'src', 'config', 'permissions.ts'), 'utf8'),
    );
    const entry = permSrc.match(/\{[^{}]*id:\s*'smartQualityReport'[^{}]*\}/);
    assert.ok(entry, 'smartQualityReport must be registered in APP_PAGES');
    assert.equal(entry[0].includes("permissionKey: 'kpiReports'"), true);
  });

  it('the page guards against unauthorized access with an explicit denial state', () => {
    const src = stripComments(pageSrc);
    assert.equal(src.includes("usePermissions('kpiReports')"), true);
    assert.equal(src.includes('UnauthorizedState'), true, 'explicit unauthorized UI state required');
  });
});

describe('smart report §32.20/§26 — API error state', () => {
  it('renders a clear error card with retry — no redirect, no zeros', () => {
    const src = stripComments(pageSrc);
    assert.equal(src.includes('datasetQuery.isError'), true);
    assert.equal(src.includes('datasetQuery.refetch()'), true, 'an explicit retry action is required');
    assert.equal(/router\.(push|replace)/.test(src), false, 'errors must NOT redirect away');
    // §I18N-BILINGUAL — the message lives in the dictionary (smart.loadFailedNote).
    assert.equal(src.includes("t('smart.loadFailedNote')"), true);
  });
});

describe('smart report §24 — print support', () => {
  it('prints through the dedicated report host (openPrintReport + shared adapter), never the live UI', () => {
    const src = stripComments(pageSrc);
    // Header chrome never prints.
    assert.equal(src.includes('no-print'), true);
    // §PRINT standardization: the page projects its dataset into the
    // shared clean A4 model via the print host — raw window.print()
    // of the live page was REMOVED system-wide.
    assert.equal(src.includes('openPrintReport'), true);
    assert.equal(src.includes('performanceDatasetToPrintModel'), true);
    assert.equal(src.includes('window.print()'), false, 'live-UI printing is forbidden — use the print host');
  });
});

describe('smart report §32.23/§30 — no AI-generated content', () => {
  it('contains no AI/LLM imports or calls in any smart-report file', () => {
    for (const [name, src] of [['page', pageSrc], ['sections', sectionsSrc], ['view-model', viewmodelSrc]] as const) {
      assert.equal(
        /openai|gemini|anthropic|claude|langchain|\bllm\b|\bgpt\b|chatgpt|prompt/i.test(stripComments(src)),
        false,
        `${name} must not reference any AI provider`,
      );
    }
  });

  it('the future AI area is a labeled placeholder only ("coming in a future phase")', () => {
    const src = stripComments(sectionsSrc);
    assert.equal(src.includes('SmartAnalysisPlaceholder'), true);
    assert.equal(src.includes('قادم في مرحلة لاحقة'), true);
    assert.equal(src.includes('حقائق موثقة'), true, 'VERIFIED FACTS labeling (§19) must be present');
  });
});

describe('smart report §33 — registration & regression safety', () => {
  it('is routed by the SPA page router without touching existing tabs', () => {
    const appPageSrc = stripComments(readFileSync(join(PROJECT_ROOT, 'src', 'app', 'page.tsx'), 'utf8'));
    assert.equal(appPageSrc.includes("case 'smartQualityReport':"), true);
    // Existing Phase 2/3 tabs remain untouched in the router.
    assert.equal(appPageSrc.includes("case 'kpiReports':"), true);
    assert.equal(appPageSrc.includes("case 'monthClose':"), true);
    assert.equal(appPageSrc.includes("case 'qualityAuditLog':"), true);
  });

  it('the performance analysis tab (Phase 3) remains unmodified', () => {
    const tabSrc = readFileSync(
      join(PROJECT_ROOT, 'src', 'components', 'pages', 'quality-kpi', 'PerformanceAnalysisTab.tsx'),
      'utf8',
    );
    assert.equal(tabSrc.includes('MINIMAL verification view'), true);
  });
});
