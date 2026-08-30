// ══════════════════════════════════════════════════════════════
//  KPI Reporting Layer — Shared row assembly (Phase 2, PURE)
//
//  Everything in this module is a PURE transformation of engine
//  results / frozen snapshot data into report rows. NO formula lives
//  here:
//    • raw scores are consumed verbatim from engine results
//    • contributions are consumed verbatim (engine: raw × weight/100)
//    • weights are the scheme component weights verbatim (spec §27)
//  Filters/sorting are presentation-only and run AFTER the
//  authorized scope narrowing (M0.5 read doctrine).
// ══════════════════════════════════════════════════════════════

import type { KpiComponentResult, KpiComponentResultStatus, KpiOverallStatus } from '@/lib/kpi-framework/types';
import { isValueBearingStatus } from '@/lib/kpi-framework';
import type {
  KpiMonthlyFilters,
  KpiMonthlySort,
  KpiMonthlyTotals,
  KpiReportQualitySlice,
  KpiReportRow,
  KpiReportRowStatus,
  KpiRowResultSource,
  KpiValueBasis,
} from './types';
import { KPI_REPORT_STATUS_RANK } from './types';

// ─────────────────────────────────────────────────────────────
//  Quality slice extraction (verbatim from the engine result)
// ─────────────────────────────────────────────────────────────

/**
 * Locate the Quality component result inside an engine result. The
 * definitive marker is the adapter source stamped by the framework's
 * quality adapter (`evidence.source === 'quality_engine'`); the
 * owner is the fallback for legacy results.
 */
export function findQualityComponent(
  components: ReadonlyArray<KpiComponentResult>,
): KpiComponentResult | null {
  return (
    components.find((c) => c.evidence?.source === 'quality_engine') ??
    components.find((c) => c.owner === 'quality') ??
    null
  );
}

/** Project an engine quality component into the reporting slice. */
export function toQualitySlice(component: KpiComponentResult): KpiReportQualitySlice {
  return {
    componentId: component.componentId,
    name: component.name,
    status: component.status,
    rawScore: component.rawScore,
    weight: component.weight,
    weightedContribution: component.weightedContribution,
    maxContribution: component.maxContribution,
    observationCount: component.evidence?.observationCount ?? 0,
    deductionPoints: component.evidence?.deductionPoints ?? 0,
    bonusPoints: component.evidence?.bonusPoints ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────
//  §12  Display status derivation
// ─────────────────────────────────────────────────────────────

/**
 * Single display badge for a row/employee. Precedence keeps every
 * spec §12 state distinguishable and never collapses missing data
 * into 0:
 *   explicit exclusion/failure → FINALIZED → ZERO → AVAILABLE →
 *   INCOMPLETE → PENDING.
 */
export function deriveRowStatus(args: {
  hasResult: boolean;
  finalized: boolean;
  overallStatus: KpiOverallStatus | null;
  qualityStatus: KpiComponentResultStatus | null;
  resultSource: KpiRowResultSource;
}): KpiReportRowStatus {
  if (!args.hasResult) {
    switch (args.resultSource) {
      case 'NOT_ELIGIBLE': return 'NOT_ELIGIBLE';
      case 'NO_SCHEME': return 'NO_SCHEME';
      case 'AMBIGUOUS': return 'AMBIGUOUS';
      case 'OVERRIDE_NOT_RESOLVABLE': return 'OVERRIDE_NOT_RESOLVABLE';
      default: return 'PENDING';
    }
  }
  if (args.finalized) return 'FINALIZED';
  if (args.qualityStatus === 'ZERO') return 'ZERO';
  if (args.overallStatus === 'COMPLETE') return 'AVAILABLE';
  return 'INCOMPLETE';
}

// ─────────────────────────────────────────────────────────────
//  Engine result → row projection
// ─────────────────────────────────────────────────────────────

/** The identity slice shared by every row builder. */
export interface RowIdentity {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  team: string | null;
  position: string | null;
  employmentStatus: KpiReportRow['employmentStatus'];
  archivedButEligible: boolean;
}

/**
 * Project an engine `EmployeeKpiResult` (frozen, derived or live —
 * they share one shape) into a report row. Values are copied
 * VERBATIM — this function must never round, rescale or substitute.
 */
export function buildRowFromResult(args: {
  identity: RowIdentity;
  result: {
    employeeId: string;
    schemeId: string;
    schemeName: string;
    schemeVersion: number;
    components: KpiComponentResult[];
    availableWeight: number;
    weightedTotal: number;
    overallStatus: KpiOverallStatus;
    finalizedAt: string | null;
  };
  finalized: boolean;
  valueBasis: KpiValueBasis;
  resultSource: Extract<KpiRowResultSource, 'FROZEN_RESULT' | 'DERIVED' | 'LIVE'>;
}): KpiReportRow {
  const qualityComponent = findQualityComponent(args.result.components);
  const quality = qualityComponent ? toQualitySlice(qualityComponent) : null;
  const rowStatus = deriveRowStatus({
    hasResult: true,
    finalized: args.finalized,
    overallStatus: args.result.overallStatus,
    qualityStatus: quality?.status ?? null,
    resultSource: args.resultSource,
  });
  return {
    ...args.identity,
    quality,
    availableWeight: args.result.availableWeight,
    weightedTotal: args.result.weightedTotal,
    overallStatus: args.result.overallStatus,
    rowStatus,
    finalized: args.finalized,
    valueBasis: args.valueBasis,
    resultSource: args.resultSource,
    schemeId: args.result.schemeId,
    schemeName: args.result.schemeName,
    schemeVersion: args.result.schemeVersion,
    finalizedAt: args.result.finalizedAt,
  };
}

/** A row WITHOUT a result — explicit status, null values everywhere. */
export function buildRowWithoutResult(args: {
  identity: RowIdentity;
  valueBasis: KpiValueBasis;
  resultSource: Extract<KpiRowResultSource, 'PENDING' | 'NO_SCHEME' | 'AMBIGUOUS' | 'OVERRIDE_NOT_RESOLVABLE' | 'NOT_ELIGIBLE'>;
  scheme?: { id: string; name: string; version: number } | null;
}): KpiReportRow {
  const rowStatus = deriveRowStatus({
    hasResult: false,
    finalized: false,
    overallStatus: null,
    qualityStatus: null,
    resultSource: args.resultSource,
  });
  return {
    ...args.identity,
    quality: null,
    availableWeight: null,
    weightedTotal: null,
    overallStatus: null,
    rowStatus,
    finalized: false,
    valueBasis: args.valueBasis,
    resultSource: args.resultSource,
    schemeId: args.scheme?.id ?? null,
    schemeName: args.scheme?.name ?? null,
    schemeVersion: args.scheme?.version ?? null,
    finalizedAt: null,
  };
}

// ─────────────────────────────────────────────────────────────
//  Filtering (presentation — runs AFTER scope narrowing)
// ─────────────────────────────────────────────────────────────

/**
 * Apply the monthly report filters. `scopeLimit` (the AUTHORIZED
 * employee set) is applied FIRST — a query parameter can only narrow
 * the authorized set, never widen it (M0.5 doctrine).
 */
export function applyMonthlyFilters(
  rows: ReadonlyArray<KpiReportRow>,
  filters: KpiMonthlyFilters | undefined,
): KpiReportRow[] {
  let out = [...rows];

  if (filters?.scopeLimit) {
    // Empty authorized set → empty report (fail-closed, never widened).
    const authorized = new Set(filters.scopeLimit);
    out = out.filter((r) => authorized.has(r.employeeId));
  }

  const query = filters?.employeeQuery?.trim().toLowerCase();
  if (query) {
    out = out.filter(
      (r) =>
        r.employeeName.toLowerCase().includes(query) ||
        (r.employeeCode ?? '').toLowerCase().includes(query) ||
        r.employeeId.toLowerCase().includes(query),
    );
  }

  if (filters?.department) {
    const dept = filters.department;
    out = out.filter((r) => r.department === dept);
  }

  if (filters?.team) {
    const team = filters.team;
    out = out.filter((r) => (r.team ?? '') === team);
  }

  if (filters?.status) {
    const status = filters.status;
    out = out.filter((r) => r.rowStatus === status);
  }

  const min = typeof filters?.minScore === 'number' && Number.isFinite(filters.minScore)
    ? filters.minScore
    : null;
  const max = typeof filters?.maxScore === 'number' && Number.isFinite(filters.maxScore)
    ? filters.maxScore
    : null;
  if (min !== null || max !== null) {
    // Raw-score range — rows WITHOUT a numeric score never match
    // (missing data is not 0, spec §12).
    out = out.filter((r) => {
      const score = r.quality?.rawScore;
      if (score === null || score === undefined) return false;
      if (min !== null && score < min) return false;
      if (max !== null && score > max) return false;
      return true;
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────
//  Sorting (deterministic — stable tie-break on employeeId)
// ─────────────────────────────────────────────────────────────

/** Missing values sort LAST regardless of direction. */
export function sortMonthlyRows(
  rows: ReadonlyArray<KpiReportRow>,
  sort: KpiMonthlySort | undefined,
): KpiReportRow[] {
  const out = [...rows];
  const dir = sort?.direction === 'desc' ? -1 : 1;

  const byId = (a: KpiReportRow, b: KpiReportRow) => a.employeeId.localeCompare(b.employeeId);

  switch (sort?.key) {
    case 'department':
      out.sort((a, b) =>
        dir * (a.department ?? '\uffff').localeCompare(b.department ?? '\uffff', 'ar') || byId(a, b));
      break;
    case 'team':
      out.sort((a, b) =>
        dir * (a.team ?? '\uffff').localeCompare(b.team ?? '\uffff', 'ar') || byId(a, b));
      break;
    case 'score':
      out.sort((a, b) => {
        const av = a.quality?.rawScore ?? null;
        const bv = b.quality?.rawScore ?? null;
        if (av === null && bv === null) return byId(a, b);
        if (av === null) return 1; // nulls last (asc); dir flips below for desc
        if (bv === null) return -1;
        const cmp = av - bv;
        return (dir === 1 ? cmp : -cmp) || byId(a, b);
      });
      break;
    case 'status':
      out.sort((a, b) =>
        dir * (KPI_REPORT_STATUS_RANK[a.rowStatus] - KPI_REPORT_STATUS_RANK[b.rowStatus]) || byId(a, b));
      break;
    case 'employeeName':
    default:
      out.sort((a, b) => dir * a.employeeName.localeCompare(b.employeeName, 'ar') || byId(a, b));
      break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
//  Totals
// ─────────────────────────────────────────────────────────────

/** Aggregate the display statuses of a row set (scoped view). */
export function computeMonthlyTotals(args: {
  rows: ReadonlyArray<KpiReportRow>;
  notEligibleCount: number;
}): KpiMonthlyTotals {
  const totals: KpiMonthlyTotals = {
    eligibleCount: args.rows.length,
    withResult: 0,
    available: 0,
    zero: 0,
    pending: 0,
    incomplete: 0,
    finalized: 0,
    noScheme: 0,
    notEligibleCount: args.notEligibleCount,
  };
  for (const row of args.rows) {
    // "KPI available" = the row carries a real (possibly zero) quality
    // value — the engine's own value-bearing vocabulary (spec §15).
    if (row.quality && isValueBearingStatus(row.quality.status)) totals.available += 1;
    if (row.quality) totals.withResult += 1;
    switch (row.rowStatus) {
      // 'AVAILABLE' rows are already counted by the value-bearing
      // pre-count above (rowStatus AVAILABLE ⇒ quality AVAILABLE).
      case 'ZERO': totals.zero += 1; break;
      case 'PENDING': totals.pending += 1; break;
      case 'INCOMPLETE': totals.incomplete += 1; break;
      case 'FINALIZED': totals.finalized += 1; break;
      case 'NO_SCHEME':
      case 'AMBIGUOUS':
      case 'OVERRIDE_NOT_RESOLVABLE':
        totals.noScheme += 1;
        break;
      default:
        break;
    }
  }
  return totals;
}
