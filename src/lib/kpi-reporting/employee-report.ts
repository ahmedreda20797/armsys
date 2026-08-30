// ══════════════════════════════════════════════════════════════
//  KPI Reporting Layer — Employee KPI Report (Phase 2)
//
//  The complete view of ONE employee's KPI for ONE period (spec
//  §4/§5/§31). Every value flows through the canonical engine:
//
//    outcome = computeEmployeeKpiResultWithLoaders(...)   ← the
//    Phase-1 pipeline (frozen ▸ derived ▸ live, eligibility,
//    scheme resolution) — REUSED VERBATIM, never re-implemented.
//
//  Supporting sections reuse existing data only:
//    • evidence  — the employee's own quality observations
//                  (§32 fields + per-observation KPI effect)
//    • trend     — frozen snapshots first, engine fallback (§16);
//                  months without results are UNAVAILABLE, never 0
//    • MoM       — percentage POINTS vs previous available month
//                  (§17) — explicitly not percentage growth
//    • contract  — §28 structured projection for the future
//                  Python/AI layer (no AI implemented in this phase)
// ══════════════════════════════════════════════════════════════

import type { QualityObservation } from '@/types/quality-kpi';
import type { EmployeeKpiResult } from '@/lib/kpi-framework/types';
import { computeEmployeeKpiResultWithLoaders } from '@/lib/kpi-framework/employee-result';
import { isValidMonthKey } from '@/lib/month-utils';
import { roundTo2 } from '@/lib/kpi-framework/validation';
import { classifyEvidence } from '@/lib/quality-observations/evidence';
import type {
  EmployeeKpiReport,
  KpiDataContractComponent,
  KpiMomComparison,
  KpiReportDataContract,
  KpiReportEmployeeInfo,
  KpiReportObservation,
  KpiReportSchemeDisplay,
  KpiReportTraceability,
  KpiTrendPoint,
} from './types';
import type { KpiReportingLoaders } from './loaders';
import { defaultKpiReportingLoaders, employmentStatusOf } from './loaders';
import {
  deriveRowStatus,
  findQualityComponent,
  toQualitySlice,
} from './rows';
import { dayKeyOf, KPI_OUTCOME_MESSAGES, previousMonthKey, resolveValueBasis, trendWindow } from './period-basis';

// ─────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────

export interface BuildEmployeeKpiReportInput {
  employeeId: string;
  /** YYYY-MM period. */
  monthKey: string;
  /** Trend window length INCLUDING the reported month (default 6). */
  trendMonths?: number;
  now?: Date;
  loaders?: KpiReportingLoaders;
}

/**
 * Build the Employee KPI Report. Throws ONLY for caller bugs
 * (invalid month key); every business outcome (employee not found,
 * not eligible, no scheme…) is an explicit `outcomeStatus`.
 */
export async function buildEmployeeKpiReport(
  input: BuildEmployeeKpiReportInput,
): Promise<EmployeeKpiReport> {
  if (!isValidMonthKey(input.monthKey)) {
    throw new Error(`invalid month key: ${String(input.monthKey)}`);
  }

  const loaders = input.loaders ?? defaultKpiReportingLoaders;
  const now = input.now ?? new Date();
  const { employeeId, monthKey } = input;

  // ── Batched reads (spec §21) ──
  const [employeeRecord, snapshot, observations, teamNames] = await Promise.all([
    loaders.loadEmployeeRecord(employeeId),
    loaders.loadSnapshotDocument(monthKey),
    loaders.loadObservations(monthKey),
    loaders.loadTeamNames(),
  ]);

  // ── Canonical engine pipeline (Phase 1 — reused verbatim) ──
  const outcome = await computeEmployeeKpiResultWithLoaders({ employeeId, period: monthKey }, loaders);

  const status = employeeRecord ? employmentStatusOf(employeeRecord) : ('unknown' as const);
  // §11: archived-yet-visible = the ENGINE's own eligibility verdict
  // (no second lifecycle implementation).
  const eligibleNow =
    outcome.status !== 'NOT_ELIGIBLE_PERIOD' && outcome.status !== 'EMPLOYEE_NOT_FOUND';

  const employeeInfo: KpiReportEmployeeInfo = employeeRecord
    ? {
        employeeId: employeeRecord.id,
        employeeName: employeeRecord.name,
        employeeCode: employeeRecord.code,
        department: employeeRecord.department,
        team: teamNames.get(employeeId) ?? null,
        position: employeeRecord.position,
        employmentStatus: status,
        archivedButEligible: status === 'archived' && eligibleNow,
      }
    : {
        employeeId,
        employeeName: '',
        employeeCode: null,
        department: null,
        team: null,
        position: null,
        employmentStatus: 'unknown' as const,
        archivedButEligible: false,
      };

  const valueBasis = resolveValueBasis(monthKey, snapshot?.status ?? null, now);
  const result = outcome.result;

  const qualityComponent = result ? findQualityComponent(result.components) : null;
  const quality = qualityComponent ? toQualitySlice(qualityComponent) : null;

  const finalized = outcome.status === 'FROZEN_RESULT' || !!result?.finalizedAt;
  const rowStatus = result
    ? deriveRowStatus({
        hasResult: true,
        finalized,
        overallStatus: result.overallStatus,
        qualityStatus: quality?.status ?? null,
        resultSource:
          outcome.status === 'FROZEN_RESULT' ? 'FROZEN_RESULT'
            : finalized ? 'DERIVED'
            : 'LIVE',
      })
    : nonValueRowStatus(outcome.status);

  const scheme = result
    ? ({
        schemeId: result.schemeId,
        schemeName: result.schemeName,
        schemeVersion: result.schemeVersion,
        qualityWeight: quality?.weight ?? null,
        frozen: outcome.status === 'FROZEN_RESULT' || !!result.finalizedAt,
      } satisfies KpiReportSchemeDisplay)
    : null;

  const ownObservations = observations.filter((o) => o.employeeId === employeeId);
  const evidence = evidenceBlock(ownObservations);

  const traceability: KpiReportTraceability | null = qualityComponent
    ? {
        source: qualityComponent.evidence?.source ?? 'quality_engine',
        origin: qualityComponent.evidence?.origin ?? null,
        observationCount: qualityComponent.evidence?.observationCount ?? 0,
        deductionPoints: qualityComponent.evidence?.deductionPoints ?? 0,
        bonusPoints: qualityComponent.evidence?.bonusPoints ?? 0,
        frozen: finalized,
      }
    : null;

  // ── §16 Trend — frozen snapshots first, engine fallback ──
  const window = trendWindow(monthKey, input.trendMonths ?? 6);
  const trend = await buildTrend({ employeeId, window, now, loaders, ownEmployeeId: employeeId });

  // ── §17 MoM — percentage points vs the previous calendar month ──
  const mom = buildMomComparison(trend, monthKey, previousMonthKey(monthKey));

  const dataContract = result
    ? toDataContract({
        result,
        valueBasis,
        finalized,
        rowStatus,
        evidenceReferences: evidence.observations.filter((o) => o.effect.counted).map((o) => o.id),
      })
    : null;

  return {
    reportKind: 'EMPLOYEE',
    employee: employeeInfo,
    period: {
      monthKey,
      valueBasis,
      finalizedAt: finalized ? (result?.finalizedAt ?? snapshot?.closedAt ?? null) : null,
      asOfDate: dayKeyOf(now),
    },
    outcomeStatus: outcome.status,
    message:
      outcome.status === 'RESOLVED' || outcome.status === 'FROZEN_RESULT'
        ? null
        : KPI_OUTCOME_MESSAGES[outcome.status] ?? null,
    scheme,
    components: result?.components ?? [],
    quality,
    availableWeight: result?.availableWeight ?? null,
    weightedTotal: result?.weightedTotal ?? null,
    overallStatus: result?.overallStatus ?? null,
    rowStatus,
    traceability,
    evidence,
    trend: { months: trend, mom },
    dataContract,
    generatedAt: now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────
//  Outcome mapping
// ─────────────────────────────────────────────────────────────

function nonValueRowStatus(outcomeStatus: string): EmployeeKpiReport['rowStatus'] {
  switch (outcomeStatus) {
    case 'NOT_ELIGIBLE_PERIOD': return 'NOT_ELIGIBLE';
    case 'NO_SCHEME': return 'NO_SCHEME';
    case 'AMBIGUOUS': return 'AMBIGUOUS';
    case 'OVERRIDE_NOT_RESOLVABLE': return 'OVERRIDE_NOT_RESOLVABLE';
    default: return 'PENDING';
  }
}

// ─────────────────────────────────────────────────────────────
//  §32  Evidence block (existing observation records, reused)
// ─────────────────────────────────────────────────────────────

function toReportObservation(o: QualityObservation): KpiReportObservation {
  const applies = o.applyPointDeduction === true;
  const counted = applies && o.approvalStatus === 'approved';
  const signedPoints = counted ? (o.isBonus ? o.points : -o.points) : 0;
  return {
    id: o.id,
    observationDate: o.observationDate,
    month: o.month,
    type: o.type,
    categoryName: o.categoryName,
    severity: o.severity,
    status: o.status,
    approvalStatus: o.approvalStatus,
    notes: o.notes,
    evidence: classifyEvidence(o.evidence),
    relatedCapaId: o.relatedCapaId,
    effect: {
      applies,
      isBonus: o.isBonus,
      points: o.points,
      signedPoints,
      counted,
    },
  };
}

function evidenceBlock(observations: ReadonlyArray<QualityObservation>): EmployeeKpiReport['evidence'] {
  const mapped = observations.map(toReportObservation);
  // Deterministic order: newest month first, then date desc, then id.
  mapped.sort(
    (a, b) =>
      b.month.localeCompare(a.month) ||
      b.observationDate.localeCompare(a.observationDate) ||
      a.id.localeCompare(b.id),
  );
  return {
    observations: mapped,
    counts: {
      total: mapped.length,
      approved: mapped.filter((o) => o.approvalStatus === 'approved').length,
      pending: mapped.filter((o) => o.approvalStatus === 'pending').length,
      rejected: mapped.filter((o) => o.approvalStatus === 'rejected').length,
      scoring: mapped.filter((o) => o.effect.counted).length,
    },
  };
}

// ─────────────────────────────────────────────────────────────
//  §16  Trend (frozen first — engine fallback, no recalculation)
// ─────────────────────────────────────────────────────────────

async function buildTrend(args: {
  employeeId: string;
  window: ReadonlyArray<string>;
  now: Date;
  loaders: KpiReportingLoaders;
  /** present for signature clarity; the loaders carry the id scope */
  ownEmployeeId: string;
}): Promise<KpiTrendPoint[]> {
  const { employeeId, window, now, loaders } = args;
  const snapshots = await loaders.loadSnapshotDocuments(window);

  const points: KpiTrendPoint[] = [];
  for (const monthKey of window) {
    const snapshot = snapshots.get(monthKey) ?? null;

    // ── Fast path: closed month with a frozen framework result ──
    const frozen = snapshot?.status === 'closed' ? snapshot.kpiResults?.[employeeId] : undefined;
    if (frozen) {
      points.push(pointFromResult(frozen as EmployeeKpiResult, 'FINALIZED', true));
      continue;
    }

    // ── Engine path: legacy derived / live / explicit non-value ──
    const outcome = await computeEmployeeKpiResultWithLoaders({ employeeId, period: monthKey }, loaders);
    const basis = resolveValueBasis(monthKey, snapshot?.status ?? null, now);

    if (outcome.result) {
      const finalized = outcome.status === 'FROZEN_RESULT' || !!outcome.result.finalizedAt;
      points.push(pointFromResult(outcome.result, basis, finalized));
    } else {
      points.push({
        monthKey,
        valueBasis: basis,
        available: false,
        rawScore: null,
        weightedContribution: null,
        weight: null,
        rowStatus: nonValueRowStatus(outcome.status),
        finalized: false,
        schemeId: null,
        schemeVersion: null,
      });
    }
  }
  return points;
}

function pointFromResult(
  result: EmployeeKpiResult,
  valueBasis: KpiTrendPoint['valueBasis'],
  finalized: boolean,
): KpiTrendPoint {
  const quality = findQualityComponent(result.components);
  // §16: a month with no valid quality result is UNAVAILABLE (PENDING),
  // never zero — regardless of the overall framework status.
  const hasQualityValue = quality !== null && quality.rawScore !== null;
  const status: KpiTrendPoint['rowStatus'] = hasQualityValue
    ? deriveRowStatus({
        hasResult: true,
        finalized,
        overallStatus: result.overallStatus,
        qualityStatus: quality!.status,
        resultSource: finalized ? 'FROZEN_RESULT' : 'LIVE',
      })
    : 'PENDING';
  return {
    monthKey: result.period,
    valueBasis,
    available: hasQualityValue,
    rawScore: quality?.rawScore ?? null,
    weightedContribution: quality?.weightedContribution ?? null,
    weight: quality?.weight ?? null,
    rowStatus: status,
    finalized,
    schemeId: result.schemeId,
    schemeVersion: result.schemeVersion,
  };
}

// ─────────────────────────────────────────────────────────────
//  §17  MoM comparison — PERCENTAGE POINTS, not growth
// ─────────────────────────────────────────────────────────────

export function buildMomComparison(
  trend: ReadonlyArray<KpiTrendPoint>,
  currentMonth: string,
  previousMonth: string,
): KpiMomComparison | null {
  const current = trend.find((p) => p.monthKey === currentMonth);
  const previous = trend.find((p) => p.monthKey === previousMonth);
  if (!current?.available || current.rawScore === null) return null;
  if (!previous?.available || previous.rawScore === null) return null;

  const deltaPoints = roundTo2(current.rawScore - previous.rawScore);
  const growthPercent =
    previous.rawScore === 0 ? null : roundTo2((deltaPoints / previous.rawScore) * 100);

  return {
    currentMonth,
    previousMonth,
    currentRawScore: current.rawScore,
    previousRawScore: previous.rawScore,
    deltaPoints,
    growthPercent,
  };
}

// ─────────────────────────────────────────────────────────────
//  §28  Data contract for the future Python/AI layer
// ─────────────────────────────────────────────────────────────

function toDataContract(args: {
  result: EmployeeKpiResult;
  valueBasis: EmployeeKpiReport['period']['valueBasis'];
  finalized: boolean;
  rowStatus: EmployeeKpiReport['rowStatus'];
  evidenceReferences: string[];
}): KpiReportDataContract {
  const { result } = args;
  const components: KpiDataContractComponent[] = result.components.map((c) => ({
    componentId: c.componentId,
    name: c.name,
    owner: c.owner,
    rawScore: c.rawScore,
    weight: c.weight,
    weightedContribution: c.weightedContribution,
    maxContribution: c.maxContribution,
    status: c.status,
    // Quality observations carry the evidence references; future
    // components will carry their own when their adapters land.
    evidenceReferences: c.evidence?.source === 'quality_engine' ? [...args.evidenceReferences] : [],
  }));

  return {
    employeeId: result.employeeId,
    period: result.period,
    schemeId: result.schemeId,
    schemeVersion: result.schemeVersion,
    valueBasis: args.valueBasis,
    finalized: args.finalized,
    finalizedAt: result.finalizedAt,
    calculationVersion: result.calculationVersion,
    components,
    availableWeight: result.availableWeight,
    weightedTotal: result.weightedTotal,
    overallStatus: result.overallStatus,
    overallRowStatus: args.rowStatus,
  };
}
