// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — GROUP REPORT (§GROUP-REPORTING)
//
//  Custom multi-person selection & reporting over the CANONICAL
//  single-employee hub datasets. This module is a shared AGGREGATION
//  layer only — it never recalculates a business metric:
//
//    member dataset → getEmployeePerformanceHubDataset (the existing
//                     Phase-3 service: canonical KPI/quality/follow-up/
//                     booking/deals/complaints/CAPA/attendance facts +
//                     deterministic analysis + gated risk/HR blocks)
//    population     → Organization-Tree resolution (subtrees of the
//                     requested nodes) ∪ explicit employee ids,
//                     deduplicated by Set, intersected with the
//                     AUTHORIZED employee scope (a selection can only
//                     narrow it, never widen), deterministic order,
//                     hard member cap with explicit truncation.
//
//  §CUSTOM-SELECTION: an arbitrary mixed selection (employees from
//  different teams/companies, whole teams, departments, managers'
//  subtrees) is DISTINCT from actual organizational membership —
//  every member row carries its REAL org context (team / department /
//  company / manager resolved from the org tree), and the comparison
//  groups BY that real membership, never by the selection itself.
//
//  Manager analysis (§MANAGER-ANALYSIS) groups members by their
//  resolved manager (the nearest team ancestor's managerUserName) —
//  an arbitrary selection never masquerades as a managed team.
//
//  READ-ONLY, fully serializable (React Query / print safe).
// ══════════════════════════════════════════════════════════════

import { previousMonthKey, defaultKpiReportingLoaders } from '@/lib/kpi-reporting';
import { isValidMonthKey } from '@/lib/month-utils';
import {
  buildOrgIndex,
  employeeIdsInSubtree,
  findAncestorOfType,
  groupEmployeesByNode,
  subtreeIds,
  type OrgIndex,
} from '@/lib/organization/graph';
import type { OrgEmployeeRef } from '@/lib/organization/types';
import { findAncestorAtLevel } from '@/lib/organization/levels';
import { roundTo2 } from '@/lib/kpi-framework/validation';
import type { OrgNode } from '@/lib/organization';
import { defaultPerformanceIntelligenceLoaders } from '@/lib/performance-intelligence';
import { loadHrDeductionLookup } from '@/lib/hr-deductions/lookup';
import type { HrDeductionLookup } from '@/lib/hr-deductions/lookup';
import { createRequestScopedHubLoaders } from './scoped-loaders';
import { getEmployeePerformanceHubDataset } from './service';
import type {
  EmployeePerformanceHubDataset,
  HubDimensionKey,
  HubDimensionStatus,
  HubOverviewStatus,
} from './types';

/** Hard member cap — group reports are bounded (the UI states the cap). */
export const GROUP_REPORT_MAX_MEMBERS = 50;
/** Max requested ids per kind (route-level guard mirrors insights). */
export const GROUP_SELECTION_MAX_IDS = 100;
/**
 * §GROUP-REPORTING — bounded per-member dataset-build concurrency.
 * The previous unbounded Promise.all launched up to 50 concurrent
 * canonical engine runs (each fanning into several collection reads)
 * in ONE event-loop turn. 8 keeps every worker busy while bounding
 * peak memory/connection pressure; output ordering is index-based
 * and therefore unchanged.
 */
export const GROUP_BUILD_CONCURRENCY = 8;

// ─────────────────────────────────────────────────────────────
//  Selection & input
// ─────────────────────────────────────────────────────────────

/** §CUSTOM-SELECTION — arbitrary mix of employees + org subtrees. */
export interface PerformanceGroupSelection {
  /** Explicit employee ids (any team/company — validated in scope). */
  employeeIds: ReadonlyArray<string>;
  /** Org node ids (team/department/company subtrees — canonical tree). */
  orgNodeIds: ReadonlyArray<string>;
}

export interface BuildPerformanceGroupReportInput {
  monthKey: string;
  selection: PerformanceGroupSelection;
  /**
   * AUTHORIZED employee set (caller's employees-scope, resolved by the
   * ROUTE). null = unrestricted. Never from client input.
   */
  scopeLimit?: ReadonlyArray<string> | null;
  /** Include the previous-period comparison per member. */
  compare?: boolean;
  /** Risk section granted (route-resolved employee360 gate). */
  riskEnabled?: boolean;
  /** HR-deductions section granted (route-resolved). */
  hrAuthorized?: boolean;
  /** Member cap (default GROUP_REPORT_MAX_MEMBERS). */
  limit?: number;
  now?: Date;
}

// ─────────────────────────────────────────────────────────────
//  Output contract
// ─────────────────────────────────────────────────────────────

export interface GroupMemberSummary {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  /** REAL organizational context from the org tree (never the selection). */
  team: string | null;
  department: string | null;
  company: string | null;
  manager: string | null;
  employmentStatus: string;
  /** §8 overview verdict of the member's canonical hub analysis. */
  overviewStatus: HubOverviewStatus;
  /** Dimension statuses by key (NOT_MEASURABLE/INSUFFICIENT_DATA included). */
  dimensionStatuses: Partial<Record<HubDimensionKey, HubDimensionStatus>>;
  /** Headline metric values (null = not measurable for that member). */
  qualityPercent: number | null;
  bookingCompletion: number | null;
  employeeActionFollowUpCompletion: number | null;
  attendanceCompliance: number | null;
  closedDeals: number | null;
  riskScore: number | null;
  riskLevel: string | null;
  /** Members with data coverage (≥1 value-bearing dimension). */
  hasData: boolean;
}

export interface GroupDimensionRollup {
  key: HubDimensionKey;
  /** Members whose dimension is NOT_MEASURABLE (no source in the model). */
  notMeasurableCount: number;
  insufficientDataCount: number;
  statusCounts: Record<Exclude<HubDimensionStatus, 'NOT_MEASURABLE' | 'INSUFFICIENT_DATA'>, number>;
  /** Mean headline value over members WITH a value (null when none). */
  averageValue: number | null;
  membersWithValue: number;
}

export interface GroupRepeatedProblem {
  /** Stored category label (dynamic-labels resolves bilingually). */
  label: string;
  occurrenceCount: number;
  /** Members carrying the same repeated issue. */
  memberCount: number;
}

export interface GroupTrendEntry {
  employeeId: string;
  employeeName: string;
  key: string;
  direction: 'UP' | 'DOWN';
  delta: number | null;
  unit: string;
}

export interface GroupAttentionEntry {
  employeeId: string;
  employeeName: string;
  overviewStatus: HubOverviewStatus;
  /** Dimension keys needing attention / declining. */
  needsAttention: HubDimensionKey[];
  declining: HubDimensionKey[];
  reasons: string[];
}

export interface GroupUnitComparison {
  /** Grouping key (e.g. `team:<name>`). */
  unitKey: string;
  unitType: 'team' | 'department' | 'company' | 'manager';
  label: string;
  memberCount: number;
  membersWithValue: number;
  avgQuality: number | null;
  avgBookingCompletion: number | null;
  avgActionFollowUpCompletion: number | null;
  avgAttendance: number | null;
  closedDealsTotal: number;
  attentionCount: number;
}

export interface GroupManagerAnalysis {
  manager: string;
  memberCount: number;
  overviewDistribution: Record<string, number>;
  needsIntervention: string[];
  decliningDimensionCounts: Partial<Record<HubDimensionKey, number>>;
}

export interface PerformanceGroupReport {
  datasetKind: 'EMPLOYEE_PERFORMANCE_GROUP_REPORT';
  period: {
    monthKey: string;
    previousMonthKey: string | null;
    compared: boolean;
  };
  population: {
    requestedEmployeeIds: string[];
    requestedOrgNodeIds: string[];
    /** ids dropped by the authorized scope (fail-closed, surfaced). */
    outOfScopeEmployeeIds: string[];
    outOfScopeOrgNodeIds: string[];
    resolvedCount: number;
    /** After dedup — the Set union of explicit ids + subtree members. */
    deduplicatedCount: number;
    truncated: boolean;
    limit: number;
    members: GroupMemberSummary[];
    /** Members whose dataset could not be built (explicitly surfaced). */
    failedEmployeeIds: string[];
  };
  coverage: {
    membersWithData: number;
    membersWithoutData: number;
    dataCompletenessPercent: number | null;
  };
  overviewDistribution: Record<HubOverviewStatus, number>;
  dimensionRollups: GroupDimensionRollup[];
  sharedStrengths: Array<{ key: string; memberCount: number }>;
  commonWeaknesses: Array<{ key: string; memberCount: number }>;
  repeatedProblems: GroupRepeatedProblem[];
  riskDistribution: Record<string, number>;
  improving: GroupTrendEntry[];
  deteriorating: GroupTrendEntry[];
  attentionList: GroupAttentionEntry[];
  comparison: {
    units: GroupUnitComparison[];
  } | null;
  managerAnalysis: GroupManagerAnalysis[] | null;
  dataQualityNotes: string[];
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  Pure helpers
// ─────────────────────────────────────────────────────────────

const EMPTY_STATUS_COUNTS: Record<Exclude<HubDimensionStatus, 'NOT_MEASURABLE' | 'INSUFFICIENT_DATA'>, number> = {
  STRONG: 0,
  STABLE: 0,
  IMPROVING: 0,
  NEEDS_ATTENTION: 0,
  DECLINING: 0,
};

const OVERVIEW_STATUSES: HubOverviewStatus[] = [
  'IMPROVING',
  'STABLE',
  'NEEDS_COACHING',
  'PERFORMANCE_IMPROVEMENT_REVIEW',
  'MANAGEMENT_REVIEW',
  'INSUFFICIENT_DATA',
];

function emptyOverviewDistribution(): Record<HubOverviewStatus, number> {
  return OVERVIEW_STATUSES.reduce((acc, s) => {
    acc[s] = 0;
    return acc;
  }, {} as Record<HubOverviewStatus, number>);
}

function averageOf(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  return roundTo2(values.reduce((a, b) => a + b, 0) / values.length);
}

function dimensionValueOf(dataset: EmployeePerformanceHubDataset, key: HubDimensionKey): number | null {
  const dim = dataset.dimensions.find((d) => d.key === key);
  return dim?.value ?? null;
}

function dimensionStatusOf(dataset: EmployeePerformanceHubDataset, key: HubDimensionKey): HubDimensionStatus | undefined {
  return dataset.dimensions.find((d) => d.key === key)?.status;
}

/** Dimension keys the rollup presents (fixed order). */
const ROLLUP_KEYS: HubDimensionKey[] = [
  'quality',
  'bookingExecution',
  'employeeActionFollowUp',
  'attendance',
  'businessOutput',
  'risk',
  'complaints',
  'capa',
  'hr',
];

function orgContextOf(
  index: OrgIndex,
  orgNodeId: string | null,
): { team: string | null; department: string | null; company: string | null; manager: string | null } {
  if (!orgNodeId) return { team: null, department: null, company: null, manager: null };
  const teamNode = findAncestorOfType(index, orgNodeId, 'team');
  const departmentNode = findAncestorOfType(index, orgNodeId, 'department');
  const companyNode = findAncestorAtLevel(index, orgNodeId, 'company');
  const managerNode = teamNode ?? departmentNode ?? companyNode;
  return {
    team: teamNode?.name ?? null,
    department: departmentNode?.name ?? null,
    company: companyNode?.name ?? null,
    manager: managerNode?.managerUserName ?? null,
  };
}

/** Counter for strength/concern rule ids across members. */
function countKeys(
  map: Map<string, number>,
  datasets: ReadonlyArray<EmployeePerformanceHubDataset>,
  pick: (dataset: EmployeePerformanceHubDataset) => string[],
): void {
  for (const dataset of datasets) {
    for (const key of pick(dataset)) {
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
}

function toCountedList(map: Map<string, number>): Array<{ key: string; memberCount: number }> {
  return [...map.entries()]
    .map(([key, memberCount]) => ({ key, memberCount }))
    .sort((a, b) => b.memberCount - a.memberCount || a.key.localeCompare(b.key));
}

/**
 * Bounded-concurrency map that NEVER reorders: results land at the
 * producer's index. Individual failures are captured per item
 * (PromiseSettledResult) — the caller decides how partial failure is
 * surfaced; no unbounded Promise.all over member-sized datasets.
 */
async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await run(items[index]!, index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

// ─────────────────────────────────────────────────────────────
//  Builder
// ─────────────────────────────────────────────────────────────

export async function buildPerformanceGroupReport(
  input: BuildPerformanceGroupReportInput,
): Promise<PerformanceGroupReport> {
  if (!isValidMonthKey(input.monthKey)) {
    throw new Error(`invalid month key: ${String(input.monthKey)}`);
  }
  const now = input.now ?? new Date();
  const compare = input.compare ?? true;
  const limit = Math.max(1, Math.min(input.limit ?? GROUP_REPORT_MAX_MEMBERS, GROUP_REPORT_MAX_MEMBERS));
  const loaders = defaultPerformanceIntelligenceLoaders;

  // ── Population resolution (canonical org tree + authorized scope) ──
  const [employees, orgNodes] = await Promise.all([
    defaultKpiReportingLoaders.loadEmployees(),
    loaders.loadOrgNodes(),
  ]);
  const orgIndex = buildOrgIndex(orgNodes as unknown as OrgNode[]);

  const scopeLimit = input.scopeLimit ?? null;
  const scopeSet = scopeLimit === null ? null : new Set(scopeLimit);

  const outOfScopeEmployeeIds: string[] = [];
  const employeeIdSet = new Set<string>();
  for (const id of input.selection.employeeIds) {
    if (scopeSet && !scopeSet.has(id)) {
      outOfScopeEmployeeIds.push(id);
      continue;
    }
    employeeIdSet.add(id);
  }

  const outOfScopeOrgNodeIds: string[] = [];
  const subtreeMemberIds = new Set<string>();
  // §SUBTREE-RESOLUTION — the employees INSIDE each requested subtree
  // come from the CANONICAL per-node employee grouping
  // (employeeIdsInSubtree over groupEmployeesByNode), the same
  // primitives the scope engine uses. (The previous
  // `subtreeIds(...).filter(id => employeeById.has(id))` filtered ORG
  // NODE ids against EMPLOYEE ids — an always-empty set — so every
  // org-node selection silently resolved zero members and out-of-
  // scope nodes were never flagged.)
  const employeesByNode = groupEmployeesByNode(employees as unknown as OrgEmployeeRef[]);
  for (const nodeId of input.selection.orgNodeIds) {
    const node = orgIndex.byId.get(nodeId);
    if (!node) {
      outOfScopeOrgNodeIds.push(nodeId); // unknown node — never silently ignored
      continue;
    }
    // Subtree members that actually exist as employees.
    const subtreeEmployeeIds = employeeIdsInSubtree(orgIndex, nodeId, employeesByNode);
    if (scopeSet) {
      // A node is usable only when the caller is authorized for the
      // node's whole subtree (a partial-visibility node would leak
      // members) — fail closed and surface the rejection.
      const inScope = subtreeEmployeeIds.filter((id) => scopeSet!.has(id));
      if (inScope.length !== subtreeEmployeeIds.length) {
        outOfScopeOrgNodeIds.push(nodeId);
        continue;
      }
      for (const id of inScope) subtreeMemberIds.add(id);
    } else {
      for (const id of subtreeEmployeeIds) subtreeMemberIds.add(id);
    }
  }

  const combined = new Set<string>([...employeeIdSet, ...subtreeMemberIds]);
  // Only employees that actually exist (existential filter — mirrors
  // the single-employee 404 semantics; requested-but-unknown ids
  // simply resolve to nothing).
  const population = employees
    .filter((e) => combined.has(e.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  const deduplicatedCount = population.length;
  const truncated = population.length > limit;
  const members = truncated ? population.slice(0, limit) : population;

  // ── Canonical per-member hub datasets (existing service — reused verbatim) ──
  // §GROUP-SCALING — request-scoped data sharing across ALL members:
  //   • ONE hrDeductions lookup (§HR-LOOKUP) instead of one full-table
  //     read + scan per member (hrAuthorized off → HR is never read).
  //   • ONE scoped loader set: the employees table is read once and
  //     projected per id (previously ~2 uncached point reads per
  //     member per month), orgNodes mapped once.
  // The per-member builds run under a BOUNDED pool
  // (GROUP_BUILD_CONCURRENCY) with index-based result ordering.
  //
  // A member whose dataset fails to build (deleted between resolution
  // and read, or an individual read failure) is EXPLICITLY reported
  // (failedEmployeeIds + a data-quality note) — never a fabricated
  // row, never a silent drop. A SYSTEMIC failure (EVERY member's
  // build rejects) rethrows like the previous unbounded Promise.all
  // did, so a broken database still surfaces as a 500 instead of an
  // empty-looking report.
  const scopedLoaders = createRequestScopedHubLoaders();
  const hrLookup: HrDeductionLookup | null = input.hrAuthorized
    ? await loadHrDeductionLookup()
    : null;

  const builtResults = await mapWithConcurrency(
    members,
    GROUP_BUILD_CONCURRENCY,
    (member) =>
      getEmployeePerformanceHubDataset({
        employeeId: member.id,
        monthKey: input.monthKey,
        now,
        riskEnabled: input.riskEnabled ?? false,
        hrAuthorized: input.hrAuthorized ?? false,
        hrLookup: hrLookup ?? undefined,
        loaders: scopedLoaders,
        // Team benchmark is a single-employee feature — skipped here.
        scopeIncludes: undefined,
      }),
  );

  const failedEmployeeIds: string[] = [];
  const rejectedReasons: unknown[] = [];
  const memberRows: Array<{ member: (typeof members)[number]; dataset: EmployeePerformanceHubDataset }> = [];
  members.forEach((member, i) => {
    const result = builtResults[i]!;
    if (result.status === 'fulfilled' && result.value) {
      memberRows.push({ member, dataset: result.value });
    } else {
      failedEmployeeIds.push(member.id);
      if (result.status === 'rejected') rejectedReasons.push(result.reason);
    }
  });
  if (members.length > 0 && rejectedReasons.length === members.length) {
    // Systemic — every single member failed; surface the failure
    // exactly as the old all-or-nothing Promise.all did.
    const first = rejectedReasons[0];
    throw first instanceof Error ? first : new Error(String(first));
  }
  const datasets = memberRows.map((row) => row.dataset);

  // ── Member summaries + real org context ──
  const summaries: GroupMemberSummary[] = memberRows.map(({ member, dataset }) => {
    const context = orgContextOf(orgIndex, member.orgNodeId);
    const valueBearingKeys = ROLLUP_KEYS.filter((key) => {
      const status = dimensionStatusOf(dataset, key);
      return status !== undefined && status !== 'INSUFFICIENT_DATA' && status !== 'NOT_MEASURABLE';
    });
    return {
      employeeId: member.id,
      employeeName: member.name,
      employeeCode: member.code,
      team: context.team,
      department: context.department,
      company: context.company,
      manager: context.manager,
      employmentStatus: String(member.status ?? 'unknown'),
      overviewStatus: dataset.overview.status,
      dimensionStatuses: dataset.dimensions.reduce((acc, d) => {
        acc[d.key] = d.status;
        return acc;
      }, {} as Partial<Record<HubDimensionKey, HubDimensionStatus>>),
      qualityPercent: dimensionValueOf(dataset, 'quality'),
      bookingCompletion: dimensionValueOf(dataset, 'bookingExecution'),
      employeeActionFollowUpCompletion: dimensionValueOf(dataset, 'employeeActionFollowUp'),
      attendanceCompliance: dimensionValueOf(dataset, 'attendance'),
      closedDeals: dimensionValueOf(dataset, 'businessOutput'),
      riskScore: dataset.risk?.score ?? null,
      riskLevel: dataset.risk?.level ?? null,
      hasData: valueBearingKeys.length > 0,
    };
  });

  // ── Coverage ──
  const membersWithData = summaries.filter((m) => m.hasData).length;
  const coverage = {
    membersWithData,
    membersWithoutData: summaries.length - membersWithData,
    dataCompletenessPercent:
      summaries.length > 0 ? roundTo2((membersWithData / summaries.length) * 100) : null,
  };

  // ── Overview distribution ──
  const overviewDistribution = emptyOverviewDistribution();
  for (const summary of summaries) overviewDistribution[summary.overviewStatus] += 1;

  // ── Dimension rollups ──
  // (datasets can be EMPTY — e.g. a selection narrowed entirely out of
  // scope — so the first-dataset shortcut is guarded; an empty
  // population yields an empty rollups list, never a 500.)
  const dimensionRollups: GroupDimensionRollup[] = ROLLUP_KEYS.filter(
    (key) =>
      (datasets.length > 0 && dimensionStatusOf(datasets[0]!, key) !== undefined) ||
      datasets.some((d) => d && dimensionStatusOf(d, key) !== undefined),
  ).map((key) => {
    const statusCounts = { ...EMPTY_STATUS_COUNTS };
    let notMeasurableCount = 0;
    let insufficientDataCount = 0;
    const values: number[] = [];
    for (const dataset of datasets) {
      const dim = dataset.dimensions.find((d) => d.key === key);
      if (!dim) continue;
      switch (dim.status) {
        case 'NOT_MEASURABLE': notMeasurableCount += 1; break;
        case 'INSUFFICIENT_DATA': insufficientDataCount += 1; break;
        default: statusCounts[dim.status] += 1;
      }
      if (dim.value !== null && dim.status !== 'NOT_MEASURABLE' && dim.status !== 'INSUFFICIENT_DATA') {
        values.push(dim.value);
      }
    }
    return {
      key,
      notMeasurableCount,
      insufficientDataCount,
      statusCounts,
      averageValue: averageOf(values),
      membersWithValue: values.length,
    };
  });

  // ── Shared strengths / common weaknesses (rule-id frequency) ──
  const strengthCounts = new Map<string, number>();
  const weaknessCounts = new Map<string, number>();
  countKeys(strengthCounts, datasets, (d) => d.strengths.map((s) => s.key));
  countKeys(weaknessCounts, datasets, (d) => [...d.developmentAreas.map((a) => a.key), ...d.overview.concerns.map((c) => c.key)]);

  // ── Repeated problems (stored labels, cross-member frequency) ──
  const problemCounts = new Map<string, { occurrenceCount: number; memberCount: number }>();
  for (const dataset of datasets) {
    for (const group of dataset.current.quality.repeatedIssues.byCategory) {
      const entry = problemCounts.get(group.label) ?? { occurrenceCount: 0, memberCount: 0 };
      entry.occurrenceCount += group.occurrenceCount;
      entry.memberCount += 1;
      problemCounts.set(group.label, entry);
    }
  }
  const repeatedProblems: GroupRepeatedProblem[] = [...problemCounts.entries()]
    .map(([label, entry]) => ({ label, ...entry }))
    .sort((a, b) => b.memberCount - a.memberCount || b.occurrenceCount - a.occurrenceCount || a.label.localeCompare(b.label));

  // ── Risk distribution (canonical engine levels, when available) ──
  const riskDistribution: Record<string, number> = {};
  for (const summary of summaries) {
    if (summary.riskLevel === null) continue;
    riskDistribution[summary.riskLevel] = (riskDistribution[summary.riskLevel] ?? 0) + 1;
  }

  // ── Trends (strongest change per member from the canonical §17 list) ──
  const improving: GroupTrendEntry[] = [];
  const deteriorating: GroupTrendEntry[] = [];
  for (const { member, dataset } of memberRows) {
    const strongest = dataset.changes
      .filter((c) => (c.delta !== null && c.delta !== 0) && (c.direction === 'UP' || c.direction === 'DOWN'))
      .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!))[0] ?? null;
    if (!strongest) continue;
    const direction: 'UP' | 'DOWN' = strongest.direction === 'UP' ? 'UP' : 'DOWN';
    const entry: GroupTrendEntry = {
      employeeId: member.id,
      employeeName: member.name,
      key: strongest.key,
      direction,
      delta: strongest.delta,
      unit: strongest.unit,
    };
    if (direction === 'UP') improving.push(entry);
    else deteriorating.push(entry);
  }

  // ── Attention list (members needing managerial review) ──
  const attentionList: GroupAttentionEntry[] = summaries
    .map((summary, i) => {
      const dataset = datasets[i]!;
      const needsAttention = dataset.dimensions
        .filter((d) => d.status === 'NEEDS_ATTENTION')
        .map((d) => d.key);
      const declining = dataset.dimensions.filter((d) => d.status === 'DECLINING').map((d) => d.key);
      return {
        employeeId: summary.employeeId,
        employeeName: summary.employeeName,
        overviewStatus: summary.overviewStatus,
        needsAttention,
        declining,
        reasons: dataset.overview.reasons,
      };
    })
    .filter((entry) => entry.needsAttention.length > 0 || entry.declining.length > 0 || entry.overviewStatus === 'PERFORMANCE_IMPROVEMENT_REVIEW' || entry.overviewStatus === 'MANAGEMENT_REVIEW')
    .sort((a, b) => (b.declining.length + b.needsAttention.length) - (a.declining.length + a.needsAttention.length) || a.employeeName.localeCompare(b.employeeName));

  // ── Comparison — BY REAL ORGANIZATIONAL MEMBERSHIP (never the selection) ──
  const comparison = compare
    ? { units: buildUnitComparisons(summaries) }
    : null;

  // ── Manager analysis — grouped by the RESOLVED manager ──
  const managerAnalysis = compare ? buildManagerAnalyses(summaries) : null;

  // ── Data quality notes (material limitations only) ──
  const dataQualityNotes: string[] = [];
  if (outOfScopeEmployeeIds.length > 0) {
    dataQualityNotes.push(`employeeIdsOutOfScope:${outOfScopeEmployeeIds.length}`);
  }
  if (outOfScopeOrgNodeIds.length > 0) {
    dataQualityNotes.push(`orgNodesOutOfScope:${outOfScopeOrgNodeIds.length}`);
  }
  if (truncated) {
    dataQualityNotes.push(`truncated:${deduplicatedCount}->${limit}`);
  }
  if (failedEmployeeIds.length > 0) {
    dataQualityNotes.push(`failedDatasets:${failedEmployeeIds.length}`);
  }
  if (coverage.membersWithoutData > 0) {
    dataQualityNotes.push(`membersWithoutData:${coverage.membersWithoutData}`);
  }
  const notMeasurableQuality = dimensionRollups.find((r) => r.key === 'quality')?.notMeasurableCount ?? 0;
  if (notMeasurableQuality > 0) {
    dataQualityNotes.push(`qualityNotMeasurable:${notMeasurableQuality}`);
  }

  return {
    datasetKind: 'EMPLOYEE_PERFORMANCE_GROUP_REPORT',
    period: {
      monthKey: input.monthKey,
      previousMonthKey: compare ? previousMonthKey(input.monthKey) : null,
      compared: compare,
    },
    population: {
      requestedEmployeeIds: [...input.selection.employeeIds],
      requestedOrgNodeIds: [...input.selection.orgNodeIds],
      outOfScopeEmployeeIds,
      outOfScopeOrgNodeIds,
      resolvedCount: combined.size,
      deduplicatedCount,
      truncated,
      limit,
      members: summaries,
      failedEmployeeIds,
    },
    coverage,
    overviewDistribution,
    dimensionRollups,
    sharedStrengths: toCountedList(strengthCounts),
    commonWeaknesses: toCountedList(weaknessCounts),
    repeatedProblems,
    riskDistribution,
    improving,
    deteriorating,
    attentionList,
    comparison,
    managerAnalysis,
    dataQualityNotes,
    generatedAt: now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────
//  Comparison units (§COMPARISON — by actual org membership)
// ─────────────────────────────────────────────────────────────

function buildUnitComparisons(
  summaries: ReadonlyArray<GroupMemberSummary>,
): GroupUnitComparison[] {
  const groups = new Map<string, { unitType: GroupUnitComparison['unitType']; label: string; members: GroupMemberSummary[] }>();

  const push = (unitType: GroupUnitComparison['unitType'], label: string | null, member: GroupMemberSummary) => {
    if (!label) return;
    const unitKey = `${unitType}:${label}`;
    const group = groups.get(unitKey) ?? { unitType, label, members: [] };
    group.members.push(member);
    groups.set(unitKey, group);
  };

  for (const member of summaries) {
    push('team', member.team, member);
    push('department', member.department, member);
    push('company', member.company, member);
    push('manager', member.manager, member);
  }

  const units: GroupUnitComparison[] = [];
  for (const [unitKey, group] of groups) {
    const withValue = (pick: (m: GroupMemberSummary) => number | null): number[] =>
      group.members.map((m) => pick(m)).filter((v): v is number => v !== null);
    units.push({
      unitKey,
      unitType: group.unitType,
      label: group.label,
      memberCount: group.members.length,
      membersWithValue: group.members.filter((m) => m.hasData).length,
      avgQuality: averageOf(withValue((m) => m.qualityPercent)),
      avgBookingCompletion: averageOf(withValue((m) => m.bookingCompletion)),
      avgActionFollowUpCompletion: averageOf(withValue((m) => m.employeeActionFollowUpCompletion)),
      avgAttendance: averageOf(withValue((m) => m.attendanceCompliance)),
      closedDealsTotal: group.members.reduce((sum, m) => sum + (m.closedDeals ?? 0), 0),
      attentionCount: group.members.filter(
        (m) => m.overviewStatus === 'NEEDS_COACHING' || m.overviewStatus === 'PERFORMANCE_IMPROVEMENT_REVIEW' || m.overviewStatus === 'MANAGEMENT_REVIEW',
      ).length,
    });
  }
  return units.sort(
    (a, b) =>
      a.unitType.localeCompare(b.unitType) ||
      b.memberCount - a.memberCount ||
      a.label.localeCompare(b.label),
  );
}

function buildManagerAnalyses(
  summaries: ReadonlyArray<GroupMemberSummary>,
): GroupManagerAnalysis[] | null {
  const byManager = new Map<string, GroupMemberSummary[]>();
  for (const member of summaries) {
    if (!member.manager) continue;
    const list = byManager.get(member.manager) ?? [];
    list.push(member);
    byManager.set(member.manager, list);
  }
  if (byManager.size === 0) return null;

  const analyses: GroupManagerAnalysis[] = [];
  for (const [manager, members] of byManager) {
    if (members.length === 0) continue;
    const overviewDistribution: Record<string, number> = {};
    for (const member of members) {
      overviewDistribution[member.overviewStatus] = (overviewDistribution[member.overviewStatus] ?? 0) + 1;
    }
    const decliningDimensionCounts: Partial<Record<HubDimensionKey, number>> = {};
    for (const member of members) {
      for (const key of member.dimensionStatuses ? Object.entries(member.dimensionStatuses).filter(([, s]) => s === 'DECLINING').map(([k]) => k as HubDimensionKey) : []) {
        decliningDimensionCounts[key] = (decliningDimensionCounts[key] ?? 0) + 1;
      }
    }
    analyses.push({
      manager,
      memberCount: members.length,
      overviewDistribution,
      needsIntervention: members
        .filter((m) => m.overviewStatus === 'PERFORMANCE_IMPROVEMENT_REVIEW' || m.overviewStatus === 'MANAGEMENT_REVIEW')
        .map((m) => m.employeeName),
      decliningDimensionCounts,
    });
  }
  return analyses.sort((a, b) => b.memberCount - a.memberCount || a.manager.localeCompare(b.manager));
}
