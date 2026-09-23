// ══════════════════════════════════════════════════════════════
//  Employee Performance Intelligence — focused tests (Phase 3, §29)
//
//  Run: npx tsx --test src/lib/performance-intelligence/__tests__/performance-intelligence.test.ts
//
//  Covers the mandatory Phase-3 scenarios:
//    1  Employee KPI facts (canonical engine values)
//    2  Quality observation aggregation
//    3  Status aggregation (approval + resolution)
//    4  Repeated issue detection (category / type / window recurrence)
//    5  Deduction aggregation (days vs amounts, separate units)
//    6  Complaint aggregation (+ no invented relationships)
//    7  CAPA aggregation (canonical overdue, indirect links)
//    8  Follow-up aggregation (canonical overdue/due-today)
//    9  Deal aggregation (stored status vocabulary only)
//    10 Attendance contextual data (stored result; NOT in KPI)
//    11 Current vs previous period (percentage POINTS)
//    12 Missing historical period (never fabricated)
//    13 Archived employee (eligible historical period)
//    14 Restored employee (history preserved)
//    15 Evidence traceability (record ids per collection)
//    16 Permission enforcement (route contract, static analysis)
//    17 No source records modified
//    18 No duplicated records
//    19 Quality KPI value identical to canonical engine
//    20 Weighted contribution uses the configured weight
//    + dataset serializability (future Python contract §26)
//
//  Convention: pure builders + in-memory loaders (no Firebase mocking).
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getEmployeePerformanceDataset, aggregateTravelDeals } from '@/lib/performance-intelligence';
import type { PerformanceIntelligenceLoaders } from '@/lib/performance-intelligence';
import { buildEmployeeKpiReport, toFrameworkEmployee } from '@/lib/kpi-reporting';
import { buildEmployeeKpiResult, withFinalizedAt } from '@/lib/kpi-framework';
import type { EmployeeKpiResult, KpiScheme } from '@/lib/kpi-framework';
import { computeEmployeeScore, computeMonthSnapshot } from '@/lib/metrics/kpiMetrics';
import type { KpiSettings, MonthSnapshot, QualityObservation } from '@/types/quality-kpi';
import type {
  CAPACase,
  CustomerComplaint,
  FollowUp,
  QualityDeduction,
  TravelDeal,
} from '@/types';
import type { ReportEmployee } from '@/lib/kpi-reporting';
import type { StoredAttendanceResult } from '@/lib/attendance';

// ─────────────────────────────────────────────────────────────
//  Time anchors + settings
// ─────────────────────────────────────────────────────────────

const NOW_AUG = new Date(2026, 7, 21, 12, 0, 0); // 2026-08-21 noon
const NOW_SEP = new Date(2026, 8, 5, 12, 0, 0);  // 2026-09-05 noon

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
  trendCalculation: 'simpleAverage',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ─────────────────────────────────────────────────────────────
//  Scheme fixtures (configured weight drives the contribution)
// ─────────────────────────────────────────────────────────────

function makeScheme(overrides: Partial<KpiScheme> = {}): KpiScheme {
  return {
    id: 'scheme_v1',
    schemaVersion: 1,
    name: 'مخطط أداء الموظفين',
    description: null,
    status: 'ACTIVE',
    version: 1,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    isDefault: true,
    applicableDepartments: null,
    components: [
      { componentId: 'quality', name: 'الجودة', weight: 15, owner: 'quality', calculationType: 'quality_engine', status: 'ACTIVE', configuration: null },
      { componentId: 'direct_manager', name: 'المدير المباشر', weight: 15, owner: 'management', calculationType: 'none', status: 'ACTIVE', configuration: null },
      { componentId: 'hr', name: 'الموارد البشرية', weight: 10, owner: 'hr', calculationType: 'none', status: 'ACTIVE', configuration: null },
      { componentId: 'target', name: 'المستهدف', weight: 60, owner: 'management', calculationType: 'none', status: 'ACTIVE', configuration: null },
    ],
    previousSchemeId: null,
    createdBy: 'tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const V1 = makeScheme();

/** Future configuration after a weight change (Quality 20%). */
function makeSchemeV2(): KpiScheme {
  const v2 = makeScheme({ id: 'scheme_v2', version: 2, previousSchemeId: 'scheme_v1' });
  v2.components = [
    { ...v2.components[0], weight: 20 },
    { ...v2.components[1] },
    { ...v2.components[2] },
    { ...v2.components[3] },
  ];
  return v2;
}

// ─────────────────────────────────────────────────────────────
//  Employee fixtures
// ─────────────────────────────────────────────────────────────

function makeEmployee(over: Partial<ReportEmployee> & { id: string }): ReportEmployee {
  return {
    code: null,
    name: over.id,
    department: 'المبيعات',
    position: 'مندوب مبيعات',
    status: 'active',
    hireDate: null,
    createdAt: '2026-01-10T00:00:00.000Z',
    archivedAt: null,
    orgNodeId: null,
    ...over,
  };
}

const EMPLOYEES: ReportEmployee[] = [
  makeEmployee({ id: 'emp_ahmed', name: 'أحمد محمد', code: '001' }),
  makeEmployee({
    id: 'emp_sara',
    name: 'سارة علي',
    code: '002',
    status: 'archived',
    archivedAt: '2026-08-20T10:00:00.000Z',
  }),
  makeEmployee({
    id: 'emp_karim',
    name: 'كريم سيد',
    code: '003',
    // Restored employees keep archivedAt; the status field is current truth.
    status: 'active',
    archivedAt: '2026-06-10T10:00:00.000Z',
  }),
  makeEmployee({ id: 'emp_nodata', name: 'منى حسن', code: '004', department: 'تقنية المعلومات' }),
];

const EVENTS_BY_EMPLOYEE = new Map<string, Array<{ kind: 'archived' | 'restored'; effectiveAt: string }>>([
  ['emp_sara', [{ kind: 'archived', effectiveAt: '2026-08-20T10:00:00.000Z' }]],
  ['emp_karim', [
    { kind: 'archived', effectiveAt: '2026-06-10T10:00:00.000Z' },
    { kind: 'restored', effectiveAt: '2026-07-05T10:00:00.000Z' },
  ]],
]);

// ─────────────────────────────────────────────────────────────
//  Observation fixtures
// ─────────────────────────────────────────────────────────────

let obsCounter = 0;
function makeObs(over: Partial<QualityObservation> & { employeeId: string; month: string; points: number }): QualityObservation {
  obsCounter += 1;
  return {
    id: over.id ?? `obs_${obsCounter}`,
    schemaVersion: 1,
    employeeName: 'x',
    department: 'd',
    positionSnapshot: 'p',
    observerId: 'u1',
    observerName: 'مراقب الجودة',
    observationDate: over.observationDate ?? '05/08/2026',
    type: over.type ?? 'deduction',
    severity: over.severity ?? 'medium',
    categoryId: over.categoryId ?? 'cat_late',
    categoryName: over.categoryName ?? 'تأخر المتابعة',
    categoryWeight: 1,
    notes: over.notes ?? 'ملاحظة جودة',
    evidence: over.evidence ?? '',
    status: over.status ?? 'resolved',
    relatedCapaId: over.relatedCapaId ?? null,
    correctiveAction: '',
    dueDate: null,
    resolvedDate: null,
    applyPointDeduction: over.applyPointDeduction ?? true,
    isBonus: over.isBonus ?? false,
    approvalStatus: over.approvalStatus ?? 'approved',
    approvalHistory: [],
    auditLog: [],
    createdById: 'u1',
    createdByName: 'منشئ',
    clientRequestId: null,
    createdAt: '2026-08-05T10:00:00.000Z',
    updatedAt: '2026-08-05T10:00:00.000Z',
    ...over,
  } as QualityObservation;
}

/**
 * Ahmed August (open month, live): 5 observations →
 *   approved deductions 5+4 = 9 → raw score 91.
 *   pending: cat_offer deduction + cat_bonus bonus (neither counts).
 *   rejected: 1 (never affects the score).
 */
const OBSERVATIONS: QualityObservation[] = [
  makeObs({ id: 'obs_a1', employeeId: 'emp_ahmed', month: '2026-08', points: 5, observationDate: '03/08/2026', categoryId: 'cat_late', categoryName: 'تأخر المتابعة', severity: 'high' }),
  makeObs({ id: 'obs_a2', employeeId: 'emp_ahmed', month: '2026-08', points: 4, observationDate: '12/08/2026', categoryId: 'cat_late', categoryName: 'تأخر المتابعة', status: 'open', severity: 'medium' }),
  makeObs({ id: 'obs_a3', employeeId: 'emp_ahmed', month: '2026-08', points: 3, observationDate: '15/08/2026', categoryId: 'cat_offer', categoryName: 'اكتمال العرض', approvalStatus: 'pending', status: 'in_review', severity: 'low' }),
  makeObs({ id: 'obs_a4', employeeId: 'emp_ahmed', month: '2026-08', points: 2, observationDate: '18/08/2026', categoryId: 'cat_late', categoryName: 'تأخر المتابعة', approvalStatus: 'rejected', status: 'closed', severity: 'critical' }),
  makeObs({ id: 'obs_a5', employeeId: 'emp_ahmed', month: '2026-08', points: 2, observationDate: '20/08/2026', categoryId: 'cat_bonus', categoryName: 'مكافأة سرعة', type: 'bonus', isBonus: true, approvalStatus: 'pending', severity: 'low' }),
  // July (closed month) — feeds window recurrence only.
  makeObs({ id: 'obs_j1', employeeId: 'emp_ahmed', month: '2026-07', points: 6, observationDate: '05/07/2026', categoryId: 'cat_late', categoryName: 'تأخر المتابعة' }),
  makeObs({ id: 'obs_j2', employeeId: 'emp_ahmed', month: '2026-07', points: 4, observationDate: '20/07/2026', categoryId: 'cat_offer', categoryName: 'اكتمال العرض' }),
  // Another employee — must never leak into ahmed's dataset.
  makeObs({ id: 'obs_s1', employeeId: 'emp_sara', month: '2026-08', points: 5, observationDate: '08/08/2026' }),
];

// ─────────────────────────────────────────────────────────────
//  Frozen snapshot fixtures (May 82 / June 86 / July 88)
// ─────────────────────────────────────────────────────────────

function frozenResult(employeeId: string, month: string, score: number): EmployeeKpiResult {
  return buildEmployeeKpiResult({
    employee: { id: employeeId },
    scheme: V1,
    period: month,
    qualityScore: { score, deductionPoints: 100 - score, bonusPoints: 0, observationCount: 2 },
    origin: 'month_snapshot',
    finalizedAt: '2026-08-01T00:00:00.000Z',
  });
}

function makeClosedSnapshot(month: string, scores: Record<string, number>, withKpiResults: boolean): MonthSnapshot {
  const kpiResults: Record<string, EmployeeKpiResult> = {};
  const employeeScores: MonthSnapshot['employeeScores'] = {};
  for (const [employeeId, score] of Object.entries(scores)) {
    if (withKpiResults) kpiResults[employeeId] = frozenResult(employeeId, month, score);
    employeeScores[employeeId] = {
      employeeSnapshot: {
        employeeId,
        employeeName: EMPLOYEES.find((e) => e.id === employeeId)?.name ?? employeeId,
        departmentId: 'd1',
        departmentName: 'المبيعات',
        position: 'مندوب مبيعات',
        supervisorId: null,
      },
      score,
      deductionPoints: 100 - score,
      bonusPoints: 0,
      weightedPoints: 0,
      observationCount: 2,
      approvedCount: 2,
      pendingCount: 0,
      rejectedCount: 0,
      categoryTotals: {},
      rank: 1,
      dept: 'المبيعات',
    };
  }
  return {
    id: month,
    schemaVersion: 1,
    monthKey: month,
    status: 'closed',
    closedAt: '2026-08-01T00:00:00.000Z',
    closedBy: 'u1',
    closedByName: 'المدير العام',
    reopenCount: 0,
    reopenReason: '',
    auditLog: [],
    generatedAt: '2026-08-01T00:00:00.000Z',
    settingsSnapshot: SETTINGS,
    employeeScores,
    departmentScores: {},
    topEmployees: [],
    bottomEmployees: [],
    categoryTotals: {},
    approvalStats: { total: 0, pending: 0, approved: 0, rejected: 0, avgApprovalHours: 0 },
    ...(withKpiResults ? { kpiResults: withFinalizedAt(kpiResults, '2026-08-01T00:00:00.000Z') } : {}),
  };
}

const SNAPSHOTS = new Map<string, MonthSnapshot>([
  ['2026-04', makeClosedSnapshot('2026-04', { emp_ahmed: 85 }, false)], // legacy (no framework results)
  ['2026-05', makeClosedSnapshot('2026-05', { emp_ahmed: 82, emp_karim: 78 }, true)],
  ['2026-06', makeClosedSnapshot('2026-06', { emp_ahmed: 86 }, true)],
  ['2026-07', makeClosedSnapshot('2026-07', { emp_ahmed: 88, emp_sara: 84 }, true)],
]);

// ─────────────────────────────────────────────────────────────
//  Operational fixtures
// ─────────────────────────────────────────────────────────────

function makeDeduction(over: Partial<QualityDeduction> & { id: string }): QualityDeduction {
  return {
    employeeId: 'emp_ahmed',
    date: '10/08/2026',
    type: 'late_followup',
    description: 'خصم جودة',
    deductionDays: 1,
    deductionAmount: 0,
    evidence: null,
    month: '2026-08',
    relatedCapaId: null,
    createdAt: '2026-08-10T10:00:00.000Z',
    ...over,
  };
}

const DEDUCTIONS: QualityDeduction[] = [
  makeDeduction({ id: 'qd_1', date: '10/08/2026', type: 'late_followup', deductionDays: 1, deductionAmount: 0 }),
  makeDeduction({ id: 'qd_2', date: '22/08/2026', type: 'offer_error', deductionDays: 0.5, deductionAmount: 200 }),
  makeDeduction({ id: 'qd_3', date: '05/09/2026', month: '2026-09', type: 'late_followup', deductionDays: 1, deductionAmount: 0 }),
];

function makeComplaint(over: Partial<CustomerComplaint> & { id: string }): CustomerComplaint {
  return {
    customerName: 'عميل',
    customerContact: '01000000000',
    dealId: null,
    employeeId: 'emp_ahmed',
    complaintType: 'service_quality',
    description: 'شكوى',
    severity: 'medium',
    status: 'open',
    resolution: null,
    responsiblePerson: 'u1',
    compensationProvided: null,
    createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:00.000Z',
    resolvedAt: null,
    relatedCapaIds: [],
    ...over,
  };
}

const COMPLAINTS: CustomerComplaint[] = [
  makeComplaint({ id: 'c_1', createdAt: '2026-08-03T10:00:00.000Z', status: 'resolved', resolvedAt: '2026-08-10T10:00:00.000Z', dealId: 'deal_x', severity: 'high' }),
  makeComplaint({ id: 'c_2', createdAt: '2026-08-15T10:00:00.000Z', status: 'open', severity: 'high' }),
  makeComplaint({ id: 'c_3', createdAt: '2026-08-20T10:00:00.000Z', complaintType: 'delay', status: 'closed', resolvedAt: '2026-08-21T10:00:00.000Z', severity: 'low' }),
  // Deal-linked but WITHOUT an employee link — must NOT be attributed (no invention).
  makeComplaint({ id: 'c_4', employeeId: null, dealId: 'deal_x', createdAt: '2026-08-18T10:00:00.000Z' }),
];

function makeCapa(over: Partial<CAPACase> & { id: string }): CAPACase {
  return {
    capaId: `CAPA-2026-${over.id.slice(5)}`,
    title: 'حالة CAPA',
    department: 'المبيعات',
    employeeId: 'emp_ahmed',
    relatedFollowUpId: null,
    relatedRiskId: null,
    relatedComplaintId: null,
    relatedQualityDeductionId: null,
    relatedHrDeductionId: null,
    createdBy: 'u1',
    createdByName: 'مدير الجودة',
    issueCategory: 'quality_issue',
    problemDescription: 'وصف المشكلة',
    impactLevel: 'medium',
    impactDescription: '',
    rootCauseCategory: 'human_error',
    rootCauseDescription: '',
    rootCauseVerification: '',
    correctiveAction: 'إجراء تصحيحي',
    correctiveAssignedTo: 'u1',
    correctiveDueDate: '2026-08-04',
    correctiveStatus: 'in_progress',
    correctiveEvidence: '',
    preventiveAction: '',
    preventiveAssignedTo: 'u1',
    preventiveDueDate: '',
    preventiveStatus: 'not_started',
    preventiveVerificationMethod: '',
    verificationDate: '',
    verifiedBy: '',
    verificationResult: '',
    verificationNotes: '',
    status: 'corrective_action',
    priority: 'high',
    assignedTo: 'u1',
    closureDate: '',
    closedBy: '',
    finalComments: '',
    relatedEmployeeIds: [],
    source: 'complaint',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    closedAt: null,
    timeline: [],
    attachments: [],
    lessonsLearned: '',
    slaDays: 0,
    overdueDays: 0,
    ...over,
  };
}

const CAPA_CASES: CAPACase[] = [
  // Active + overdue (due 2026-08-04, now 2026-08-21 → 17 days overdue).
  makeCapa({ id: 'capa_1', createdAt: '2026-08-01T10:00:00.000Z', correctiveDueDate: '2026-08-04' }),
  // Closed + effective (created Aug 5, closed Aug 15 → 10 days).
  makeCapa({
    id: 'capa_2',
    createdAt: '2026-08-05T10:00:00.000Z',
    status: 'closed',
    closedAt: '2026-08-15T10:00:00.000Z',
    correctiveStatus: 'completed',
    preventiveStatus: 'completed',
    correctiveDueDate: '2026-08-12',
    verificationResult: 'effective',
    source: 'audit',
    priority: 'medium',
  }),
  // INDIRECT link only (relatedEmployeeIds, employeeId null).
  makeCapa({ id: 'capa_3', employeeId: null, relatedEmployeeIds: ['emp_ahmed'], createdAt: '2026-08-10T10:00:00.000Z', status: 'investigation' }),
  // Someone else's CAPA — never leaks.
  makeCapa({ id: 'capa_4', employeeId: 'emp_sara', createdAt: '2026-08-12T10:00:00.000Z' }),
];

function makeFollowUp(over: Partial<FollowUp> & { id: string }): FollowUp {
  return {
    employeeId: 'emp_ahmed',
    date: '05/08/2026',
    followUpType: 'quality',
    subject: 'متابعة',
    detailedDescription: '',
    positiveNotes: '',
    negativeNotes: '',
    rootCause: '',
    actionTaken: '',
    department: 'المبيعات',
    position: 'مندوب',
    priorityLevel: 'medium',
    responsiblePerson: 'u1',
    nextFollowUpDate: null,
    followUpRequired: true,
    status: 'open',
    score: 3,
    attachments: [],
    createdById: 'u1',
    createdByName: 'مدير',
    relatedDeductionId: null,
    relatedCapaId: null,
    createdAt: '2026-08-05T10:00:00.000Z',
    updatedAt: '2026-08-05T10:00:00.000Z',
    ...over,
  };
}

const FOLLOW_UPS: FollowUp[] = [
  makeFollowUp({ id: 'f_1', date: '05/08/2026', nextFollowUpDate: '2026-08-15', status: 'open', priorityLevel: 'high' }),      // overdue (6 days at Aug 21)
  makeFollowUp({ id: 'f_2', date: '08/08/2026', nextFollowUpDate: '2026-08-21', status: 'under_follow_up', followUpType: 'behavior' }), // due today
  makeFollowUp({ id: 'f_3', date: '10/08/2026', nextFollowUpDate: '2026-08-09', status: 'resolved', followUpType: 'coaching', priorityLevel: 'low' }),
  makeFollowUp({ id: 'f_4', date: '12/08/2026', status: 'closed', followUpType: 'improvement', priorityLevel: 'low' }),
  // Unattributable (no valid date/timestamp) — surfaced, never guessed.
  makeFollowUp({ id: 'f_5', date: 'ليس تاريخًا', createdAt: '', status: 'open' }),
];

function makeDeal(over: Partial<TravelDeal> & { id: string }): TravelDeal {
  return {
    employeeId: 'emp_ahmed',
    destination: 'شرم الشيخ',
    departureDate: '02/08/2026',
    returnDate: null,
    dealerName: null,
    customerNames: null,
    hasInternationalFlight: false,
    hasDomesticFlight: true,
    hasHotel: false,
    hasVisa: false,
    hasTours: false,
    hasTransportation: false,
    internationalFlightStatus: null,
    domesticFlightStatus: 'completed',
    hotelStatus: null,
    visaStatus: null,
    toursStatus: null,
    transportationStatus: null,
    notes: null,
    status: 'completed',
    createdAt: '2026-08-02T10:00:00.000Z',
    ...over,
  };
}

const DEALS: TravelDeal[] = [
  makeDeal({ id: 'd_1', departureDate: '02/08/2026', status: 'completed' }),
  makeDeal({ id: 'd_2', departureDate: '06/08/2026', status: 'canceled' }),
  makeDeal({ id: 'd_3', departureDate: '25/08/2026', status: 'in_progress' }),
  makeDeal({ id: 'd_4', departureDate: '10/07/2026', status: 'completed' }), // July — window only
];

function att(employeeId: string, month: string, compliance: number): StoredAttendanceResult {
  return {
    employeeId,
    month,
    workDays: 26,
    presentDays: 24,
    lateDays: 2,
    absentDays: 1,
    exemptDays: 0,
    unaccountedDays: 0,
    totalMinutesLate: 45,
    lateDeductionDays: 0.25,
    absenceDeductionDays: 1,
    attendanceDeductionDays: 1.25,
    autoExemptDays: 0,
    bonusDays: 0,
    effectiveWorkingDays: 25,
    compliance,
    daily: [],
    id: `${month}_${employeeId}`,
    schemaVersion: 1,
    employeeSnapshot: { employeeId, employeeName: 'موظف تجريبي', department: 'مبيعات', position: 'موظف' },
    policySnapshot: {} as StoredAttendanceResult['policySnapshot'],
    policyFingerprint: 'deadbeef',
    engineVersion: 'attendance-v1',
    generatedAt: '2026-08-01T10:00:00.000Z',
    generatedBy: { id: 'mgr1', name: 'مدير' },
  };
}

const ATTENDANCE_RESULTS: StoredAttendanceResult[] = [att('emp_ahmed', '2026-08', 96)];

// ─────────────────────────────────────────────────────────────
//  In-memory loaders (project convention — no Firebase mocking)
// ─────────────────────────────────────────────────────────────

interface LoaderOverrides {
  schemes?: KpiScheme[];
  snapshots?: Map<string, MonthSnapshot>;
  observations?: QualityObservation[];
  deductions?: QualityDeduction[];
  complaints?: CustomerComplaint[];
  capaCases?: CAPACase[];
  followUps?: FollowUp[];
  deals?: TravelDeal[];
  attendanceResults?: StoredAttendanceResult[];
}

function makeLoaders(over: LoaderOverrides = {}): PerformanceIntelligenceLoaders {
  const schemes = over.schemes ?? [V1];
  const snapshots = over.snapshots ?? SNAPSHOTS;
  const observations = over.observations ?? OBSERVATIONS;
  const deductions = over.deductions ?? DEDUCTIONS;
  const complaints = over.complaints ?? COMPLAINTS;
  const capaCases = over.capaCases ?? CAPA_CASES;
  const followUps = over.followUps ?? FOLLOW_UPS;
  const deals = over.deals ?? DEALS;
  const attendanceResults = over.attendanceResults ?? ATTENDANCE_RESULTS;

  const scoreEntryOf = (entry: MonthSnapshot['employeeScores'][string]) => ({
    score: entry.score,
    deductionPoints: entry.deductionPoints,
    bonusPoints: entry.bonusPoints,
    observationCount: entry.observationCount,
  });

  return {
    // ── Engine pipeline loaders (canonical semantics, in-memory inputs) ──
    loadEmployee: async (employeeId) => {
      const record = EMPLOYEES.find((e) => e.id === employeeId);
      return record ? toFrameworkEmployee(record) : null;
    },
    loadEmploymentEvents: async (employeeId) => EVENTS_BY_EMPLOYEE.get(employeeId) ?? [],
    loadSchemes: async () => schemes,
    loadOverrides: async () => [],
    loadSnapshot: async (period) => {
      const snapshot = snapshots.get(period);
      if (!snapshot) return null;
      const employeeScores: NonNullable<Awaited<ReturnType<PerformanceIntelligenceLoaders['loadSnapshot']>>>['employeeScores'] = {};
      for (const [, entry] of Object.entries(snapshot.employeeScores ?? {})) {
        employeeScores[entry.employeeSnapshot.employeeId] = scoreEntryOf(entry);
      }
      return { status: snapshot.status, closedAt: snapshot.closedAt, employeeScores, kpiResults: snapshot.kpiResults ?? null };
    },
    loadLiveQualityScore: async (employeeId, period) => {
      const snapshot = snapshots.get(period);
      if (snapshot?.status === 'closed') return null;
      const monthObs = observations.filter((o) => o.month === period && o.employeeId === employeeId);
      if (monthObs.length === 0) return null;
      const score = computeEmployeeScore(monthObs as never[], SETTINGS, employeeId);
      return { score: score.score, deductionPoints: score.deductionPoints, bonusPoints: score.bonusPoints, observationCount: score.observationCount };
    },

    // ── Reporting extras (KpiReportingLoaders) ──
    loadEmployeeRecord: async (employeeId) => EMPLOYEES.find((e) => e.id === employeeId) ?? null,
    loadEmployees: async () => EMPLOYEES,
    loadEmploymentEventsByEmployee: async () => EVENTS_BY_EMPLOYEE,
    loadSnapshotDocument: async (period) => snapshots.get(period) ?? null,
    loadMonthDetail: async (period) => {
      const stored = snapshots.get(period);
      if (stored && stored.status === 'closed') return stored;
      const monthObs = observations.filter((o) => o.month === period);
      const empMap = new Map(EMPLOYEES.map((e) => [e.id, { id: e.id, name: e.name, department: e.department, position: e.position }]));
      const computed = computeMonthSnapshot(monthObs as never[], period, empMap, new Map(), SETTINGS);
      return { ...computed, id: period, status: 'open' } as MonthSnapshot;
    },
    loadSnapshotDocuments: async (monthKeys) => {
      const map = new Map<string, MonthSnapshot>();
      for (const key of monthKeys) {
        const snapshot = snapshots.get(key);
        if (snapshot) map.set(key, snapshot);
      }
      return map;
    },
    loadObservations: async (monthKey) => observations.filter((o) => o.month === monthKey),
    loadTeamNames: async () => new Map<string, string | null>(),

    // ── Performance-intelligence extras ──
    loadEmployeeIdentity: async (employeeId) => {
      const record = EMPLOYEES.find((e) => e.id === employeeId);
      return record
        ? {
            id: record.id,
            name: record.name,
            code: record.code,
            department: record.department,
            position: record.position,
            orgNodeId: null,
            status: record.status,
            archivedAt: record.archivedAt,
            restoredAt: null,
          }
        : null;
    },
    loadOrgNodes: async () => [],
    loadObservationsForWindow: async (employeeId, months) => {
      const monthSet = new Set(months);
      return observations.filter((o) => o.employeeId === employeeId && monthSet.has(o.month));
    },
    loadQualityDeductions: async (employeeId) => deductions.filter((d) => d.employeeId === employeeId),
    loadComplaints: async (employeeId) => complaints.filter((c) => c.employeeId === employeeId),
    loadCapaCases: async (employeeId) => {
      const primary = capaCases.filter((c) => c.employeeId === employeeId);
      const indirect = capaCases.filter(
        (c) => c.employeeId !== employeeId && Array.isArray(c.relatedEmployeeIds) && c.relatedEmployeeIds.includes(employeeId),
      );
      return { primary, indirect };
    },
    loadFollowUps: async (employeeId) => followUps.filter((f) => f.employeeId === employeeId),
    loadTravelDeals: async (employeeId) => deals.filter((d) => d.employeeId === employeeId),
    loadStoredAttendanceResult: async (employeeId, monthKey) =>
      attendanceResults.find((r) => r.employeeId === employeeId && r.month === monthKey) ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
//  1–5 · KPI facts, observations, statuses, repeated issues, deductions
// ─────────────────────────────────────────────────────────────

describe('employee KPI facts (spec §5)', () => {
  it('1 · exposes canonical engine KPI facts verbatim', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed',
      monthKey: '2026-08',
      now: NOW_AUG,
      loaders: makeLoaders(),
    });

    assert.ok(dataset);
    assert.equal(dataset.datasetKind, 'EMPLOYEE_PERFORMANCE_INTELLIGENCE');
    assert.equal(dataset.employee.employeeId, 'emp_ahmed');
    assert.equal(dataset.employee.employeeName, 'أحمد محمد');
    assert.equal(dataset.employee.employmentStatus, 'active');
    assert.equal(dataset.employee.eligibleForPeriod, true);

    assert.equal(dataset.kpi.outcomeStatus, 'RESOLVED');
    assert.equal(dataset.kpi.source, 'kpi_engine');
    assert.equal(dataset.kpi.scheme?.schemeId, 'scheme_v1');
    assert.equal(dataset.kpi.scheme?.schemeVersion, 1);
    assert.equal(dataset.kpi.scheme?.qualityWeight, 15);
    assert.equal(dataset.kpi.calculationVersion, '1');
    assert.equal(dataset.period.monthKey, '2026-08');
    assert.equal(dataset.period.valueBasis, 'MTD');
    assert.equal(dataset.period.finalized, false);
  });

  it('19 · quality KPI value stays identical to the canonical engine/report', async () => {
    const loaders = makeLoaders();
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders,
    });
    const canonical = await buildEmployeeKpiReport({
      employeeId: 'emp_ahmed', monthKey: '2026-08', trendMonths: 6, now: NOW_AUG, loaders,
    });

    assert.equal(dataset!.kpi.quality!.rawScore, canonical.quality!.rawScore);
    assert.equal(dataset!.kpi.quality!.weightedContribution, canonical.quality!.weightedContribution);
    assert.equal(dataset!.kpi.scheme?.schemeId, canonical.scheme?.schemeId);
    assert.equal(dataset!.kpi.rowStatus, canonical.rowStatus);
    assert.equal(dataset!.kpi.overallStatus, canonical.overallStatus);
    // Direct engine parity for the live month: 100 − (5 + 4) = 91.
    const engine = computeEmployeeScore(
      OBSERVATIONS.filter((o) => o.employeeId === 'emp_ahmed' && o.month === '2026-08') as never[],
      SETTINGS,
      'emp_ahmed',
    );
    assert.equal(dataset!.kpi.quality!.rawScore, engine.score);
    assert.equal(dataset!.kpi.quality!.deductionPoints, engine.deductionPoints);
  });

  it('20 · weighted contribution uses the CONFIGURED scheme weight (15 → 13.65; 20 → 18.2)', async () => {
    const v1 = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    assert.equal(v1!.kpi.quality!.rawScore, 91);
    assert.equal(v1!.kpi.quality!.weight, 15);
    assert.equal(v1!.kpi.quality!.weightedContribution, 13.65);
    assert.equal(v1!.kpi.quality!.maxContribution, 15);

    const v2 = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders({ schemes: [makeSchemeV2()] }),
    });
    assert.equal(v2!.kpi.quality!.rawScore, 91); // raw score is weight-independent
    assert.equal(v2!.kpi.quality!.weight, 20);
    assert.equal(v2!.kpi.quality!.weightedContribution, 18.2);
  });

  it('frozen period reports the closed-month result verbatim (FINALIZED)', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-07', now: NOW_AUG, loaders: makeLoaders(),
    });
    assert.equal(dataset!.kpi.outcomeStatus, 'FROZEN_RESULT');
    assert.equal(dataset!.kpi.quality!.rawScore, 88);
    assert.equal(dataset!.period.valueBasis, 'FINALIZED');
    assert.equal(dataset!.period.finalizedAt, '2026-08-01T00:00:00.000Z');
  });
});

describe('quality analysis (spec §6/§7/§8)', () => {
  it('2 · aggregates observations of the period from stored fields', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    const obs = dataset!.quality.observations;
    assert.equal(obs.total, 5);
    assert.equal(obs.approved, 2);
    assert.equal(obs.pending, 2);
    assert.equal(obs.rejected, 1);
    // Another employee's observations never leak into this dataset.
    assert.deepEqual(
      dataset!.evidence.observations.recordIds,
      ['obs_a1', 'obs_a2', 'obs_a3', 'obs_a4', 'obs_a5'],
    );
  });

  it('3 · aggregates severity/category/resolution distributions + monthly series', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    const obs = dataset!.quality.observations;
    assert.deepEqual(obs.bySeverity, { low: 2, medium: 1, high: 1, critical: 1 });
    assert.equal(obs.byResolutionStatus.resolved, 2); // obs_a1 + obs_a5 (stored default)
    assert.equal(obs.byResolutionStatus.open, 1);
    assert.equal(obs.byResolutionStatus.in_review, 1);
    assert.equal(obs.byResolutionStatus.closed, 1);

    const late = obs.byCategory.find((c) => c.categoryId === 'cat_late');
    assert.ok(late);
    assert.equal(late.count, 3);
    assert.equal(late.categoryName, 'تأخر المتابعة');

    // Monthly distribution: July + August carry data; no fabricated months.
    assert.deepEqual(obs.monthly, [
      { month: '2026-07', count: 2 },
      { month: '2026-08', count: 5 },
    ]);
  });

  it('4 · detects repeated issues deterministically (category / type / window)', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    const repeated = dataset!.quality.repeatedIssues;
    assert.equal(repeated.minOccurrences, 2);
    assert.deepEqual(repeated.groupBasis, { category: 'categoryId', type: 'type' });

    const late = repeated.byCategory.find((g) => g.issueKey === 'cat_late');
    assert.ok(late, 'cat_late repeats within the period');
    assert.equal(late.occurrenceCount, 3);
    assert.equal(late.firstOccurrence, '03/08/2026');
    assert.equal(late.lastOccurrence, '18/08/2026');
    assert.deepEqual(late.observationIds, ['obs_a1', 'obs_a2', 'obs_a4']);

    const deductionType = repeated.byType.find((g) => g.issueKey === 'deduction');
    assert.ok(deductionType);
    assert.equal(deductionType.occurrenceCount, 4);
    // 'bonus' appears once → never repeated.
    assert.ok(!repeated.byType.some((g) => g.issueKey === 'bonus'));

    const windowLate = repeated.windowByCategory.find((g) => g.issueKey === 'cat_late');
    assert.ok(windowLate, 'cat_late recurs across the window');
    assert.equal(windowLate!.occurrenceCount, 4); // 3 Aug + 1 Jul
    assert.equal(windowLate!.monthsPresent, 2);
    assert.equal(windowLate!.firstMonth, '2026-07');
    assert.equal(windowLate!.lastMonth, '2026-08');
    const windowOffer = repeated.windowByCategory.find((g) => g.issueKey === 'cat_offer');
    assert.ok(windowOffer); // 1 Aug + 1 Jul = 2
    assert.equal(windowOffer!.occurrenceCount, 2);
    assert.ok(!repeated.windowByCategory.some((g) => g.issueKey === 'cat_bonus'));
  });

  it('5 · aggregates payroll deductions with separate units and period scoping', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    const ded = dataset!.quality.deductions;
    assert.equal(ded.count, 2); // September record excluded
    assert.equal(ded.totalDays, 1.5);
    assert.equal(ded.totalAmount, 200);
    assert.equal(ded.byType.length, 2);
    assert.deepEqual(
      dataset!.evidence.deductions.recordIds,
      ['qd_1', 'qd_2'],
    );
    // KPI scoring is untouched by payroll deductions: still 91/13.65.
    assert.equal(dataset!.kpi.quality!.rawScore, 91);
    assert.equal(dataset!.kpi.quality!.weightedContribution, 13.65);
  });
});

// ─────────────────────────────────────────────────────────────
//  6–9 · Operations analysis
// ─────────────────────────────────────────────────────────────

describe('complaint analysis (spec §9)', () => {
  it('6 · aggregates only CONFIRMED direct links; deal links are facts, never invention', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    const complaints = dataset!.complaints;
    assert.equal(complaints.relationship, 'CONFIRMED');
    assert.equal(complaints.total, 3); // c_4 (deal-linked, no employeeId) excluded
    assert.equal(complaints.byStatus.resolved, 1);
    assert.equal(complaints.byStatus.closed, 1);
    assert.equal(complaints.byStatus.open, 1);
    assert.equal(complaints.resolvedOrClosed, 2);
    assert.equal(complaints.stillOpen, 1);
    assert.equal(complaints.viaDealCount, 1);
    assert.equal(complaints.avgResolutionDays, 4); // (7 + 1) / 2

    const repeated = complaints.repeatedTypes.find((t) => t.issueKey === 'service_quality');
    assert.ok(repeated);
    assert.equal(repeated.occurrenceCount, 2);
    assert.deepEqual(dataset!.evidence.complaints.recordIds, ['c_1', 'c_2', 'c_3']);
    assert.ok(!dataset!.evidence.complaints.recordIds.includes('c_4'));
  });
});

describe('capa analysis (spec §10)', () => {
  it('7 · aggregates primary links with canonical overdue logic + indirect count', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    const capa = dataset!.capa;
    assert.equal(capa.relationship, 'CONFIRMED');
    assert.equal(capa.total, 2); // capa_1 + capa_2 only (capa_4 is sara's)
    assert.equal(capa.active, 1);
    assert.equal(capa.terminal, 1);
    assert.equal(capa.overdue, 1);
    assert.equal(capa.avgOverdueDays, 17);
    assert.equal(capa.closedCount, 1);
    assert.equal(capa.avgClosureDays, 10);
    assert.equal(capa.correctiveStatus.in_progress, 1);
    assert.equal(capa.correctiveStatus.completed, 1);
    assert.equal(capa.preventiveStatus.completed, 1);
    assert.equal(capa.indirectCount, 1); // capa_3 via relatedEmployeeIds
    assert.deepEqual(dataset!.evidence.capa.recordIds, ['capa_1', 'capa_2']);
  });
});

describe('follow-up analysis (spec §11)', () => {
  it('8 · reuses the canonical timing definitions (overdue / due today)', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    const fu = dataset!.followUps;
    assert.equal(fu.relationship, 'CONFIRMED');
    assert.equal(fu.total, 4); // f_5 is unattributable
    assert.equal(fu.active, 2);
    assert.equal(fu.terminal, 2);
    assert.equal(fu.overdue, 1); // f_1 (due 15/08, active)
    assert.equal(fu.avgOverdueDays, 6);
    assert.equal(fu.dueToday, 1); // f_2 (due 21/08)
    assert.equal(fu.completed, 2);
    assert.equal(fu.completionRate, 50);
    assert.deepEqual(dataset!.evidence.followUps.recordIds, ['f_1', 'f_2', 'f_3', 'f_4']);
    assert.deepEqual(
      dataset!.dataQuality.unattributedRecords,
      [{ collection: 'followUps', count: 1 }],
    );
  });
});

describe('deal analysis (spec §12)', () => {
  it('9 · aggregates operational facts from the stored status vocabulary only', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    const deals = dataset!.deals;
    assert.equal(deals.relationship, 'CONFIRMED');
    assert.equal(deals.travelTotal, 3); // August departures only (TRAVEL dimension)
    assert.equal(deals.byStatus.completed, 1);
    assert.equal(deals.byStatus.canceled, 1);
    assert.equal(deals.byStatus.in_progress, 1);
    assert.equal(deals.canceled, 1);
    assert.equal(deals.active, 1);
    assert.equal(deals.completionRate, 33.33);
    // §DEAL-DATES — the fixture's completed deals carry no closedAt,
    // so the CLOSED dimension stays UNKNOWN (never attributed, never
    // derived from the departure month).
    assert.equal(deals.closedTotal, 0);
    assert.equal(deals.closedUnknownMonth, 2); // d_1 + d_4 (completed, no closedAt)
    assert.deepEqual(deals.closedMonthly, []);
    // Window monthly series includes July (actual data, not fabricated).
    assert.deepEqual(deals.monthly, [
      { month: '2026-07', count: 1 },
      { month: '2026-08', count: 3 },
    ]);
    assert.deepEqual(dataset!.evidence.deals.recordIds, ['d_1', 'd_2', 'd_3']);
  });
});

describe('§DEAL-DATES — dimension separation in deal aggregation', () => {
  // The three non-negotiable examples: one deal, several truthful
  // periods depending on the metric's canonical date dimension.
  const closedAugTravelsSep = makeDeal({
    id: 'd_sep1',
    status: 'completed',
    departureDate: '15/09/2026',
    createdAt: '2026-08-20T10:00:00.000Z',
    closedAt: '2026-08-28T14:00:00.000Z',
  });
  const closedSepTravelsOct = makeDeal({
    id: 'd_sep2',
    status: 'completed',
    departureDate: '10/10/2026',
    createdAt: '2026-08-20T10:00:00.000Z',
    closedAt: '2026-09-05T11:30:00.000Z',
  });
  const completedNoClosure = makeDeal({
    id: 'd_unknown',
    status: 'completed',
    departureDate: '15/09/2026',
    createdAt: '2026-08-20T10:00:00.000Z',
    closedAt: null,
  });
  const WINDOW = ['2026-08', '2026-09', '2026-10'];

  function aggregate(deals: TravelDeal[], period: string) {
    return aggregateTravelDeals({
      deals: deals.filter((d) => monthKey(d) === period),
      windowDeals: deals.filter((d) => monthKey(d) !== null),
      monthByDealId: new Map(deals.map((d) => [d.id, monthKey(d)])),
      allDeals: deals,
      closedMonthByDealId: new Map(deals.map((d) => [d.id, closedKey(d)])),
      windowMonths: WINDOW,
      periodMonthKey: period,
    });
  }
  const monthKey = (d: TravelDeal) => {
    const m = Number(d.departureDate.split('/')[1]);
    return m >= 8 && m <= 10 ? `2026-${String(m).padStart(2, '0')}` : null;
  };
  const closedKey = (d: TravelDeal) => (d.closedAt ? d.closedAt.slice(0, 7) : null);

  it('§17.14 — the same deal counts in August for closures and September for travel', () => {
    const august = aggregate([closedAugTravelsSep], '2026-08');
    assert.equal(august.closedTotal, 1); // CLOSED dimension (closedAt)
    assert.equal(august.travelTotal, 0); // TRAVEL dimension (departureDate)
    const september = aggregate([closedAugTravelsSep], '2026-09');
    assert.equal(september.closedTotal, 0);
    assert.equal(september.travelTotal, 1);
  });

  it('§17.2 — closed September, travels October: each period answers independently', () => {
    const september = aggregate([closedSepTravelsOct], '2026-09');
    const october = aggregate([closedSepTravelsOct], '2026-10');
    assert.equal(september.closedTotal, 1);
    assert.equal(september.travelTotal, 0);
    assert.equal(october.closedTotal, 0);
    assert.equal(october.travelTotal, 1);
  });

  it('§17.15 — a completed deal without closedAt stays UNKNOWN and is never attributed by its departure month', () => {
    const facts = aggregate([completedNoClosure], '2026-09');
    // The deal departs in September; a departure fallback would count
    // it as a September closure — that is exactly what must NOT happen.
    assert.equal(facts.closedTotal, 0);
    assert.equal(facts.closedUnknownMonth, 1);
    assert.deepEqual(facts.closedMonthly, []);
    // It still counts as September TRAVEL volume (its own dimension).
    assert.equal(facts.travelTotal, 1);
  });

  it('§17.12 — historical closure months surface in closedMonthly (months with data only)', () => {
    const facts = aggregate([closedAugTravelsSep, closedSepTravelsOct, completedNoClosure], '2026-10');
    assert.deepEqual(facts.closedMonthly, [
      { month: '2026-08', count: 1 },
      { month: '2026-09', count: 1 },
    ]);
    assert.equal(facts.closedUnknownMonth, 1);
  });
});

// ─────────────────────────────────────────────────────────────
//  10 · Attendance — context only
// ─────────────────────────────────────────────────────────────

describe('attendance context (spec §13)', () => {
  it('10 · exposes the STORED result as context and never enters the Quality KPI', async () => {
    const withStored = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    assert.equal(withStored!.attendance.status, 'AVAILABLE');
    assert.equal(withStored!.attendance.source, 'attendanceResults');
    assert.equal(withStored!.attendance.result!.lateDays, 2);
    assert.equal(withStored!.attendance.result!.absentDays, 1);
    assert.equal(withStored!.attendance.result!.compliance, 96);
    assert.equal(withStored!.attendance.result!.engineVersion, 'attendance-v1');
    assert.deepEqual(withStored!.evidence.attendance!.recordIds, ['2026-08_emp_ahmed']);
    // KPI facts are UNCHANGED by attendance context (91 / 15 / 13.65).
    assert.equal(withStored!.kpi.quality!.rawScore, 91);
    assert.equal(withStored!.kpi.quality!.weight, 15);
    assert.equal(withStored!.kpi.quality!.weightedContribution, 13.65);

    const withoutStored = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders({ attendanceResults: [] }),
    });
    assert.equal(withoutStored!.attendance.status, 'NOT_AVAILABLE');
    assert.equal(withoutStored!.attendance.result, null);
    assert.equal(withoutStored!.evidence.attendance, null);
    // Identical KPI values with/without attendance context.
    assert.equal(withoutStored!.kpi.quality!.rawScore, withStored!.kpi.quality!.rawScore);
    assert.equal(withoutStored!.kpi.quality!.weightedContribution, withStored!.kpi.quality!.weightedContribution);
  });
});

// ─────────────────────────────────────────────────────────────
//  11–14 · Trend, missing periods, lifecycle
// ─────────────────────────────────────────────────────────────

describe('trend & period comparison (spec §14/§15)', () => {
  it('11 · current vs previous in PERCENTAGE POINTS (91 vs 88 = +3, UP)', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    const mom = dataset!.trend.mom!;
    assert.equal(mom.currentMonth, '2026-08');
    assert.equal(mom.previousMonth, '2026-07');
    assert.equal(mom.currentRawScore, 91);
    assert.equal(mom.previousRawScore, 88);
    assert.equal(mom.deltaPoints, 3); // percentage POINTS, not growth
    assert.equal(mom.growthPercent, 3.41); // explicitly separate
    assert.equal(dataset!.trend.direction, 'UP');

    const byMonth = new Map(dataset!.trend.points.map((p) => [p.monthKey, p]));
    assert.equal(byMonth.get('2026-05')!.rawScore, 82);
    assert.equal(byMonth.get('2026-06')!.rawScore, 86);
    assert.equal(byMonth.get('2026-07')!.rawScore, 88);
    assert.equal(byMonth.get('2026-08')!.rawScore, 91);
    assert.equal(byMonth.get('2026-04')!.valueBasis, 'FINALIZED'); // legacy derived
  });

  it('12 · missing historical months are unavailable and never fabricated', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    const byMonth = new Map(dataset!.trend.points.map((p) => [p.monthKey, p]));
    assert.equal(dataset!.trend.windowMonths.length, 6);
    for (const missing of ['2026-03']) {
      const point = byMonth.get(missing)!;
      assert.equal(point.available, false);
      assert.equal(point.rawScore, null, `${missing} must be null, never 0`);
      assert.equal(point.rowStatus, 'PENDING');
    }

    // Employee with NO stored history at all: no mom, no direction, no zero.
    const nodata = await getEmployeePerformanceDataset({
      employeeId: 'emp_nodata', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    assert.equal(nodata!.kpi.outcomeStatus, 'RESOLVED');
    assert.equal(nodata!.kpi.quality!.rawScore, null); // PENDING quality — never 0
    assert.equal(nodata!.kpi.quality!.status, 'PENDING');
    // Canonical display vocabulary: a result whose only component is
    // PENDING is INCOMPLETE — distinct from a real ZERO (Phase-2 §12).
    assert.equal(nodata!.kpi.rowStatus, 'INCOMPLETE');
    assert.equal(nodata!.trend.mom, null);
    assert.equal(nodata!.trend.direction, null);
    assert.ok(nodata!.trend.points.every((p) => p.rawScore === null));
  });
});

describe('employee lifecycle (spec §16)', () => {
  it('13 · archived employee: eligible historical period stays fully valid', async () => {
    // August 1–20 employment overlaps the August period → eligible.
    const august = await getEmployeePerformanceDataset({
      employeeId: 'emp_sara', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    assert.equal(august!.employee.employmentStatus, 'archived');
    assert.equal(august!.employee.eligibleForPeriod, true);
    assert.equal(august!.employee.archivedButEligible, true);
    assert.equal(august!.employee.archivedAt, '2026-08-20T10:00:00.000Z');

    // September (post-archive): explicit NOT_ELIGIBLE — no fabricated zeros.
    const september = await getEmployeePerformanceDataset({
      employeeId: 'emp_sara', monthKey: '2026-09', now: NOW_SEP, loaders: makeLoaders(),
    });
    assert.equal(september!.kpi.outcomeStatus, 'NOT_ELIGIBLE_PERIOD');
    assert.equal(september!.employee.eligibleForPeriod, false);
    assert.equal(september!.employee.archivedButEligible, false);
    assert.equal(september!.kpi.quality, null);
    assert.equal(september!.kpi.rowStatus, 'NOT_ELIGIBLE');
  });

  it('14 · restored employee: history preserved, current status active', async () => {
    const june = await getEmployeePerformanceDataset({
      employeeId: 'emp_karim', monthKey: '2026-06', now: NOW_AUG, loaders: makeLoaders(),
    });
    // June 1–10 employment overlaps June → historical period stays reportable.
    assert.equal(june!.employee.eligibleForPeriod, true);
    assert.equal(june!.kpi.outcomeStatus, 'RESOLVED');

    const august = await getEmployeePerformanceDataset({
      employeeId: 'emp_karim', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    assert.equal(august!.employee.employmentStatus, 'active');
    assert.equal(august!.employee.eligibleForPeriod, true);
    assert.equal(august!.employee.archivedButEligible, false);
    // June (while archived) and August (restored) both remain reportable —
    // history is never erased by the restore, and May's frozen score (78)
    // is still reachable from the June dataset's trend window.
    const juneTrend = await getEmployeePerformanceDataset({
      employeeId: 'emp_karim', monthKey: '2026-06', now: NOW_AUG, loaders: makeLoaders(),
    });
    const mayPoint = juneTrend!.trend.points.find((p) => p.monthKey === '2026-05');
    assert.equal(mayPoint!.rawScore, 78);
    assert.equal(mayPoint!.finalized, true);
  });
});

// ─────────────────────────────────────────────────────────────
//  15–18 · Evidence, permissions, immutability, uniqueness
// ─────────────────────────────────────────────────────────────

describe('evidence traceability (spec §17)', () => {
  it('15 · every analytical block references its source record ids', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    const evidence = dataset!.evidence;
    assert.deepEqual(evidence.kpi[0], { collection: 'monthSnapshots', recordIds: ['2026-08'] });
    assert.deepEqual(evidence.kpi[1], { collection: 'kpiSchemes', recordIds: ['scheme_v1'] });
    assert.equal(evidence.observations.collection, 'qualityObservations');
    assert.equal(evidence.deductions.collection, 'qualityDeductions');
    assert.equal(evidence.complaints.collection, 'complaints');
    assert.equal(evidence.capa.collection, 'capaCases');
    assert.equal(evidence.followUps.collection, 'followUps');
    assert.equal(evidence.deals.collection, 'travelDeals');
    assert.equal(evidence.attendance!.collection, 'attendanceResults');

    // Counts reconcile with the analytical aggregates.
    assert.equal(evidence.observations.recordIds.length, dataset!.quality.observations.total);
    assert.equal(evidence.deductions.recordIds.length, dataset!.quality.deductions.count);
    assert.equal(evidence.complaints.recordIds.length, dataset!.complaints.total);
    assert.equal(evidence.capa.recordIds.length, dataset!.capa.total);
    assert.equal(evidence.followUps.recordIds.length, dataset!.followUps.total);
    assert.equal(evidence.deals.recordIds.length, dataset!.deals.travelTotal);
  });
});

describe('permission enforcement (spec §23)', () => {
  it('16 · route keeps the canonical auth + permission + scope gates (static contract)', () => {
    const routePath = join(__dirname, '..', '..', '..', 'app', 'api', 'performance-intelligence', 'route.ts');
    const src = readFileSync(routePath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(src.includes('requireAuth(request)'), 'route must authenticate');
    assert.ok(
      /verifyPermission\(\s*request\s*,\s*'kpiReports'\s*,\s*'view'\s*\)/.test(src),
      'route must enforce the existing kpiReports view permission',
    );
    assert.ok(src.includes('resolveEmployeeScopeFromDb'), 'route must enforce the authorized employee scope');
    assert.ok(src.includes("notFoundError('الموظف غير موجود')"), 'out-of-scope employees are a fail-closed 404');
    assert.ok(!src.includes('createRecord') && !src.includes('updateRecord') && !src.includes('deleteRecord'), 'route must stay read-only');
  });
});

describe('read-only principle (spec §22)', () => {
  it('17 · no source record is modified while building the dataset', async () => {
    const before = {
      observations: structuredClone(OBSERVATIONS),
      deductions: structuredClone(DEDUCTIONS),
      complaints: structuredClone(COMPLAINTS),
      capaCases: structuredClone(CAPA_CASES),
      followUps: structuredClone(FOLLOW_UPS),
      deals: structuredClone(DEALS),
      attendanceResults: structuredClone(ATTENDANCE_RESULTS),
      snapshots: structuredClone([...SNAPSHOTS.entries()]),
    };

    await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });

    assert.deepEqual(OBSERVATIONS, before.observations);
    assert.deepEqual(DEDUCTIONS, before.deductions);
    assert.deepEqual(COMPLAINTS, before.complaints);
    assert.deepEqual(CAPA_CASES, before.capaCases);
    assert.deepEqual(FOLLOW_UPS, before.followUps);
    assert.deepEqual(DEALS, before.deals);
    assert.deepEqual(ATTENDANCE_RESULTS, before.attendanceResults);
    assert.deepEqual([...SNAPSHOTS.entries()], before.snapshots);
  });

  it('17b · the service surface contains no write primitive (static contract)', () => {
    const modulePath = join(__dirname, '..', 'index.ts');
    const src = readFileSync(modulePath, 'utf8');
    for (const writeFn of ['createRecord', 'updateRecord', 'deleteRecord', 'deleteWhere', 'deleteByIds', 'invalidateCache']) {
      assert.ok(!src.includes(writeFn), `barrel must not expose ${writeFn}`);
    }
  });

  it('18 · no record id is duplicated inside any evidence list', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    const lists = [
      dataset!.evidence.observations.recordIds,
      dataset!.evidence.deductions.recordIds,
      dataset!.evidence.complaints.recordIds,
      dataset!.evidence.capa.recordIds,
      dataset!.evidence.followUps.recordIds,
      dataset!.evidence.deals.recordIds,
    ];
    for (const ids of lists) {
      assert.equal(new Set(ids).size, ids.length, 'evidence ids must be unique');
    }
    // Repeated-issue groups reference the SAME period records — never copies.
    const periodIds = new Set(dataset!.evidence.observations.recordIds);
    for (const group of dataset!.quality.repeatedIssues.byCategory) {
      for (const id of group.observationIds) assert.ok(periodIds.has(id));
    }
    // Window recurrence references window observations only (ids, not records).
    const allWindowIds = new Set(
      dataset!.quality.repeatedIssues.windowByCategory.flatMap((g) => g.observationIds),
    );
    assert.ok(allWindowIds.has('obs_j1')); // July record referenced by id
  });
});

// ─────────────────────────────────────────────────────────────
//  §26 · Future Python contract — serializability
// ─────────────────────────────────────────────────────────────

describe('python contract (spec §26)', () => {
  it('dataset is losslessly JSON-serializable with stable facts', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ahmed', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    const round = JSON.parse(JSON.stringify(dataset!));
    assert.equal(round.kpi.quality.rawScore, 91);
    assert.equal(round.kpi.quality.weightedContribution, 13.65);
    assert.equal(round.trend.direction, 'UP');
    assert.equal(round.complaints.total, 3);
    assert.equal(round.quality.repeatedIssues.byCategory[0].issueKey, 'cat_late');
    assert.equal(round.evidence.observations.recordIds.length, 5);
    assert.ok(Array.isArray(round.dataQuality.notes));
  });

  it('missing employee → explicit null (caller maps to 404)', async () => {
    const dataset = await getEmployeePerformanceDataset({
      employeeId: 'emp_ghost', monthKey: '2026-08', now: NOW_AUG, loaders: makeLoaders(),
    });
    assert.equal(dataset, null);
  });
});
