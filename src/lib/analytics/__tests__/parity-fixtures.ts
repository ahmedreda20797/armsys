// ══════════════════════════════════════════════════════════════
//  Parity fixtures (Phase 5.3 §8) — deterministic dataset builders
//
//  THE single source used by BOTH engines:
//    • TypeScript engine  → buildEmployeeAnalyticsResult(fixture)
//    • Python reference   → employee_analytics.py (same JSON bytes)
//
//  The parity test deep-compares the two results. Fixtures cover
//  every analytical branch of the reference engine; numeric values
//  are chosen to stress rounding (round-half-even), medians, MAD,
//  slope, Pearson and percentage paths.
// ══════════════════════════════════════════════════════════════

type AnyRec = Record<string, unknown>;

const emptyDist = () => ({ total: 0, items: [], concentration: [] });

function baseDataset(windowMonths: string[]): AnyRec {
  return {
    datasetKind: 'EMPLOYEE_PERFORMANCE_INTELLIGENCE',
    employee: {
      employeeId: 'emp-parity-1',
      employeeName: 'موظف التحقق',
      employeeCode: 'EMP-P1',
      department: 'العمليات',
      position: 'موظف عمليات',
      employmentStatus: 'active',
      eligibleForPeriod: true,
      archivedButEligible: false,
      archivedAt: null,
      restoredAt: null,
      relationship: 'DIRECT',
    },
    period: {
      monthKey: windowMonths[windowMonths.length - 1],
      valueBasis: 'FINALIZED',
      finalized: true,
      finalizedAt: '2026-08-01T00:00:00.000Z',
    },
    kpi: {
      outcomeStatus: 'VALUE',
      message: null,
      scheme: null,
      quality: {
        componentId: 'quality',
        name: 'الجودة',
        status: 'FINAL',
        rawScore: null,
        weight: 15,
        weightedContribution: null,
        maxContribution: 15,
        observationCount: 0,
        deductionPoints: 0,
        bonusPoints: 0,
      },
      availableWeight: 15,
      weightedTotal: null,
      overallStatus: null,
      rowStatus: 'VALUE',
      calculationVersion: 'kpi-v1',
      source: 'kpi_engine',
    },
    trend: { windowMonths, points: [], mom: null, direction: null },
    quality: {
      observations: {
        total: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
        byResolutionStatus: {},
        bySeverity: {},
        byCategory: [],
        monthly: [],
      },
      repeatedIssues: {
        groupBasis: { category: 'categoryId', type: 'type' },
        minOccurrences: 2,
        byCategory: [],
        byType: [],
        windowByCategory: [],
      },
      deductions: { count: 0, totalDays: null, totalAmount: null, byType: [] },
    },
    complaints: {
      relationship: 'CONFIRMED',
      total: 0,
      byStatus: {},
      byType: {},
      bySeverity: {},
      repeatedTypes: [],
      resolvedOrClosed: 0,
      stillOpen: 0,
      viaDealCount: 0,
      avgResolutionDays: null,
      monthly: [],
    },
    capa: {
      relationship: 'CONFIRMED',
      total: 0,
      byStatus: {},
      byPriority: {},
      bySource: {},
      active: 0,
      terminal: 0,
      overdue: 0,
      avgOverdueDays: null,
      correctiveStatus: {},
      preventiveStatus: {},
      closedCount: 0,
      avgClosureDays: null,
      indirectCount: 0,
      monthly: [],
    },
    followUps: {
      relationship: 'CONFIRMED',
      total: 0,
      byStatus: {},
      active: 0,
      terminal: 0,
      overdue: 0,
      dueToday: 0,
      avgOverdueDays: null,
      completed: 0,
      completionRate: null,
      byType: {},
      byPriority: {},
      monthly: [],
    },
    deals: {
      relationship: 'CONFIRMED',
      travelTotal: 0,
      byStatus: {},
      canceled: 0,
      active: 0,
      closedTotal: 0,
      closedMonthly: [],
      closedUnknownMonth: 0,
      completionRate: null,
      monthly: [],
    },
    attendance: { status: 'NOT_AVAILABLE', source: 'biometric', result: null },
    dataQuality: { windowMonths, unattributedRecords: [], notes: [] },
    evidence: {
      kpi: [{ collection: 'kpiMonthlyResults', recordIds: ['kpi-row-1'] }],
      observations: null,
      deductions: null,
      complaints: null,
      capa: null,
      followUps: null,
      deals: null,
      attendance: null,
    },
    generatedAt: '2026-08-01T10:00:00.000Z',
  };
}

/** Set trend points (available scores) for the window. */
function withScores(ds: AnyRec, scores: Array<[string, number | null]>, direction: string | null = null): AnyRec {
  const trend = ds.trend as AnyRec;
  trend.points = scores.map(([monthKey, rawScore]) => ({
    monthKey,
    available: rawScore !== null,
    rawScore,
    valueBasis: 'FINALIZED',
  }));
  trend.direction = direction;
  (ds.kpi as AnyRec).quality = {
    ...((ds.kpi as AnyRec).quality as AnyRec),
    rawScore: scores.length > 0 ? scores[scores.length - 1][1] : null,
  };
  return ds;
}

const MONTHS_9 = [
  '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
  '2026-04', '2026-05', '2026-06', '2026-07',
];

/**
 * F1 — full 9-month dataset: correlations (n=9), count spike (z>5 →
 * HIGH), score drop on the last delta (-11.25), distributions with
 * concentration, repeated issues (period + window), attendance, MTD
 * untouched (FINALIZED). Every analytical branch that needs history.
 */
export function makeFullNineMonthDataset(): AnyRec {
  const ds = baseDataset(MONTHS_9);
  withScores(ds, [
    ['2025-11', 84.0], ['2025-12', 86.5], ['2026-01', 88.25], ['2026-02', 87.0],
    ['2026-03', 90.5], ['2026-04', 92.75], ['2026-05', 91.5], ['2026-06', 89.25],
    ['2026-07', 78.0],
  ], 'DOWN');

  const quality = ds.quality as AnyRec;
  const observations = quality.observations as AnyRec;
  Object.assign(observations, {
    total: 14,
    approved: 9,
    pending: 3,
    rejected: 2,
    byResolutionStatus: { resolved: 8, open: 4, escalated: 2 },
    bySeverity: { high: 4, medium: 7, low: 3 },
    byCategory: [
      { categoryId: 'cat-att', categoryName: 'الحضور', count: 6 },
      { categoryId: 'cat-delay', categoryName: 'التأخير', count: 5 },
      { categoryId: 'cat-docs', categoryName: 'التوثيق', count: 3 },
    ],
    monthly: MONTHS_9.map((m, i) => ({ month: m, count: [2, 1, 2, 1, 2, 2, 1, 1, 2][i] })),
  });
  quality.deductions = {
    count: 5,
    totalDays: 6.5,
    totalAmount: 1250.5,
    byType: [
      { categoryId: 'ded-late', categoryName: 'تأخير', count: 3 },
      { categoryId: 'ded-abs', categoryName: 'غياب', count: 2 },
    ],
  };
  quality.repeatedIssues = {
    groupBasis: { category: 'categoryId', type: 'type' },
    minOccurrences: 2,
    byCategory: [
      {
        issueKey: 'cat-att',
        label: 'الحضور',
        occurrenceCount: 6,
        firstOccurrence: '05/12/2025',
        lastOccurrence: '21/06/2026',
        observationIds: ['obs-1', 'obs-2', 'obs-3', 'obs-4', 'obs-5', 'obs-6'],
      },
      {
        issueKey: 'cat-delay',
        label: 'التأخير',
        occurrenceCount: 5,
        firstOccurrence: '11/11/2025',
        lastOccurrence: '02/07/2026',
        observationIds: ['obs-7', 'obs-8', 'obs-9', 'obs-10', 'obs-11'],
      },
    ],
    byType: [
      {
        issueKey: 'late-arrival',
        label: 'وصول متأخر',
        occurrenceCount: 3,
        firstOccurrence: '01/01/2026',
        lastOccurrence: '09/03/2026',
        observationIds: ['obs-12', 'obs-13', 'obs-14'],
      },
    ],
    windowByCategory: [
      {
        issueKey: 'cat-att',
        label: 'الحضور',
        occurrenceCount: 4,
        monthsPresent: 4,
        firstMonth: '2026-04',
        lastMonth: '2026-07',
        observationIds: ['obs-1', 'obs-2', 'obs-3', 'obs-4'],
      },
    ],
  };

  // Complaints: spike in the reported month (baseline med 1, MAD 0.5,
  // z = (6-1)/0.7413 ≈ 6.74 → HIGH anomaly).
  ds.complaints = {
    relationship: 'CONFIRMED',
    total: 13,
    byStatus: { resolved: 8, open: 5 },
    byType: { delay: 7, service_quality: 6 },
    bySeverity: { high: 5, medium: 8 },
    repeatedTypes: [],
    resolvedOrClosed: 8,
    stillOpen: 5,
    viaDealCount: 9,
    avgResolutionDays: 3.75,
    monthly: [0, 1, 0, 1, 1, 0, 1, 1, 6].map((count, i) => ({ month: MONTHS_9[i], count })),
  };

  ds.capa = {
    relationship: 'CONFIRMED',
    total: 7,
    byStatus: { open: 4, closed: 3 },
    byPriority: { high: 2, medium: 5 },
    bySource: { complaint: 5, observation: 2 },
    active: 4,
    terminal: 3,
    overdue: 2,
    avgOverdueDays: 4.5,
    correctiveStatus: { completed: 3, in_progress: 4 },
    preventiveStatus: { completed: 2, not_started: 5 },
    closedCount: 3,
    avgClosureDays: 12.25,
    indirectCount: 1,
    monthly: [1, 1, 0, 2, 1, 0, 1, 0, 1].map((count, i) => ({ month: MONTHS_9[i], count })),
  };

  ds.followUps = {
    relationship: 'CONFIRMED',
    total: 12,
    byStatus: { open: 7, resolved: 5 },
    active: 7,
    terminal: 5,
    overdue: 3,
    dueToday: 1,
    avgOverdueDays: 2.5,
    completed: 5,
    completionRate: 41.7,
    byType: { quality: 6, attendance: 6 },
    byPriority: { high: 3, medium: 9 },
    monthly: [2, 1, 2, 1, 2, 1, 1, 1, 1].map((count, i) => ({ month: MONTHS_9[i], count })),
  };

  ds.deals = {
    relationship: 'CONFIRMED',
    travelTotal: 16,
    byStatus: { completed: 10, canceled: 3, in_progress: 3 },
    canceled: 3,
    closedTotal: 10,
    closedMonthly: [],
    closedUnknownMonth: 0,
    active: 3,
    completionRate: 62.5,
    monthly: [1, 2, 2, 2, 2, 3, 1, 1, 2].map((count, i) => ({ month: MONTHS_9[i], count })),
  };

  ds.attendance = {
    status: 'AVAILABLE',
    source: 'biometric',
    result: {
      month: '2026-07',
      workDays: 26,
      presentDays: 24.5,
      lateDays: 3,
      absentDays: 1,
      totalMinutesLate: 87,
      compliance: 94.25,
    },
  };

  (ds as AnyRec).dataQuality = {
    windowMonths: MONTHS_9,
    unattributedRecords: [{ collection: 'complaints', count: 1 }],
    notes: ['dataset note 1'],
  };

  (ds as AnyRec).evidence = {
    kpi: [
      { collection: 'kpiMonthlyResults', recordIds: ['kpi-row-1', 'kpi-row-2'] },
      { collection: 'monthSnapshots', recordIds: ['snap-2026-07'] },
    ],
    observations: { collection: 'qualityObservations', recordIds: ['obs-1', 'obs-2'] },
    deductions: { collection: 'qualityDeductions', recordIds: ['ded-1'] },
    complaints: { collection: 'complaints', recordIds: ['cmp-1', 'cmp-2', 'cmp-3'] },
    capa: { collection: 'capaCases', recordIds: ['capa-1'] },
    followUps: { collection: 'followUps', recordIds: ['fu-1'] },
    deals: { collection: 'travelDeals', recordIds: ['deal-1'] },
    attendance: { collection: 'attendanceResults', recordIds: ['att-2026-07'] },
  };
  return ds;
}

/**
 * F2 — five available scores with mean exactly 87.2 (spec §6 example)
 * plus rounding-sensitive values; 5-month window (trend OK, MEDIUM
 * confidence, no anomalies — baseline 4 < 5).
 */
export function makeTrendFiveMonthDataset(): AnyRec {
  const window = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
  const ds = baseDataset(window);
  withScores(ds, [
    ['2026-03', 88.0], ['2026-04', 85.75], ['2026-05', 90.5], ['2026-06', 82.25], ['2026-07', 89.5],
  ], 'STABLE');
  const quality = ds.quality as AnyRec;
  const observations = quality.observations as AnyRec;
  observations.monthly = window.map((m, i) => ({ month: m, count: [1, 1, 0, 1, 0][i] }));
  observations.total = 3;
  observations.approved = 2;
  observations.pending = 1;
  return ds;
}

/**
 * F3 — MTD partial month (1 window month, 2 obs, 0 complaints/capa,
 * 3 follow-ups, 3 deals, attendance unavailable): per-method
 * INSUFFICIENT_DATA + MTD exclusion order (mtdPartialMonth entry
 * FIRST in insufficientSamples).
 */
export function makePartialMtdDataset(): AnyRec {
  const ds = baseDataset(['2026-08']);
  (ds.period as AnyRec).valueBasis = 'MTD';
  (ds.period as AnyRec).finalized = false;
  (ds.period as AnyRec).monthKey = '2026-08';
  withScores(ds, [['2026-08', 87.5]], null);
  const quality = ds.quality as AnyRec;
  const observations = quality.observations as AnyRec;
  Object.assign(observations, {
    total: 2,
    approved: 1,
    pending: 1,
    rejected: 0,
    byResolutionStatus: {},
    bySeverity: {},
    byCategory: [],
    monthly: [{ month: '2026-08', count: 2 }],
  });
  ds.followUps = {
    ...(ds.followUps as AnyRec),
    total: 3,
    overdue: 0,
    monthly: [{ month: '2026-08', count: 3 }],
  };
  ds.deals = {
    ...(ds.deals as AnyRec),
    travelTotal: 3,
    closedTotal: null,
    canceled: 0,
    monthly: [{ month: '2026-08', count: 3 }],
  };
  return ds;
}

/**
 * F4 — trend with a MISSING month in the window (never zero-filled):
 * window of 4, available = m1, m2, m4 → 2 PoP deltas (one across the
 * gap), availableMonths 3, OK with 3-month stats.
 */
export function makeTrendGapDataset(): AnyRec {
  const window = ['2026-04', '2026-05', '2026-06', '2026-07'];
  const ds = baseDataset(window);
  withScores(ds, [
    ['2026-04', 84.0], ['2026-05', 87.5], ['2026-06', null], ['2026-07', 91.0],
  ], 'UP');
  return ds;
}

/**
 * F5 — unconfirmed complaint attribution: complaint analysis gated
 * (ANALYSIS_GATED_ON_CONFIRMED_ATTRIBUTION), complaints EXCLUDED from
 * cross-domain + correlation eligibility.
 */
export function makeUnconfirmedComplaintsDataset(): AnyRec {
  const ds = makeFullNineMonthDataset();
  ds.complaints = {
    ...(ds.complaints as AnyRec),
    relationship: 'INDIRECT',
  };
  return ds;
}

/**
 * F6 — flat baselines + zero-variance correlation over 8 months:
 * capa/followUps/deals constant series → FLAT_BASELINE entries and a
 * NO_VARIANCE correlation (followUps vs deals), while observations
 * varies. Correlation n=8 (threshold boundary).
 */
export function makeFlatBaselineDataset(): AnyRec {
  const window = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
  const ds = baseDataset(window);
  withScores(ds, window.map((m, i) => [m, 85 + i] as [string, number]), 'UP');
  const quality = ds.quality as AnyRec;
  const observations = quality.observations as AnyRec;
  observations.monthly = [2, 0, 3, 1, 0, 2, 4, 1].map((count, i) => ({ month: window[i], count }));
  observations.total = 13;
  ds.capa = {
    ...(ds.capa as AnyRec),
    total: 0,
    monthly: window.map((m) => ({ month: m, count: 0 })),
  };
  ds.followUps = {
    ...(ds.followUps as AnyRec),
    total: 8,
    monthly: window.map((m) => ({ month: m, count: 1 })),
  };
  ds.deals = {
    ...(ds.deals as AnyRec),
    total: 16,
    monthly: window.map((m) => ({ month: m, count: 2 })),
  };
  return ds;
}

/**
 * F7 — archived-but-eligible employee + months OUTSIDE the window in
 * monthly series + window repeated groups + concentration-heavy
 * deductions + missing KPI months + attendance unavailable.
 */
export function makeArchiveOutsideDataset(): AnyRec {
  const window = ['2026-05', '2026-06', '2026-07'];
  const ds = baseDataset(window);
  (ds.employee as AnyRec).archivedButEligible = true;
  (ds.employee as AnyRec).employmentStatus = 'archived';
  (ds.employee as AnyRec).archivedAt = '2026-07-15T00:00:00.000Z';
  withScores(ds, [['2026-05', 88.5], ['2026-06', null], ['2026-07', 92.25]], 'UP');
  const quality = ds.quality as AnyRec;
  const observations = quality.observations as AnyRec;
  Object.assign(observations, {
    total: 9,
    approved: 5,
    pending: 2,
    rejected: 2,
    byResolutionStatus: { resolved: 5, open: 4 },
    bySeverity: { high: 3, medium: 6 },
    byCategory: [
      { categoryId: 'cat-att', categoryName: 'الحضور', count: 5 },
      { categoryId: 'cat-delay', categoryName: 'التأخير', count: 3 },
      { categoryId: 'cat-docs', categoryName: 'التوثيق', count: 1 },
    ],
    // 2026-04 is OUTSIDE the window; 2026-06 absent → 0 records.
    monthly: [
      { month: '2026-04', count: 2 },
      { month: '2026-05', count: 4 },
      { month: '2026-07', count: 3 },
    ],
  });
  quality.deductions = {
    count: 6,
    totalDays: 9.25,
    totalAmount: 2100,
    byType: [{ categoryId: 'ded-late', categoryName: 'تأخير', count: 4 }],
  };
  quality.repeatedIssues = {
    ...(quality.repeatedIssues as AnyRec),
    windowByCategory: [
      {
        issueKey: 'cat-att',
        label: 'الحضور',
        occurrenceCount: 3,
        monthsPresent: 2,
        firstMonth: '2026-05',
        lastMonth: '2026-07',
        observationIds: ['obs-a', 'obs-b', 'obs-c'],
      },
    ],
  };
  (ds.attendance as AnyRec).status = 'NOT_AVAILABLE';
  (ds.attendance as AnyRec).result = null;
  return ds;
}

/**
 * F8 — rounding edges: half-even ties on exact binary halves
 * (delta 0.125 → 0.12, median 87.8125 → 87.81) and odd/even medians;
 * a 12-month window to flip anomaly/correlation confidence to HIGH.
 */
export function makeRoundingEdgeDataset(): AnyRec {
  const window = [
    '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01',
    '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
  ];
  const ds = baseDataset(window);
  withScores(ds, [
    ['2025-08', 86.5], ['2025-09', 86.625], ['2025-10', 86.75], ['2025-11', 86.875],
    ['2025-12', 87.0], ['2026-01', 87.125], ['2026-02', 87.25], ['2026-03', 87.375],
    ['2026-04', 87.5], ['2026-05', 87.625], ['2026-06', 87.75], ['2026-07', 87.875],
  ], 'UP');
  const quality = ds.quality as AnyRec;
  const observations = quality.observations as AnyRec;
  observations.monthly = window.map((m, i) => ({ month: m, count: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1][i] }));
  observations.total = 12;
  ds.followUps = {
    ...(ds.followUps as AnyRec),
    total: 12,
    monthly: window.map((m, i) => ({ month: m, count: [2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1][i] })),
  };
  ds.deals = {
    ...(ds.deals as AnyRec),
    travelTotal: 18,
    monthly: window.map((m, i) => ({ month: m, count: [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2][i] })),
  };
  return ds;
}

/** F9 — single LIVE month with no KPI result yet (null rawScore). */
export function makeSingleLiveNoKpiDataset(): AnyRec {
  const ds = baseDataset(['2026-08']);
  (ds.period as AnyRec).valueBasis = 'LIVE';
  (ds.period as AnyRec).finalized = false;
  withScores(ds, [['2026-08', null]], null);
  return ds;
}
