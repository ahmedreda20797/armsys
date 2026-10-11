// ══════════════════════════════════════════════════════════════
//  KPI Reporting Layer — Insights workspace builder (KPI Reports 2.0)
//
//  ONE canonical assembly for the operational performance
//  intelligence workspace. It answers the four management questions
//  (WHO · HOW · WHY · WHAT NEXT) by COMPOSING the existing engines —
//  it never recomputes one:
//
//    • quality % / evaluation status → buildMonthlyKpiReport
//      (current + previous month — the same rows the monthly report
//      serves; frozen snapshots verbatim for closed months)
//    • change vs previous period → arithmetic difference between two
//      canonical monthly assemblies (both value-bearing, else null —
//      missing data is never a zero)
//    • category/severity distributions → aggregateObservations
//      (lib/performance-intelligence — the canonical pure engine)
//    • repeated issues → detectRepeatedIssues / detectWindowRecurrence
//      (the SAME deterministic functions the intelligence layer uses;
//      min-occurrence threshold is the canonical DEFAULT)
//    • organization narrowing → lib/organization graph (canonical
//      tree) intersected with the AUTHORIZED employee scope — a
//      client selection can only NARROW, never widen (M0.5 doctrine)
//
//  QUALITY INPUT RULE: distributions, repeated issues and signals
//  run over APPROVED observations only (approvalStatus === 'approved'
//  — the canonical KPI input). Pending/rejected appear as counts so
//  the report can explain "why the score may still change", never as
//  performance facts.
// ══════════════════════════════════════════════════════════════

import { getAll, TTL } from '@/lib/db';
import { ORG_NODES_TABLE, type OrgNode } from '@/lib/organization';
import { buildOrgIndex, subtreeIds, type OrgIndex } from '@/lib/organization/graph';
import type { QualityObservation } from '@/types/quality-kpi';
import { roundTo2 } from '@/lib/kpi-framework/validation';
import {
  aggregateObservations,
  detectRepeatedIssues,
  detectWindowRecurrence,
  UNCLASSIFIED_KEY,
} from '@/lib/performance-intelligence/quality-analysis';
import { previousMonthKey } from './period-basis';
import { buildMonthlyKpiReport } from './monthly-report';
import type { KpiMonthlyTotals, KpiReportRow, KpiReportSchemeDisplay, KpiValueBasis } from './types';
import type { KpiReportingLoaders } from './loaders';
import { defaultKpiReportingLoaders } from './loaders';
import { isValidMonthKey } from '@/lib/month-utils';

// ─────────────────────────────────────────────────────────────
//  Vocabulary
// ─────────────────────────────────────────────────────────────

/** Severity vocabulary verbatim from the canonical observation type. */
export type InsightSeverity = QualityObservation['severity'];

/** Operational data sources surfaced in the compact data-quality table. */
export type InsightDataSource =
  | 'kpi'
  | 'quality'
  | 'followUps'
  | 'complaints'
  | 'capa'
  | 'attendance'
  | 'hrDeductions';

/**
 * Per-source availability. Business-facing states only — raw internal
 * dataset keys never leave the server (presentation translates them).
 */
export type InsightDataStatus = 'available' | 'no_data' | 'not_configured' | 'restricted';

/**
 * "Needs attention" — a DETERMINISTIC, documented rule over approved
 * quality events and the canonical change delta. It is a review
 * suggestion, never a verdict about the employee.
 */
export const INSIGHTS_ATTENTION_DELTA_POINTS = -5;
/** Team signal thresholds in percentage points (deterministic). */
export const INSIGHTS_TEAM_SIGNAL_DELTA_POINTS = 3;
/** Employees a repeated-category signal needs before it is a pattern. */
export const INSIGHTS_PATTERN_EMPLOYEE_COUNT = 2;

// ─────────────────────────────────────────────────────────────
//  Payload contracts
// ─────────────────────────────────────────────────────────────

export interface KpiInsightsSelection {
  /** Requested employee ids — intersected with the authorized scope. */
  employeeIds?: ReadonlyArray<string>;
  /** Requested org node ids (team/department) — subtree resolution. */
  orgNodeIds?: ReadonlyArray<string>;
}

export interface KpiInsightsFilters {
  /** Archived employees are excluded by default (canonical doctrine). */
  includeArchived?: boolean;
}

export interface EmployeeInsightFacts {
  observationsTotal: number;
  observationsApproved: number;
  observationsPending: number;
  observationsRejected: number;
  /** Approved observations with high/critical severity. */
  highCritical: number;
  /** Category groups with ≥ minOccurrences approved occurrences. */
  repeatedIssues: number;
  previousRawScore: number | null;
  /** current − previous raw score in points; null when either side is unavailable. */
  deltaPoints: number | null;
  needsAttention: boolean;
}

export interface UnitInsights {
  /** Canonical grouping label (the monthly report's team/department value). */
  key: string;
  label: string;
  employeeCount: number;
  employeeIds: string[];
  avgQuality: number | null;
  previousAvgQuality: number | null;
  /** avg(current) − avg(previous) over value-bearing results; null otherwise. */
  deltaPoints: number | null;
  observationsApproved: number;
  highCritical: number;
  repeatedIssues: number;
  improving: number;
  declining: number;
}

export interface CategoryInsight {
  /** Stable master-data key ('_unclassified' canonical fallback). */
  key: string;
  categoryId: string | null;
  /** Frozen Arabic snapshot from the observation record. */
  label: string;
  count: number;
  /** Share of approved observations (null when none). */
  pct: number | null;
  previousCount: number | null;
  affectedEmployeeIds: string[];
  affectedTeamLabels: string[];
}

export interface SeverityInsight {
  severity: InsightSeverity;
  count: number;
  pct: number | null;
  previousCount: number | null;
}

export interface RepeatedIssueInsight {
  key: string;
  categoryId: string | null;
  label: string;
  occurrenceCount: number;
  employeeCount: number;
  firstOccurrence: string | null;
  lastOccurrence: string | null;
  affectedEmployeeIds: string[];
  affectedTeamLabels: string[];
  observationIds: string[];
}

export interface WindowRecurrenceInsight {
  key: string;
  categoryId: string | null;
  label: string;
  occurrenceCount: number;
  monthsPresent: number;
  firstMonth: string | null;
  lastMonth: string | null;
  observationIds: string[];
}

export type InsightSignalKind =
  | 'TEAM_DECLINE'
  | 'TEAM_IMPROVE'
  | 'REPEATED_PATTERN'
  | 'HIGH_SEVERITY'
  | 'EMPLOYEE_DECLINE'
  | 'PENDING_APPROVALS';

export type InsightSignalLevel = 'critical' | 'warning' | 'info' | 'positive';

/**
 * A structured cross-domain signal. The UI renders it bilingually —
 * the server carries FACTS (ids, counts, deltas), never narrative.
 */
export interface InsightSignal {
  id: string;
  kind: InsightSignalKind;
  level: InsightSignalLevel;
  teamLabel?: string;
  categoryId?: string | null;
  categoryName?: string;
  employeeIds?: string[];
  count?: number;
  deltaPoints?: number;
  occurrenceCount?: number;
}

export interface ImprovementOpportunity {
  categoryId: string | null;
  key: string;
  label: string;
  occurrenceCount: number;
  employeeCount: number;
  teamCount: number;
  previousCount: number | null;
  /** (current − previous) / previous × 100 — null when previous is 0/missing. */
  changePct: number | null;
  affectedEmployeeIds: string[];
}

export interface DataQualityEntry {
  source: InsightDataSource;
  status: InsightDataStatus;
  /** Non-negative record count when available (context only). */
  count?: number;
}

export interface KpiInsightsReport {
  reportKind: 'INSIGHTS';
  monthKey: string;
  previousMonthKey: string;
  valueBasis: KpiValueBasis;
  finalized: boolean;
  closedAt: string | null;
  statisticsKind: 'QUALITY_KPI';
  selection: {
    isCompanyWide: boolean;
    employeeCount: number;
    teamLabels: string[];
    departmentLabels: string[];
  };
  scheme: KpiReportSchemeDisplay | null;
  overview: {
    avgQuality: number | null;
    previousAvgQuality: number | null;
    qualityDeltaPoints: number | null;
    observationsTotal: number;
    observationsApproved: number;
    observationsPending: number;
    observationsRejected: number;
    repeatedIssues: number;
    highCritical: number;
    needsAttention: number;
    counts: KpiMonthlyTotals;
  };
  rows: KpiReportRow[];
  employeeFacts: Record<string, EmployeeInsightFacts>;
  teamUnits: UnitInsights[];
  departmentUnits: UnitInsights[];
  categoryDistribution: CategoryInsight[];
  severityDistribution: SeverityInsight[];
  repeatedIssues: RepeatedIssueInsight[];
  windowRecurrence: WindowRecurrenceInsight[];
  signals: InsightSignal[];
  opportunities: ImprovementOpportunity[];
  dataQuality: DataQualityEntry[];
  vocab: {
    teams: Array<{ nodeId: string; label: string; employeeCount: number }>;
    departments: Array<{ nodeId: string; label: string; employeeCount: number }>;
  };
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  Loaders
// ─────────────────────────────────────────────────────────────

export interface KpiInsightsLoaders extends KpiReportingLoaders {
  /** Canonical Organization Tree (ONE cached read). */
  loadOrgNodes(): Promise<OrgNode[]>;
  /**
   * Population counts for the operational data sources (ONE cached
   * read per table). Availability metadata only — no domain rows are
   * serialized into the insights payload.
   */
  loadDomainAvailability(): Promise<Record<'followUps' | 'complaints' | 'capa' | 'attendance' | 'hrDeductions', number>>;
}

const AVAILABILITY_TABLES: ReadonlyArray<{
  source: 'followUps' | 'complaints' | 'capa' | 'attendance' | 'hrDeductions';
  table: string;
}> = [
  { source: 'followUps', table: 'followUps' },
  { source: 'complaints', table: 'complaints' },
  { source: 'capa', table: 'capaCases' },
  { source: 'attendance', table: 'attendanceResults' },
  { source: 'hrDeductions', table: 'hrDeductions' },
];

export const defaultKpiInsightsLoaders: KpiInsightsLoaders = {
  ...defaultKpiReportingLoaders,
  loadOrgNodes: async () => {
    const all = await getAll<OrgNode>(ORG_NODES_TABLE, TTL.MEDIUM);
    return all.filter((n) => n && typeof n.id === 'string');
  },
  loadDomainAvailability: async () => {
    const out: Record<'followUps' | 'complaints' | 'capa' | 'attendance' | 'hrDeductions', number> = {
      followUps: 0,
      complaints: 0,
      capa: 0,
      attendance: 0,
      hrDeductions: 0,
    };
    await Promise.all(
      AVAILABILITY_TABLES.map(async ({ source, table }) => {
        try {
          const rows = await getAll<Record<string, unknown>>(table, TTL.MEDIUM);
          out[source] = Array.isArray(rows) ? rows.length : 0;
        } catch {
          // A missing/unreadable source is a data-quality FACT, not a
          // report failure — it renders as "not available".
          out[source] = 0;
        }
      }),
    );
    return out;
  },
};

// ─────────────────────────────────────────────────────────────
//  Builder input
// ─────────────────────────────────────────────────────────────

export interface BuildKpiInsightsInput {
  monthKey: string;
  /**
   * AUTHORIZED employee set (the caller's employees-scope). null =
   * unrestricted. Always resolved by the ROUTE from the scope engine
   * — never from client input.
   */
  scopeLimit?: ReadonlyArray<string> | null;
  selection?: KpiInsightsSelection;
  filters?: KpiInsightsFilters;
  /** Repeated-issue threshold — canonical default (2). */
  minOccurrences?: number;
  now?: Date;
  loaders?: KpiInsightsLoaders;
}

// ─────────────────────────────────────────────────────────────
//  Pure helpers
// ─────────────────────────────────────────────────────────────

function average(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  return roundTo2(values.reduce((a, b) => a + b, 0) / values.length);
}

function isValueBearing(row: KpiReportRow): boolean {
  return row.quality !== null && row.quality.rawScore !== null;
}

function pctOf(count: number, total: number): number | null {
  if (total <= 0) return null;
  return roundTo2((count / total) * 100);
}

/**
 * Percentage-point change vs previous period; null (never 0) when
 * either side is missing — missing data is not a decline.
 */
function deltaOrNull(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return roundTo2(current - previous);
}

function groupObservationsByEmployee(
  observations: ReadonlyArray<QualityObservation>,
): Map<string, QualityObservation[]> {
  const map = new Map<string, QualityObservation[]>();
  for (const obs of observations) {
    const list = map.get(obs.employeeId) ?? [];
    list.push(obs);
    map.set(obs.employeeId, list);
  }
  return map;
}

/** Employees whose current org node lies inside ANY of the nodes' subtrees. */
function employeeIdsInOrgSubtrees(
  index: OrgIndex,
  orgNodeIds: ReadonlyArray<string>,
  employees: ReadonlyArray<{ id: string; orgNodeId: string | null }>,
): Set<string> {
  const nodeIds = new Set<string>();
  for (const nodeId of orgNodeIds) {
    for (const id of subtreeIds(index, nodeId)) nodeIds.add(id);
  }
  const out = new Set<string>();
  for (const employee of employees) {
    if (employee.orgNodeId && nodeIds.has(employee.orgNodeId)) out.add(employee.id);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
//  Builder
// ─────────────────────────────────────────────────────────────

/**
 * Build the KPI insights workspace payload for one month. Throws ONLY
 * for caller bugs (invalid month key) — every business outcome is
 * explicit data (statuses, nulls, empty lists).
 */
export async function buildKpiInsightsReport(
  input: BuildKpiInsightsInput,
): Promise<KpiInsightsReport> {
  if (!isValidMonthKey(input.monthKey)) {
    throw new Error(`invalid month key: ${String(input.monthKey)}`);
  }
  const loaders = input.loaders ?? defaultKpiInsightsLoaders;
  const now = input.now ?? new Date();
  const monthKey = input.monthKey;
  const prevMonthKey = previousMonthKey(monthKey);
  const minOccurrences = input.minOccurrences ?? 2;
  const includeArchived = input.filters?.includeArchived === true;

  // ── Resolve the EFFECTIVE employee set: authorized ∩ requested ──
  // The requested selection (employees / org subtrees) may only
  // NARROW the authorized set — out-of-scope ids drop silently (the
  // UI only ever offers in-scope options; narrowing is enforcement).
  const [orgNodes, allEmployees] = await Promise.all([
    loaders.loadOrgNodes(),
    loaders.loadEmployees(),
  ]);
  const orgIndex = buildOrgIndex(orgNodes);

  const requested = new Set<string>();
  let hasRequestedSelection = false;
  for (const id of input.selection?.employeeIds ?? []) {
    if (typeof id === 'string' && id.length > 0) {
      requested.add(id);
      hasRequestedSelection = true;
    }
  }
  const orgNodeIds = (input.selection?.orgNodeIds ?? []).filter(
    (id) => typeof id === 'string' && id.length > 0,
  );
  if (orgNodeIds.length > 0) {
    hasRequestedSelection = true;
    for (const id of employeeIdsInOrgSubtrees(orgIndex, orgNodeIds, allEmployees)) {
      requested.add(id);
    }
  }

  let effectiveLimit: ReadonlyArray<string> | null;
  if (hasRequestedSelection) {
    if (input.scopeLimit) {
      const authorized = new Set(input.scopeLimit);
      effectiveLimit = [...requested].filter((id) => authorized.has(id));
    } else {
      effectiveLimit = [...requested];
    }
  } else {
    effectiveLimit = input.scopeLimit ?? null;
  }

  const inScope = (employeeId: string): boolean =>
    effectiveLimit === null || effectiveLimit.includes(employeeId);

  // ── Canonical monthly assemblies (current + previous) ──
  const [current, previous] = await Promise.all([
    buildMonthlyKpiReport({
      monthKey,
      reportKind: 'MONTHLY',
      filters: { includeArchived, scopeLimit: effectiveLimit },
      now,
      loaders,
    }),
    buildMonthlyKpiReport({
      monthKey: prevMonthKey,
      reportKind: 'MONTHLY',
      filters: { includeArchived, scopeLimit: effectiveLimit },
      now,
      loaders,
    }),
  ]);

  const previousByEmployee = new Map(previous.rows.map((r) => [r.employeeId, r]));

  // ── Observations (canonical quality input) ──
  const [monthObsAll, prevObsAll] = await Promise.all([
    loaders.loadObservations(monthKey),
    loaders.loadObservations(prevMonthKey),
  ]);
  const monthObs = monthObsAll.filter((o) => o && typeof o.employeeId === 'string' && inScope(o.employeeId));
  const prevObs = prevObsAll.filter((o) => o && typeof o.employeeId === 'string' && inScope(o.employeeId));
  const approvedCurrent = monthObs.filter((o) => o.approvalStatus === 'approved');
  const approvedPrevious = prevObs.filter((o) => o.approvalStatus === 'approved');

  // Team labels from CURRENT org assignment (canonical loader — the
  // same source the monthly rows use).
  const teamNames = await loaders.loadTeamNames();
  const teamLabelOf = (employeeId: string): string | null => teamNames.get(employeeId) ?? null;

  const observationsByEmployee = groupObservationsByEmployee(monthObs);
  const approvedByEmployee = groupObservationsByEmployee(approvedCurrent);

  // ── Distributions over APPROVED observations (canonical engine) ──
  const analysis = aggregateObservations({
    observations: approvedCurrent,
    windowObservations: approvedCurrent,
    windowMonths: [monthKey],
  });
  const approvedTotal = analysis.total;

  // Previous-period counts per category / severity (same approved rule).
  const prevCategoryCounts = new Map<string, number>();
  for (const obs of approvedPrevious) {
    const key = obs.categoryId ?? UNCLASSIFIED_KEY;
    prevCategoryCounts.set(key, (prevCategoryCounts.get(key) ?? 0) + 1);
  }
  const prevSeverityCounts = new Map<string, number>();
  for (const obs of approvedPrevious) {
    prevSeverityCounts.set(obs.severity, (prevSeverityCounts.get(obs.severity) ?? 0) + 1);
  }

  const categoryDistribution: CategoryInsight[] = analysis.byCategory.map((entry) => {
    const affectedEmployeeIds = [
      ...new Set(
        approvedCurrent
          .filter((o) => (o.categoryId ?? UNCLASSIFIED_KEY) === (entry.categoryId ?? UNCLASSIFIED_KEY))
          .map((o) => o.employeeId),
      ),
    ];
    const affectedTeamLabels = [
      ...new Set(affectedEmployeeIds.map(teamLabelOf).filter((t): t is string => !!t)),
    ];
    const prevCount = prevCategoryCounts.get(entry.categoryId ?? UNCLASSIFIED_KEY) ?? 0;
    return {
      key: entry.categoryId ?? UNCLASSIFIED_KEY,
      categoryId: entry.categoryId,
      label: entry.categoryName,
      count: entry.count,
      pct: pctOf(entry.count, approvedTotal),
      previousCount: approvedPrevious.length > 0 ? prevCount : null,
      affectedEmployeeIds,
      affectedTeamLabels,
    };
  });

  const severityDistribution: SeverityInsight[] = (
    ['critical', 'high', 'medium', 'low'] as const
  ).map((severity) => {
    const count = analysis.bySeverity[severity] ?? 0;
    return {
      severity,
      count,
      pct: pctOf(count, approvedTotal),
      previousCount: approvedPrevious.length > 0 ? prevSeverityCounts.get(severity) ?? 0 : null,
    };
  });

  // ── Repeated issues (canonical deterministic detection) ──
  const repetition = detectRepeatedIssues({ observations: approvedCurrent, minOccurrences });
  const obsById = new Map(monthObs.map((o) => [o.id, o] as const));
  const repeatedIssues: RepeatedIssueInsight[] = repetition.byCategory.map((group) => {
    const affectedEmployeeIds = [
      ...new Set(
        group.observationIds
          .map((id) => obsById.get(id)?.employeeId)
          .filter((id): id is string => !!id),
      ),
    ];
    return {
      key: group.issueKey,
      categoryId: group.issueKey === UNCLASSIFIED_KEY ? null : group.issueKey,
      label: group.label,
      occurrenceCount: group.occurrenceCount,
      employeeCount: affectedEmployeeIds.length,
      firstOccurrence: group.firstOccurrence,
      lastOccurrence: group.lastOccurrence,
      affectedEmployeeIds,
      affectedTeamLabels: [
        ...new Set(affectedEmployeeIds.map(teamLabelOf).filter((t): t is string => !!t)),
      ],
      observationIds: group.observationIds,
    };
  });

  const windowObs = [...approvedPrevious, ...approvedCurrent];
  const windowRecurrence: WindowRecurrenceInsight[] = detectWindowRecurrence({
    observations: windowObs,
    windowMonths: [prevMonthKey, monthKey],
    minOccurrences,
  }).map((group) => ({
    key: group.issueKey,
    categoryId: group.issueKey === UNCLASSIFIED_KEY ? null : group.issueKey,
    label: group.label,
    occurrenceCount: group.occurrenceCount,
    monthsPresent: group.monthsPresent,
    firstMonth: group.firstMonth,
    lastMonth: group.lastMonth,
    observationIds: group.observationIds,
  }));

  // ── Per-employee facts ──
  const employeeFacts: Record<string, EmployeeInsightFacts> = {};
  for (const row of current.rows) {
    const obs = observationsByEmployee.get(row.employeeId) ?? [];
    const approved = approvedByEmployee.get(row.employeeId) ?? [];
    const prevRow = previousByEmployee.get(row.employeeId);
    const rawScore = row.quality?.rawScore ?? null;
    const prevRawScore = prevRow && isValueBearing(prevRow) ? prevRow.quality!.rawScore : null;
    const repeated = detectRepeatedIssues({ observations: approved, minOccurrences });
    const highCritical = approved.filter((o) => o.severity === 'high' || o.severity === 'critical').length;
    const deltaPoints = deltaOrNull(rawScore, prevRawScore);
    employeeFacts[row.employeeId] = {
      observationsTotal: obs.length,
      observationsApproved: approved.length,
      observationsPending: obs.filter((o) => o.approvalStatus === 'pending').length,
      observationsRejected: obs.filter((o) => o.approvalStatus === 'rejected').length,
      highCritical,
      repeatedIssues: repeated.byCategory.length,
      previousRawScore: prevRawScore,
      deltaPoints,
      needsAttention:
        highCritical > 0 ||
        repeated.byCategory.length > 0 ||
        (deltaPoints !== null && deltaPoints <= INSIGHTS_ATTENTION_DELTA_POINTS),
    };
  }

  // ── Unit aggregation (teams / departments as operating units) ──
  const buildUnits = (
    keyOf: (row: KpiReportRow) => string | null,
  ): UnitInsights[] => {
    const groups = new Map<string, KpiReportRow[]>();
    for (const row of current.rows) {
      const key = keyOf(row);
      if (key === null) continue; // ungrouped employees are skipped, never fabricated
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    const units: UnitInsights[] = [];
    for (const [key, rows] of groups) {
      const employeeIds = rows.map((r) => r.employeeId);
      const idSet = new Set(employeeIds);
      const unitApproved = approvedCurrent.filter((o) => idSet.has(o.employeeId));
      const prevRows = employeeIds
        .map((id) => previousByEmployee.get(id))
        .filter((r): r is KpiReportRow => !!r && isValueBearing(r));
      const avgQuality = average(rows.filter(isValueBearing).map((r) => r.quality!.rawScore!));
      const prevAvg = average(prevRows.map((r) => r.quality!.rawScore!));
      let improving = 0;
      let declining = 0;
      for (const id of employeeIds) {
        const delta = employeeFacts[id]?.deltaPoints ?? null;
        if (delta === null) continue;
        if (delta > 0) improving += 1;
        else if (delta < 0) declining += 1;
      }
      units.push({
        key,
        label: key,
        employeeCount: rows.length,
        employeeIds,
        avgQuality,
        previousAvgQuality: prevAvg,
        deltaPoints: deltaOrNull(avgQuality, prevAvg),
        observationsApproved: unitApproved.length,
        highCritical: unitApproved.filter((o) => o.severity === 'high' || o.severity === 'critical').length,
        // Canonical repeated-issue detection applied to the unit's own
        // approved observations (no separate grouping logic).
        repeatedIssues: detectRepeatedIssues({ observations: unitApproved, minOccurrences }).byCategory.length,
        improving,
        declining,
      });
    }
    return units.sort(
      (a, b) => b.employeeCount - a.employeeCount || a.label.localeCompare(b.label, 'ar'),
    );
  };

  const teamUnits = buildUnits((r) => r.team);
  const departmentUnits = buildUnits((r) => r.department);

  // ── Cross-domain signals (structured facts — the UI narrates) ──
  const signals: InsightSignal[] = [];
  for (const unit of [...teamUnits]
    .filter((u) => u.deltaPoints !== null && u.deltaPoints <= -INSIGHTS_TEAM_SIGNAL_DELTA_POINTS)
    .sort((a, b) => (a.deltaPoints ?? 0) - (b.deltaPoints ?? 0))
    .slice(0, 3)) {
    signals.push({
      id: `team-decline:${unit.key}`,
      kind: 'TEAM_DECLINE',
      level: 'warning',
      teamLabel: unit.label,
      deltaPoints: unit.deltaPoints!,
      employeeIds: unit.employeeIds,
    });
  }
  for (const unit of [...teamUnits]
    .filter((u) => u.deltaPoints !== null && u.deltaPoints >= INSIGHTS_TEAM_SIGNAL_DELTA_POINTS)
    .sort((a, b) => (b.deltaPoints ?? 0) - (a.deltaPoints ?? 0))
    .slice(0, 3)) {
    signals.push({
      id: `team-improve:${unit.key}`,
      kind: 'TEAM_IMPROVE',
      level: 'positive',
      teamLabel: unit.label,
      deltaPoints: unit.deltaPoints!,
      employeeIds: unit.employeeIds,
    });
  }
  for (const group of repeatedIssues
    .filter((g) => g.employeeCount >= INSIGHTS_PATTERN_EMPLOYEE_COUNT)
    .slice(0, 2)) {
    signals.push({
      id: `repeated-pattern:${group.key}`,
      kind: 'REPEATED_PATTERN',
      level: 'warning',
      categoryId: group.categoryId,
      categoryName: group.label,
      occurrenceCount: group.occurrenceCount,
      employeeIds: group.affectedEmployeeIds,
    });
  }
  const highCriticalEmployees = [
    ...new Set(
      approvedCurrent
        .filter((o) => o.severity === 'high' || o.severity === 'critical')
        .map((o) => o.employeeId),
    ),
  ];
  if (highCriticalEmployees.length > 0) {
    signals.push({
      id: 'high-severity',
      kind: 'HIGH_SEVERITY',
      level: 'critical',
      count: highCriticalEmployees.length,
      employeeIds: highCriticalEmployees.slice(0, 5),
    });
  }
  const pendingCount = monthObs.filter((o) => o.approvalStatus === 'pending').length;
  if (pendingCount > 0) {
    signals.push({
      id: 'pending-approvals',
      kind: 'PENDING_APPROVALS',
      level: 'info',
      count: pendingCount,
    });
  }
  for (const fact of Object.entries(employeeFacts)
    .filter(([, f]) => f.deltaPoints !== null && f.deltaPoints <= INSIGHTS_ATTENTION_DELTA_POINTS)
    .sort((a, b) => (a[1].deltaPoints ?? 0) - (b[1].deltaPoints ?? 0))
    .slice(0, 3)) {
    signals.push({
      id: `employee-decline:${fact[0]}`,
      kind: 'EMPLOYEE_DECLINE',
      level: 'warning',
      employeeIds: [fact[0]],
      deltaPoints: fact[1].deltaPoints!,
    });
  }
  const levelRank: Record<InsightSignalLevel, number> = { critical: 0, warning: 1, info: 2, positive: 3 };
  signals.sort(
    (a, b) => levelRank[a.level] - levelRank[b.level] || a.id.localeCompare(b.id),
  );

  // ── Operational improvement opportunities ──
  const opportunities: ImprovementOpportunity[] = categoryDistribution
    .filter((c) => c.count >= minOccurrences || c.affectedEmployeeIds.length >= 2)
    .slice(0, 6)
    .map((c) => ({
      categoryId: c.categoryId,
      key: c.key,
      label: c.label,
      occurrenceCount: c.count,
      employeeCount: c.affectedEmployeeIds.length,
      teamCount: c.affectedTeamLabels.length,
      previousCount: c.previousCount,
      changePct:
        c.previousCount === null || c.previousCount === 0
          ? null
          : roundTo2(((c.count - c.previousCount) / c.previousCount) * 100),
      affectedEmployeeIds: c.affectedEmployeeIds,
    }));

  // ── Data quality (compact, end-of-report) ──
  const domainAvailability = await loaders.loadDomainAvailability();
  const dataQuality: DataQualityEntry[] = [
    {
      source: 'kpi',
      status: current.scheme ? 'available' : current.rows.length > 0 ? 'not_configured' : 'no_data',
    },
    { source: 'quality', status: monthObs.length > 0 ? 'available' : 'no_data', count: monthObs.length },
    { source: 'followUps', status: domainAvailability.followUps > 0 ? 'available' : 'no_data', count: domainAvailability.followUps },
    { source: 'complaints', status: domainAvailability.complaints > 0 ? 'available' : 'no_data', count: domainAvailability.complaints },
    { source: 'capa', status: domainAvailability.capa > 0 ? 'available' : 'no_data', count: domainAvailability.capa },
    { source: 'attendance', status: domainAvailability.attendance > 0 ? 'available' : 'no_data', count: domainAvailability.attendance },
    { source: 'hrDeductions', status: domainAvailability.hrDeductions > 0 ? 'available' : 'no_data', count: domainAvailability.hrDeductions },
  ];

  // ── Scope vocabulary (canonical org nodes with in-scope employees) ──
  const scopeBase = input.scopeLimit
    ? allEmployees.filter((e) => input.scopeLimit!.includes(e.id))
    : allEmployees;
  const vocabEntry = (node: OrgNode): { nodeId: string; label: string; employeeCount: number } | null => {
    if (node.status === 'archived') return null;
    const subtree = subtreeIds(orgIndex, node.id);
    const count = scopeBase.filter((e) => e.orgNodeId && subtree.has(e.orgNodeId)).length;
    if (count === 0) return null;
    return { nodeId: node.id, label: node.name, employeeCount: count };
  };
  const vocab = {
    teams: orgNodes
      .filter((n) => n.type === 'team' || n.type === 'subteam')
      .map(vocabEntry)
      .filter((v): v is { nodeId: string; label: string; employeeCount: number } => v !== null)
      .sort((a, b) => b.employeeCount - a.employeeCount || a.label.localeCompare(b.label, 'ar')),
    departments: orgNodes
      .filter((n) => n.type === 'department')
      .map(vocabEntry)
      .filter((v): v is { nodeId: string; label: string; employeeCount: number } => v !== null)
      .sort((a, b) => b.employeeCount - a.employeeCount || a.label.localeCompare(b.label, 'ar')),
  };

  // ── Overview ──
  const valueRows = current.rows.filter(isValueBearing);
  const avgQuality = average(valueRows.map((r) => r.quality!.rawScore!));
  const prevAvgQuality = average(
    current.rows
      .filter(isValueBearing)
      .map((r) => previousByEmployee.get(r.employeeId))
      .filter((r): r is KpiReportRow => !!r && isValueBearing(r))
      .map((r) => r.quality!.rawScore!),
  );
  const needsAttention = Object.values(employeeFacts).filter((f) => f.needsAttention).length;

  return {
    reportKind: 'INSIGHTS',
    monthKey,
    previousMonthKey: prevMonthKey,
    valueBasis: current.valueBasis,
    finalized: current.finalized,
    closedAt: current.closedAt,
    statisticsKind: 'QUALITY_KPI',
    selection: {
      isCompanyWide: !hasRequestedSelection,
      employeeCount: current.rows.length,
      teamLabels: [...new Set(current.rows.map((r) => r.team).filter((t): t is string => !!t))],
      departmentLabels: [
        ...new Set(current.rows.map((r) => r.department).filter((d): d is string => !!d)),
      ],
    },
    scheme: current.scheme,
    overview: {
      avgQuality,
      previousAvgQuality: prevAvgQuality,
      qualityDeltaPoints: deltaOrNull(avgQuality, prevAvgQuality),
      observationsTotal: monthObs.length,
      observationsApproved: approvedCurrent.length,
      observationsPending: pendingCount,
      observationsRejected: monthObs.filter((o) => o.approvalStatus === 'rejected').length,
      repeatedIssues: repeatedIssues.length,
      highCritical: approvedCurrent.filter(
        (o) => o.severity === 'high' || o.severity === 'critical',
      ).length,
      needsAttention,
      counts: current.totals,
    },
    rows: current.rows,
    employeeFacts,
    teamUnits,
    departmentUnits,
    categoryDistribution,
    severityDistribution,
    repeatedIssues,
    windowRecurrence,
    signals: signals.slice(0, 8),
    opportunities,
    dataQuality,
    vocab,
    generatedAt: now.toISOString(),
  };
}
