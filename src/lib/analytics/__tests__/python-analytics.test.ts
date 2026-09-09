// ══════════════════════════════════════════════════════════════
//  Phase 5 — Python Analytics bridge + route contract tests
//
//  Convention (repo-wide): node:test + node:assert/strict, run via
//  `tsx --test` (`npm test`). Tests that need a real Python runtime
//  are skipped automatically when python3 is not installed — the
//  application itself never requires Python (spec §27).
//
//  Covers spec §34 areas 1-25: trend, missing months, insufficient
//  data, mean/median, std-dev, period comparison, repeated issues,
//  complaint/CAPA/follow-up/deal/attendance trends, anomaly
//  detection, small samples, evidence, confidence, archived
//  employee, finalized month, KPI immutability, permission
//  enforcement, python unavailability, failure isolation, JSON
//  serialization, no database writes, no KPI recalculation.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ── Python availability (skip real-subprocess tests when absent) ──
function detectPython(): boolean {
  for (const bin of ['python3', 'python']) {
    try {
      const probe = spawnSync(bin, ['-I', '-c', 'pass'], { timeout: 5_000 });
      if (!probe.error && probe.status === 0) return true;
    } catch {
      /* next candidate */
    }
  }
  return false;
}

const PY_AVAILABLE = detectPython();

import {
  _pythonAnalyticsCacheSizeForTests,
  _resetPythonAnalyticsCacheForTests,
  analyticsApiResponseBody,
  runPythonAnalytics,
} from '@/lib/analytics/python-bridge';
import {
  ANALYTICS_KIND,
  ANALYTICS_SCHEMA_VERSION,
  type AnalyticsApiResponse,
  type EmployeeAnalyticsResult,
} from '@/lib/analytics/types';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';

// ══════════════════════════════════════════════════════════════
//  Fixtures (mirror python-analytics/tests)
// ══════════════════════════════════════════════════════════════

const WINDOW_6 = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
const WINDOW_12 = [
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
  '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
];

interface FixtureOptions {
  scores?: Record<number, number | null>;
  window?: string[];
  monthly?: Record<string, Array<{ month: string; count: number }>>;
  complaints?: Record<string, unknown>;
  reportedBasis?: 'MTD' | 'LIVE' | 'FINALIZED';
  archived?: boolean;
}

function makePoints(window: string[], scores: Record<number, number | null>, basis: string) {
  return window.map((monthKey, i) => {
    const s = scores[i + 1];
    const raw = (s ?? null) as number | null;
    return {
      monthKey,
      valueBasis: i === window.length - 1 ? basis : 'FINALIZED',
      available: raw !== null && raw !== undefined,
      rawScore: raw,
      weightedContribution: raw !== null && raw !== undefined ? Number((raw * 0.15).toFixed(2)) : null,
      weight: 15,
      rowStatus: raw !== null && raw !== undefined ? 'AVAILABLE' : 'PENDING',
      finalized: i < window.length - 1,
      schemeId: 'scheme-1',
    };
  });
}

function makeDataset(options: FixtureOptions = {}): EmployeePerformanceDataset {
  const window = options.window ?? WINDOW_6;
  const scores = options.scores ?? { 1: 80, 2: 85, 3: 90, 4: 88, 5: 92, 6: 91 };
  const monthly = options.monthly ?? {
    observations: WINDOW_6.map((m, i) => ({ month: m, count: [1, 2, 1, 2, 1, 20][i] })),
    complaints: WINDOW_6.map((m, i) => ({ month: m, count: [0, 1, 0, 1, 0, 1][i] })),
    capa: WINDOW_6.map((m, i) => ({ month: m, count: [0, 0, 1, 0, 0, 0][i] })),
    followUps: WINDOW_6.map((m, i) => ({ month: m, count: [1, 1, 1, 2, 1, 1][i] })),
    deals: WINDOW_6.map((m, i) => ({ month: m, count: [2, 3, 2, 3, 2, 3][i] })),
  };
  const last = scores[Math.min(Object.keys(scores).length, window.length)] ??
    scores[window.length] ?? 91;
  const basis = options.reportedBasis ?? 'FINALIZED';

  return {
    datasetKind: 'EMPLOYEE_PERFORMANCE_INTELLIGENCE',
    employee: {
      employeeId: 'emp-1',
      employeeName: 'موظف تجريبي',
      employeeCode: 'E-001',
      department: 'العمليات',
      position: 'مختص جودة',
      employmentStatus: options.archived ? 'archived' : 'active',
      eligibleForPeriod: true,
      archivedButEligible: options.archived ?? false,
      archivedAt: options.archived ? '2026-07-01T00:00:00.000Z' : null,
      restoredAt: null,
      relationship: 'CONFIRMED',
    },
    period: {
      monthKey: window[window.length - 1],
      valueBasis: basis,
      finalized: basis === 'FINALIZED',
      finalizedAt: basis === 'FINALIZED' ? '2026-07-02T00:00:00.000Z' : null,
    },
    kpi: {
      outcomeStatus: 'VALUE',
      message: null,
      scheme: { schemeId: 'scheme-1', schemeName: 'الافتراضي', schemeVersion: 1, qualityWeight: 15, frozen: true },
      quality: {
        componentId: 'quality',
        name: 'الجودة',
        status: 'AVAILABLE',
        rawScore: 91,
        weight: 15,
        weightedContribution: 13.65,
        maxContribution: 15,
        observationCount: 27,
        deductionPoints: 0,
        bonusPoints: 0,
      },
      availableWeight: 15,
      weightedTotal: 13.65,
      overallStatus: 'AVAILABLE',
      rowStatus: 'AVAILABLE',
      calculationVersion: 'v1',
      source: 'kpi_engine',
    },
    trend: {
      windowMonths: [...window],
      points: makePoints(window, scores, basis),
      mom: null,
      direction: null,
    },
    quality: {
      observations: {
        total: 27, approved: 20, pending: 5, rejected: 2,
        byResolutionStatus: { open: 5, resolved: 22 },
        bySeverity: { low: 10, medium: 12, high: 5 },
        byCategory: [
          { categoryId: 'c1', categoryName: 'توقيت المتابعة', count: 8 },
          { categoryId: 'c2', categoryName: 'دقة البيانات', count: 5 },
        ],
        monthly: monthly.observations,
      },
      repeatedIssues: {
        groupBasis: { category: 'categoryId', type: 'type' },
        minOccurrences: 2,
        byCategory: [{
          issueKey: 'c1', label: 'توقيت المتابعة', occurrenceCount: 8,
          firstOccurrence: '01/02/2026', lastOccurrence: '20/05/2026',
          observationIds: ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8'],
        }],
        byType: [],
        windowByCategory: [{
          issueKey: 'c1', label: 'توقيت المتابعة', occurrenceCount: 8,
          monthsPresent: Math.min(3, window.length),
          firstMonth: window[1] ?? null,
          lastMonth: window[Math.min(3, window.length - 1)] ?? null,
          observationIds: ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8'],
        }],
      },
      deductions: {
        count: 2, totalDays: 3, totalAmount: 500,
        byType: [{ categoryId: 'd1', categoryName: 'تأخير', count: 2 }],
        records: [],
      },
    },
    complaints: (options.complaints ?? {
      relationship: 'INDIRECT', total: 3,
      byStatus: { open: 1, resolved: 2 },
      byType: { service: 2, billing: 1 },
      bySeverity: { low: 2, high: 1 },
      repeatedTypes: [],
      resolvedOrClosed: 2, stillOpen: 1, viaDealCount: 1,
      avgResolutionDays: 4.5,
      monthly: monthly.complaints,
    }) as unknown as EmployeePerformanceDataset['complaints'],
    capa: {
      relationship: 'CONFIRMED', total: 1,
      byStatus: { open: 1 }, byPriority: { medium: 1 }, bySource: { observation: 1 },
      active: 1, terminal: 0, overdue: 0, avgOverdueDays: null,
      correctiveStatus: { not_started: 1, in_progress: 0, completed: 0 },
      preventiveStatus: { not_started: 0, in_progress: 0, completed: 0 },
      closedCount: 0, avgClosureDays: null, indirectCount: 0,
      monthly: monthly.capa,
    },
    followUps: {
      relationship: 'CONFIRMED', total: 7,
      byStatus: { open: 2, completed: 5 },
      active: 2, terminal: 5, overdue: 1, dueToday: 0,
      avgOverdueDays: null, completed: 5, completionRate: 71.4,
      byType: { call: 4, visit: 3 }, byPriority: { normal: 7 },
      monthly: monthly.followUps,
    },
    deals: {
      relationship: 'CONFIRMED', total: 15,
      byStatus: { upcoming: 2, in_progress: 3, completed: 8, canceled: 2 },
      completed: 8, canceled: 2, active: 5, completionRate: 53.3,
      monthly: monthly.deals,
    },
    attendance: {
      status: 'AVAILABLE',
      source: 'attendanceResults',
      result: {
        month: window[window.length - 1], workDays: 26, presentDays: 24,
        lateDays: 2, absentDays: 0, exemptDays: 0, unaccountedDays: 0,
        totalMinutesLate: 45, lateDeductionDays: 1, absenceDeductionDays: 0,
        attendanceDeductionDays: 1, compliance: 92.3,
        engineVersion: 'v1', generatedAt: '2026-07-01T00:00:00.000Z',
      },
    },
    dataQuality: {
      windowMonths: [...window],
      unattributedRecords: [{ collection: 'complaints', count: 1 }],
      notes: ['fixture note'],
    },
    evidence: {
      kpi: [
        { collection: 'monthSnapshots', recordIds: ['ms-1'] },
        { collection: 'kpiSchemes', recordIds: ['scheme-1'] },
      ],
      observations: { collection: 'qualityObservations', recordIds: ['o1', 'o2'] },
      deductions: { collection: 'qualityDeductions', recordIds: ['d1', 'd2'] },
      complaints: { collection: 'complaints', recordIds: ['c1', 'c2', 'c3'] },
      capa: { collection: 'capaCases', recordIds: ['capa-1'] },
      followUps: { collection: 'followUps', recordIds: ['f1', 'f2'] },
      deals: { collection: 'travelDeals', recordIds: ['t1'] },
      attendance: { collection: 'attendanceResults', recordIds: ['a1'] },
    },
    generatedAt: '2026-07-02T10:00:00.000Z',
  } as unknown as EmployeePerformanceDataset;
}

function twelveMonthComplaints(confirmed: boolean): Record<string, unknown> {
  return {
    relationship: confirmed ? 'CONFIRMED' : 'INDIRECT',
    total: 66,
    byStatus: { resolved: 66 }, byType: { service: 66 }, bySeverity: { low: 66 },
    repeatedTypes: [],
    resolvedOrClosed: 66, stillOpen: 0, viaDealCount: 0, avgResolutionDays: 2,
    // clean linear growth → slope exactly 1.0/month → direction UP
    monthly: WINDOW_12.map((m, i) => ({ month: m, count: i })),
  };
}

function twelveMonthMonthly(): Record<string, Array<{ month: string; count: number }>> {
  const obs = [0, 1, 2, 1, 2, 3, 2, 3, 4, 3, 4, 5];
  return {
    observations: WINDOW_12.map((m, i) => ({ month: m, count: obs[i] })),
    complaints: WINDOW_12.map((m, i) => ({ month: m, count: [0, 0, 1, 1, 2, 2, 3, 2, 4, 3, 4, 6][i] })),
    capa: WINDOW_12.map((m) => ({ month: m, count: 0 })),
    followUps: WINDOW_12.map((m) => ({ month: m, count: 0 })),
    deals: WINDOW_12.map((m) => ({ month: m, count: 0 })),
  };
}

// ── env helper ─────────────────────────────────────────────────
async function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function assertOkOutcome(outcome: Awaited<ReturnType<typeof runPythonAnalytics>>): asserts outcome is
  { ok: true; result: EmployeeAnalyticsResult; cached: boolean } {
  assert.equal(outcome.ok, true, `expected ok outcome, got ${JSON.stringify(outcome).slice(0, 300)}`);
}

// ══════════════════════════════════════════════════════════════
//  Engine-independent contract tests (no Python required)
// ══════════════════════════════════════════════════════════════

describe('Phase 5 — analytics response mapping (no Python needed)', () => {
  it('maps DISABLED / UNAVAILABLE / SCRIPT_MISSING to ANALYTICS_UNAVAILABLE', () => {
    for (const reason of ['DISABLED', 'PYTHON_UNAVAILABLE', 'SCRIPT_MISSING'] as const) {
      const body = analyticsApiResponseBody({ ok: false, reason });
      assert.equal(body.status, 'ANALYTICS_UNAVAILABLE');
      assert.equal((body as { reason: string }).reason, reason);
    }
  });

  it('maps SCRIPT_ERROR / INVALID_OUTPUT / DATA_CONTRACT_ERROR / SERVICE_ERROR to ANALYTICS_ERROR', () => {
    for (const reason of ['SCRIPT_ERROR', 'INVALID_OUTPUT', 'DATA_CONTRACT_ERROR', 'SERVICE_ERROR', 'SERVICE_AUTH_ERROR'] as const) {
      const body = analyticsApiResponseBody({ ok: false, reason, detail: 'x' });
      assert.equal(body.status, 'ANALYTICS_ERROR');
      assert.equal((body as { reason: string }).reason, reason);
    }
  });

  it('5.2 — TIMEOUT is a DISTINCT state (spec §10/§11), never collapsed', () => {
    const body = analyticsApiResponseBody({ ok: false, reason: 'TIMEOUT', detail: 'x' });
    assert.equal(body.status, 'ANALYTICS_TIMEOUT');
    assert.equal((body as { reason: string }).reason, 'TIMEOUT');
    assert.match((body as { message: string }).message, /مهلة/);
  });

  it('5.1A — reason-specific messages distinguish the three states (spec §6)', () => {
    const unavailableMsgs = (['DISABLED', 'PYTHON_UNAVAILABLE', 'SCRIPT_MISSING'] as const)
      .map((reason) => analyticsApiResponseBody({ ok: false, reason }) as { message: string });
    // Each unavailability reason carries its OWN explanation.
    assert.equal(new Set(unavailableMsgs.map((b) => b.message)).size, 3);
    // Contract rejection is an ERROR and mentions the contract — it
    // must NEVER be worded as an environment unavailability.
    const contract = analyticsApiResponseBody({
      ok: false, reason: 'DATA_CONTRACT_ERROR', detail: 'x',
    }) as { message: string };
    assert.match(contract.message, /عقد/);
    assert.doesNotMatch(contract.message, /غير متاح على هذه البيئة/);
  });

  it('route enforces auth + permission + scope before data (static contract)', () => {
    // Repo convention: static route-source regression scans.
    const routePath = path.join(process.cwd(),
      'src/app/api/analytics/employee-performance/route.ts');
    const source = fs.readFileSync(routePath, 'utf8');
    assert.match(source, /requireAuth\(request\)/);
    assert.match(source, /verifyPermission\(request,\s*'kpiReports',\s*'view'\)/);
    assert.match(source, /resolveEmployeeScopeFromDb/);
    assert.match(source, /notFoundError\('الموظف غير موجود'\)/);
    assert.match(source, /getEmployeePerformanceDataset/);
    // Phase 5.3: the route's execution path is the IN-PROCESS
    // TypeScript engine (runEmployeeAnalytics) — no Python runtime in
    // the deployment. The bridge itself stays covered by its own
    // dedicated tests (remote-bridge.test.ts).
    assert.match(source, /runEmployeeAnalytics/);
    assert.doesNotMatch(source, /runPythonAnalytics/);
    // Authorization must appear BEFORE the dataset fetch in the source
    // (compare CALL sites, not import lines).
    assert.ok(
      source.indexOf("verifyPermission(request, 'kpiReports'") <
        source.indexOf('await getEmployeePerformanceDataset('),
      'permission check must precede dataset fetch (spec §30)',
    );
    // Read-only route: no write helpers from @/lib/db anywhere.
    assert.doesNotMatch(source, /@\/lib\/db/);
    assert.doesNotMatch(source, /createRecord|updateRecord|createRecordWithId/);
  });

  it('bridge never touches the database (static contract)', () => {
    const bridgePath = path.join(process.cwd(), 'src/lib/analytics/python-bridge.ts');
    const source = fs.readFileSync(bridgePath, 'utf8');
    assert.doesNotMatch(source, /@\/lib\/db/);
    assert.doesNotMatch(source, /firebase/);
    assert.match(source, /child\.stdin\.end\(payload/); // payload via stdin only
  });

  it('python engine source is read-only stdlib-only (static contract, §34-24)', () => {
    const enginePath = path.join(process.cwd(), 'python-analytics/employee_analytics.py');
    const source = fs.readFileSync(enginePath, 'utf8');
    const imports = source.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('import ') || l.startsWith('from '))
      .map((l) => l.split(' ')[1].split('.')[0]);
    for (const imported of imports) {
      assert.ok(
        ['json', 'math', 'statistics', 'sys', 'datetime'].includes(imported),
        `unexpected import in engine: ${imported}`,
      );
    }
    assert.doesNotMatch(source, /open\(|os\.system|subprocess|shutil|socket|urllib|sqlite3|requests|eval\(|exec\(/);
  });
});

// ══════════════════════════════════════════════════════════════
//  Real-subprocess tests (skipped when Python is not installed)
// ══════════════════════════════════════════════════════════════

describe('Phase 5 — python analytics engine (requires python3)', { skip: !PY_AVAILABLE }, () => {
  it('1-6. trend statistics: mean/median/stddev/slope/direction + confidence', async () => {
    _resetPythonAnalyticsCacheForTests();
    const outcome = await runPythonAnalytics(makeDataset());
    assertOkOutcome(outcome);
    const r = outcome.result;
    assert.equal(r.schemaVersion, ANALYTICS_SCHEMA_VERSION);
    assert.equal(r.analyticsKind, ANALYTICS_KIND);
    assert.equal(r.deterministic, true);
    assert.equal(r.status, 'OK');

    const stats = r.trendAnalysis.stats;
    assert.ok(stats, '6 available months must produce stats');
    assert.equal(stats!.mean, 87.67);
    assert.equal(stats!.median, 89.0);
    assert.equal(stats!.min, 80.0);
    assert.equal(stats!.max, 92.0);
    assert.equal(stats!.range, 12.0);
    assert.equal(stats!.stdDev, 4.5);
    assert.equal(stats!.direction, 'UP');
    assert.equal(r.trendAnalysis.confidence, 'HIGH');
    assert.deepEqual(r.trendAnalysis.missingMonths, []);
  });

  it('2. missing months are never zero-filled', async () => {
    _resetPythonAnalyticsCacheForTests();
    const outcome = await runPythonAnalytics(makeDataset({
      scores: { 1: 80, 2: 85, 3: null, 4: 88, 5: 92, 6: 91 },
    }));
    assertOkOutcome(outcome);
    const trend = outcome.result.trendAnalysis;
    assert.deepEqual(trend.missingMonths, ['2026-03']);
    assert.equal(trend.availableMonths, 5);
    assert.equal(trend.stats!.mean, 87.2); // zero-fill would give 72.67
    const deltas = trend.periodOverPeriod.map((p) => p.deltaPoints);
    assert.deepEqual(deltas, [5, 3, 4, -1]);
  });

  it('3. insufficient data returns explicit state (no fabricated stats)', async () => {
    _resetPythonAnalyticsCacheForTests();
    const outcome = await runPythonAnalytics(makeDataset({
      scores: { 1: 80, 2: 85 },
      window: ['2026-05', '2026-06'],
    }));
    assertOkOutcome(outcome);
    const trend = outcome.result.trendAnalysis;
    assert.equal(trend.status, 'INSUFFICIENT_DATA');
    assert.equal(trend.stats, null);
    assert.equal(trend.confidence, 'INSUFFICIENT_DATA');
    assert.equal(outcome.result.overallConfidence, 'INSUFFICIENT_DATA');
  });

  it('6. period comparison: counts + deltas are facts', async () => {
    _resetPythonAnalyticsCacheForTests();
    const outcome = await runPythonAnalytics(makeDataset());
    assertOkOutcome(outcome);
    const pc = outcome.result.periodComparison;
    assert.equal(pc.status, 'OK');
    assert.equal(pc.current!.month, '2026-06');
    assert.equal(pc.previous!.month, '2026-05');
    assert.equal(pc.deltas.observations, 19);
    assert.equal(pc.deltas.deals, 1);
    assert.equal(pc.kpiRawScoreDeltaPoints, -1);
  });

  it('7. repeated issue analysis: frequency, interval, window spread', async () => {
    _resetPythonAnalyticsCacheForTests();
    const outcome = await runPythonAnalytics(makeDataset());
    assertOkOutcome(outcome);
    const rep = outcome.result.patternAnalysis.repeatedIssues;
    assert.equal(rep.byCategory[0].occurrenceCount, 8);
    assert.equal(rep.byCategory[0].frequencyPctOfObservations, 29.6);
    assert.equal(rep.byCategory[0].recurrenceIntervalDays, 15.4);
    assert.deepEqual(rep.byCategory[0].observationIds.slice(0, 2), ['o1', 'o2']);
    assert.equal(rep.windowByCategory[0].monthsPresentPct, 50);
    assert.equal(rep.windowByCategory[0].windowSpanMonths, 3);
  });

  it('8. complaint trend gated on confirmed attribution', async () => {
    _resetPythonAnalyticsCacheForTests();
    const indirect = await runPythonAnalytics(makeDataset());
    assertOkOutcome(indirect);
    const comp = indirect.result.distributionAnalysis.complaints;
    assert.equal(comp.status, 'NOT_CONFIRMED_ATTRIBUTION');
    assert.equal(comp.countTrend, null);
    assert.ok(comp.noteCodes.includes('ANALYSIS_GATED_ON_CONFIRMED_ATTRIBUTION'));

    _resetPythonAnalyticsCacheForTests();
    const confirmed = await runPythonAnalytics(makeDataset({
      window: WINDOW_12,
      monthly: twelveMonthMonthly(),
      scores: Object.fromEntries(WINDOW_12.map((_, i) => [i + 1, 90])),
      complaints: twelveMonthComplaints(true),
    }));
    assertOkOutcome(confirmed);
    const comp2 = confirmed.result.distributionAnalysis.complaints;
    assert.equal(comp2.status, 'OK');
    assert.ok(comp2.countTrend);
    assert.equal(comp2.countTrend!.direction, 'UP');
  });

  it('9-11. CAPA / follow-up / deal analyses are ratios of canonical counts', async () => {
    _resetPythonAnalyticsCacheForTests();
    const outcome = await runPythonAnalytics(makeDataset());
    assertOkOutcome(outcome);
    const d = outcome.result.distributionAnalysis;
    assert.equal(d.capa.active, 1);
    assert.equal(d.capa.terminal, 0);
    assert.equal(d.capa.overdueRatePct, 0);
    assert.equal(d.followUps.overdueRatePct, 14.3);
    assert.equal(d.followUps.completionRatePctEcho, 71.4);
    assert.equal(d.deals.cancellationRatePct, 13.3);
    assert.equal(d.deals.byStatus.items.find((i) => i.key === 'completed')!.count, 8);
  });

  it('12. attendance stays CONTEXT_ONLY and never enters cross-domain/correlation', async () => {
    _resetPythonAnalyticsCacheForTests();
    const outcome = await runPythonAnalytics(makeDataset({ window: WINDOW_12, monthly: twelveMonthMonthly() }));
    assertOkOutcome(outcome);
    const att = outcome.result.distributionAnalysis.attendance;
    assert.equal(att.analysisRole, 'CONTEXT_ONLY');
    assert.equal(att.metrics!.lateDays, 2);
    const blob = JSON.stringify(outcome.result.crossDomainPatterns) +
      JSON.stringify(outcome.result.correlations);
    assert.ok(!blob.includes('attendance'));
  });

  it('13. conservative anomaly detection: count spike + score drop + NOT wrongdoing', async () => {
    _resetPythonAnalyticsCacheForTests();
    const spike = await runPythonAnalytics(makeDataset());
    assertOkOutcome(spike);
    const obsSpike = spike.result.anomalies.find((a) => a.anomalyType === 'OBSERVATIONS_COUNT_SPIKE');
    assert.ok(obsSpike, '20 vs baseline [1,2,1,2,1] must flag');
    assert.equal(obsSpike!.observedValue, 20);
    assert.ok(obsSpike!.zScore! >= 3);
    assert.equal(obsSpike!.expectedRange.method, 'ROBUST_Z_MEDIAN_MAD');
    assert.equal(obsSpike!.noteCode, 'ANOMALY_NOT_WRONGDOING');
    assert.equal(obsSpike!.supportingEvidence[0].collection, 'qualityObservations');

    const drop = await runPythonAnalytics(makeDataset({
      scores: { 1: 80, 2: 85, 3: 90, 4: 88, 5: 92, 6: 74 },
    }));
    assertOkOutcome(drop);
    const scoreDrop = drop.result.anomalies.find((a) => a.anomalyType === 'SCORE_DROP');
    assert.ok(scoreDrop);
    assert.equal(scoreDrop!.observedValue, -18);
    assert.equal(scoreDrop!.severity, 'MEDIUM');
    assert.equal(scoreDrop!.direction, 'BELOW_EXPECTED');
  });

  it('14. small samples: baseline < 5 months → no anomalies, explicit gap', async () => {
    _resetPythonAnalyticsCacheForTests();
    const outcome = await runPythonAnalytics(makeDataset({
      window: ['2026-03', '2026-04', '2026-05', '2026-06'],
      monthly: {
        observations: [
          { month: '2026-03', count: 1 }, { month: '2026-04', count: 2 },
          { month: '2026-05', count: 1 }, { month: '2026-06', count: 20 },
        ],
        complaints: [], capa: [], followUps: [], deals: [],
      },
      scores: { 1: 80, 2: 85, 3: 90, 4: 91 },
    }));
    assertOkOutcome(outcome);
    assert.equal(outcome.result.anomalies.length, 0);
    assert.ok(outcome.result.dataQuality.insufficientSamples.some(
      (s) => s.area === 'anomalyDetection' && s.reason === 'INSUFFICIENT_BASELINE',
    ));
  });

  it('15. evidence references preserved across insights', async () => {
    _resetPythonAnalyticsCacheForTests();
    const outcome = await runPythonAnalytics(makeDataset());
    assertOkOutcome(outcome);
    const collections = outcome.result.evidenceReferences.map((e) => e.collection);
    assert.ok(collections.includes('qualityObservations'));
    assert.ok(collections.includes('monthSnapshots'));
    assert.ok(collections.includes('complaints'));
    for (const ref of outcome.result.evidenceReferences) {
      assert.ok(ref.completeRecordList);
      assert.ok(ref.recordIds.length > 0);
    }
  });

  it('16-17. confidence + archived employee + finalized month handling', async () => {
    _resetPythonAnalyticsCacheForTests();
    const archived = await runPythonAnalytics(makeDataset({ archived: true }));
    assertOkOutcome(archived);
    assert.equal(archived.result.input.employmentStatus, 'archived');
    assert.equal(archived.result.input.archivedButEligible, true);
    assert.ok(archived.result.dataQuality.notes.some((n) => n.startsWith('ARCHIVED_BUT_ELIGIBLE')));
    assert.equal(archived.result.input.valueBasis, 'FINALIZED');
    assert.equal(archived.result.input.finalized, true);

    _resetPythonAnalyticsCacheForTests();
    const mtd = await runPythonAnalytics(makeDataset({ reportedBasis: 'MTD' }));
    assertOkOutcome(mtd);
    assert.equal(mtd.result.anomalies.length, 0);
    assert.ok(mtd.result.dataQuality.insufficientSamples.some(
      (s) => s.reason === 'MTD_PARTIAL_MONTH',
    ));
  });

  it('18-19. KPI immutability: verbatim echo, single occurrence, input untouched', async () => {
    _resetPythonAnalyticsCacheForTests();
    const dataset = makeDataset(); // 91 × 15% = 13.65
    const snapshot = JSON.stringify(dataset);
    const outcome = await runPythonAnalytics(dataset);
    assertOkOutcome(outcome);
    const r = outcome.result;

    assert.equal(r.kpiFactsEcho.rawScore, 91);
    assert.equal(r.kpiFactsEcho.weight, 15);
    assert.equal(r.kpiFactsEcho.weightedContribution, 13.65);
    assert.equal(r.kpiFactsEcho.source, 'kpi_engine');

    // The contribution value appears EXACTLY once in the entire result —
    // inside the verbatim echo, never recalculated elsewhere.
    let occurrences = 0;
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') return Object.values(node).forEach(walk);
      if (typeof node === 'number' && Math.abs(node - 13.65) < 1e-9) occurrences += 1;
    };
    walk(r);
    assert.equal(occurrences, 1);

    // The input dataset object was not mutated by the bridge.
    assert.equal(JSON.stringify(dataset), snapshot);
  });

  it('23. JSON serialization round-trips losslessly', async () => {
    _resetPythonAnalyticsCacheForTests();
    const outcome = await runPythonAnalytics(makeDataset());
    assertOkOutcome(outcome);
    const clone = JSON.parse(JSON.stringify(outcome.result));
    assert.deepEqual(clone, outcome.result);
  });

  it('29. cache: content-keyed, hit on repeat, miss on data change', async () => {
    _resetPythonAnalyticsCacheForTests();
    const dataset = makeDataset();
    const first = await runPythonAnalytics(dataset);
    assertOkOutcome(first);
    assert.equal(first.cached, false);
    const second = await runPythonAnalytics(dataset);
    assertOkOutcome(second);
    assert.equal(second.cached, true);
    assert.ok(_pythonAnalyticsCacheSizeForTests() >= 1);

    const changed = await runPythonAnalytics(makeDataset({ scores: { 1: 82, 2: 85, 3: 90, 4: 88, 5: 92, 6: 91 } }));
    assertOkOutcome(changed);
    assert.equal(changed.cached, false);
  });

  it('21-22. failure isolation: unavailable / disabled / bad binary / garbage output / timeout — never throws', async () => {
    // Start from a cold cache — cached results would bypass the binary
    // resolution paths under test.
    _resetPythonAnalyticsCacheForTests();

    // Disabled by env.
    await withEnv({ PYTHON_ANALYTICS_ENABLED: '0' }, async () => {
      const outcome = await runPythonAnalytics(makeDataset());
      assert.equal(outcome.ok, false);
      assert.equal(outcome.reason, 'DISABLED');
    });

    // Nonexistent binary → PYTHON_UNAVAILABLE (not a crash).
    await withEnv({ PYTHON_ANALYTICS_BIN: '/nonexistent/python-binary-xyz' }, async () => {
      const outcome = await runPythonAnalytics(makeDataset());
      assert.equal(outcome.ok, false);
      assert.equal(outcome.reason, 'PYTHON_UNAVAILABLE');
    });

    // Binary that exits non-zero → SCRIPT_ERROR.
    await withEnv({ PYTHON_ANALYTICS_BIN: '/bin/false' }, async () => {
      const outcome = await runPythonAnalytics(makeDataset());
      assert.equal(outcome.ok, false);
      assert.equal(outcome.reason, 'SCRIPT_ERROR');
    });

    // Binary producing garbage stdout → INVALID_OUTPUT.
    await withEnv({ PYTHON_ANALYTICS_BIN: '/bin/echo' }, async () => {
      const outcome = await runPythonAnalytics(makeDataset());
      assert.equal(outcome.ok, false);
      assert.equal(outcome.reason, 'INVALID_OUTPUT');
    });

    // Hanging engine → TIMEOUT (fixture sleeps 30s, timeout 1s).
    const sleepScript = path.join(process.cwd(),
      'python-analytics/tests/fixtures/sleep_engine.py');
    assert.ok(fs.existsSync(sleepScript), 'timeout fixture must exist');
    await withEnv({
      PYTHON_ANALYTICS_SCRIPT: sleepScript,
      PYTHON_ANALYTICS_TIMEOUT_MS: '1000',
    }, async () => {
      const started = Date.now();
      const outcome = await runPythonAnalytics(makeDataset());
      assert.equal(outcome.ok, false);
      assert.equal(outcome.reason, 'TIMEOUT');
      assert.ok(Date.now() - started < 10_000, 'timeout must actually fire');
    });
  });

  // ════════════════════════════════════════════════════════════
  //  Phase 5.1A — data availability diagnostics & state separation
  // ════════════════════════════════════════════════════════════

  it('5.1A-1. current partial MTD dataset (1 month, 2 obs, 0 complaints/capa, 3 followUps, 3 deals) → section AVAILABLE with per-method INSUFFICIENT_DATA (spec §5/§17.1/§17.2/§17.6)', async () => {
    _resetPythonAnalyticsCacheForTests();
    const month = '2026-08';
    const dataset = makeDataset({
      window: [month],
      scores: { 1: 88 },
      reportedBasis: 'MTD',
      monthly: {
        observations: [{ month, count: 2 }],
        complaints: [{ month, count: 0 }],
        capa: [{ month, count: 0 }],
        followUps: [{ month, count: 3 }],
        deals: [{ month, count: 3 }],
      },
      // Zero-complaint profile with CONFIRMED attribution — mirrors the
      // real "complaints = 0" dataset from the Phase 5.1A report.
      complaints: {
        relationship: 'CONFIRMED', total: 0,
        byStatus: {}, byType: {}, bySeverity: {},
        repeatedTypes: [],
        resolvedOrClosed: 0, stillOpen: 0, viaDealCount: 0, avgResolutionDays: null,
        monthly: [{ month, count: 0 }],
      },
    });
    // Zero the CAPA domain post-construction (the shared fixture hardcodes
    // 1 CAPA) so the dataset mirrors the exact §5 profile: capa = 0.
    const mutable = dataset as unknown as { capa: Record<string, unknown> };
    mutable.capa = {
      relationship: 'CONFIRMED', total: 0,
      byStatus: {}, byPriority: {}, bySource: {},
      active: 0, terminal: 0, overdue: 0, avgOverdueDays: null,
      correctiveStatus: {}, preventiveStatus: {},
      closedCount: 0, avgClosureDays: null, indirectCount: 0,
      monthly: [{ month, count: 0 }],
    };
    const outcome = await runPythonAnalytics(dataset);
    // §5: the SECTION stays available — Python executed successfully.
    assertOkOutcome(outcome);
    const r = outcome.result;
    // §17.2: current month with limited data still returns AVAILABLE
    assert.equal(r.status, 'OK');
    assert.equal(r.schemaVersion, ANALYTICS_SCHEMA_VERSION);
    // §17.3: trend independently INSUFFICIENT_DATA (1 < 3 months).
    assert.equal(r.trendAnalysis.status, 'INSUFFICIENT_DATA');
    assert.equal(r.trendAnalysis.availableMonths, 1);
    assert.equal(r.trendAnalysis.stats, null);
    // §17.4: correlations independently insufficient (n < 8 → no rows).
    assert.equal(r.correlations.length, 0);
    assert.ok(r.dataQuality.insufficientSamples.some((s) => s.area === 'correlation'));
    // §17.5: anomaly detection independently insufficient (baseline < 5).
    assert.equal(r.anomalies.length, 0);
    assert.ok(r.dataQuality.insufficientSamples.some((s) => s.area === 'anomalyDetection'));
    // §17.6: basic distributions still return results.
    assert.equal(r.patternAnalysis.observations.status, 'OK');
    assert.equal(r.patternAnalysis.observations.bySeverity.total > 0, true);
    assert.equal(r.distributionAnalysis.followUps.status, 'OK');
    assert.equal(r.distributionAnalysis.deals.status, 'OK');
    assert.equal(r.distributionAnalysis.complaints.status, 'EMPTY');
    assert.equal(r.distributionAnalysis.capa.status, 'EMPTY');
    // MTD partial month is recorded, never hidden, never zero-filled.
    assert.ok(r.dataQuality.insufficientSamples.some((s) => s.reason === 'MTD_PARTIAL_MONTH'));
    // KPI echo stays verbatim (never recalculated).
    assert.equal(r.kpiFactsEcho.rawScore, 91);
  });

  it('5.1A-2. per-method independence: 4 months → trend OK but anomalies still insufficient; 7 months → correlations still insufficient (spec §17.3/§17.4/§17.5)', async () => {
    _resetPythonAnalyticsCacheForTests();
    const fourMonths = WINDOW_6.slice(0, 4);
    const m4 = await runPythonAnalytics(makeDataset({
      window: fourMonths,
      scores: { 1: 80, 2: 85, 3: 90, 4: 88 },
    }));
    assertOkOutcome(m4);
    assert.equal(m4.result.trendAnalysis.status, 'OK', '4 months satisfy TREND_MIN_MONTHS=3');
    assert.equal(m4.result.anomalies.length, 0, 'anomaly baseline needs 5 months');
    assert.equal(m4.result.correlations.length, 0, 'correlation needs n>=8');

    const sevenMonths = WINDOW_12.slice(0, 7);
    const m7 = await runPythonAnalytics(makeDataset({
      window: sevenMonths,
      scores: Object.fromEntries(sevenMonths.map((_, i) => [i + 1, 80 + i])),
      monthly: {
        observations: sevenMonths.map((m, i) => ({ month: m, count: i + 1 })),
        complaints: sevenMonths.map((m, i) => ({ month: m, count: i })),
        capa: sevenMonths.map((m) => ({ month: m, count: 0 })),
        followUps: sevenMonths.map((m) => ({ month: m, count: 1 })),
        deals: sevenMonths.map((m) => ({ month: m, count: 2 })),
      },
      complaints: twelveMonthComplaints(true),
    }));
    assertOkOutcome(m7);
    assert.equal(m7.result.trendAnalysis.status, 'OK');
    assert.equal(m7.result.correlations.length, 0, '7 < CORRELATION_MIN_MONTHS=8');
    assert.ok(m7.result.dataQuality.insufficientSamples.some((s) => s.area === 'correlation'));
  });

  it('5.1A-3. dataset violating the input contract → DATA_CONTRACT_ERROR, NEVER PYTHON_UNAVAILABLE (spec §17.9)', async () => {
    _resetPythonAnalyticsCacheForTests();
    // Missing employee/period/quality/... — the engine exits 2 with
    // {"status":"INVALID_INPUT"} and the bridge must classify that as
    // a DATA-CONTRACT problem (Python itself started fine).
    const malformed = { datasetKind: 'EMPLOYEE_PERFORMANCE_INTELLIGENCE' } as unknown as EmployeePerformanceDataset;
    const outcome = await runPythonAnalytics(malformed);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'DATA_CONTRACT_ERROR');
    assert.match(outcome.detail ?? '', /MISSING_DATASET_FIELDS|UNSUPPORTED|INVALID/);
    // API mapping: contract error is an ERROR state, not unavailability.
    const body = analyticsApiResponseBody(outcome);
    assert.equal(body.status, 'ANALYTICS_ERROR');
    assert.equal((body as { reason: string }).reason, 'DATA_CONTRACT_ERROR');
  });
});
