// ══════════════════════════════════════════════════════════════
//  KPI Dashboard service — Milestone 6A
//
//  Owns the BUSINESS LOGIC for the KPI Dashboard API. Keeps the
//  /api/kpi-dashboard route THIN: the route authenticates, parses the
//  query string, then delegates here.
//
//  Architecture (binding — spec §2):
//    API Route → THIS service → canonical KPI engine (kpiMetrics) → Database
//
//  No score / trend / ranking FORMULA is defined here. The canonical
//  KPI engine (src/lib/metrics/kpiMetrics.ts) and the month-snapshot
//  service (src/lib/month-snapshots.ts) remain the single sources of
//  truth. This service only:
//    • resolves the requested range (reuses resolveMonthsInRange),
//    • reads FROZEN snapshots for closed months,
//    • live-computes ONLY the current open month (reuses the canonical
//      engine via computeFreshMonthSnapshot),
//    • aggregates the resulting MonthSnapshot-shaped data into the
//      dashboard contract (reuses aggregateSnapshots + computeTrend).
//
//  Data-source rule (spec §3):
//    • Closed month            → frozen snapshot, never recomputed.
//    • Current open month      → live preview via the canonical engine.
//    • Historical open month   → SKIPPED (never recomputed from today's
//                                employee data — preserves §3 guarantee).
//
//  The pure assembly function (buildDashboardResponse) takes already
//  collected snapshots and is fully unit-testable without a database.
//  The orchestrator (getKpiDashboard) wires it to the DB + engine.
// ══════════════════════════════════════════════════════════════

import { getKpiSettings } from '@/lib/kpi-settings';
import { getMonthSnapshot } from '@/lib/month-lock';
import {
  buildLivePreview,
  computeFreshMonthSnapshot,
} from '@/lib/month-snapshots';
import {
  aggregateSnapshots,
  computeTrend,
  resolveMonthsInRange,
} from '@/lib/metrics/kpiMetrics';
import { isValidMonthKey } from '@/lib/month-utils';
import type {
  KpiRangePreset,
  KpiSettings,
  MonthSnapshot,
  PerformanceFactor,
  RankedEmployee,
  TrendResult,
} from '@/types/quality-kpi';

// ─────────────────────────────────────────────────────────────
//  Public response contract (stable, typed — consumed by the
//  future KPI Dashboard UI and already by the existing page).
//  Field names reuse the ESTABLISHED names from Milestones 1–5
//  (avgScore, categoryDistribution as Record, …) so existing
//  consumers keep working; Milestone 6 only ADDS fields.
// ─────────────────────────────────────────────────────────────

/**
 * A department-level ranking row. All values are aggregated from real
 * stored snapshot `departmentScores` — never invented.
 */
export interface DashboardDepartmentRankEntry {
  department: string;
  averageScore: number;
  /** Employee-months represented in the selected range. */
  employeeCount: number;
  totalDeductionPoints: number;
  totalBonusPoints: number;
  totalObservations: number;
}

/** Aggregate approval statistics across the selected range. */
export interface DashboardApprovalStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  avgApprovalHours: number;
}

/** One point in the per-month score series (for trend charts). */
export interface DashboardMonthlyScore {
  monthKey: string;
  avgScore: number;
  isLive: boolean;
}

/**
 * A leaderboard row. Extends the canonical {@link RankedEmployee} so the
 * existing UI type keeps compiling; the extra optional fields carry the
 * richer breakdown the Milestone 6 contract asks for, sourced from the
 * frozen `EmployeeScoreEntry` / live engine output.
 */
export interface DashboardLeaderboardEntry extends RankedEmployee {
  /** Position frozen on the snapshot (closed) or current (live). */
  position?: string;
  deductionPoints?: number;
  bonusPoints?: number;
}

/** The full /api/kpi-dashboard response. */
export interface KpiDashboardResponse {
  range: KpiRangePreset;
  /** Resolved month keys (YYYY-MM), most-recent first. */
  months: string[];
  /** True when the current open month is included and live-computed. */
  isLive: boolean;
  /** Average canonical KPI score across the range (established name). */
  avgScore: number;
  totalEmployees: number;
  totalDeductions: number;
  totalBonuses: number;
  trend: TrendResult;
  /**
   * Highest-scoring employees who reached the canonical baseline
   * (score >= settings.defaultScore) in the selected scope — best first.
   * Employees below the baseline are NEVER listed here; they appear in
   * {@link needsImprovement}, so the two lists are disjoint by
   * construction.
   */
  topEmployees: DashboardLeaderboardEntry[];
  /**
   * Lowest-scoring employees in the selected scope (worst first) — a
   * pure ranking view, NOT an improvement classification. Kept for
   * contract compatibility; the UI "needs improvement" section consumes
   * {@link needsImprovement} instead.
   */
  bottomEmployees: DashboardLeaderboardEntry[];
  /**
   * Employees who actually need improvement: their score is BELOW the
   * canonical baseline (settings.defaultScore) — i.e. they carry net
   * effective deductions after the capped bonus. Derived entirely from
   * the existing KPI settings (no separate threshold is configured in
   * the KPI system); worst score first, capped at 10. Employees at the
   * baseline (e.g. a valid score of 100) never appear here.
   */
  needsImprovement: DashboardLeaderboardEntry[];
  pendingApprovals: number;
  /** Category deduction points keyed by canonical categoryId. */
  categoryDistribution: Record<string, number>;
  departmentRanking: DashboardDepartmentRankEntry[];
  approvalStats: DashboardApprovalStats;
  monthlyScores: DashboardMonthlyScore[];
  performanceFactor: PerformanceFactor;
  settings: {
    defaultScore: number;
    minimumScore: number;
    allowBonus: boolean;
    maximumBonus: number;
  };
}

// ─────────────────────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────────────────────

/** A collected month: its resolved key, snapshot payload, and source. */
export interface CollectedMonth {
  monthKey: string;
  snapshot: MonthSnapshot;
  isLive: boolean;
}

/** Optional dashboard filters passed straight from the query string. */
export interface DashboardFilters {
  department?: string | null;
  employeeId?: string | null;
}

/** Neutral aggregate approval stats (used when no data is available). */
const NEUTRAL_APPROVAL_STATS: DashboardApprovalStats = {
  total: 0,
  pending: 0,
  approved: 0,
  rejected: 0,
  avgApprovalHours: 0,
};

/**
 * Return a shallow copy of a snapshot with its `employeeScores` and
 * `departmentScores` restricted to the requested department/employee.
 *
 * Month-wide `categoryTotals` and `approvalStats` are intentionally left
 * untouched (the frozen snapshot does not store per-department category
 * totals, and per-department approval stats would require rescanning
 * every observation — which the snapshot exists to avoid). This matches
 * the established Milestone 1–5 filter behavior.
 */
function filterSnapshot(
  snapshot: MonthSnapshot,
  filters: DashboardFilters,
): MonthSnapshot {
  const { department, employeeId } = filters;
  if (!department && !employeeId) return snapshot;

  const employeeScores = Object.fromEntries(
    Object.entries(snapshot.employeeScores).filter(([, entry]) => {
      if (employeeId && entry.employeeSnapshot.employeeId !== employeeId) return false;
      if (department && entry.dept !== department) return false;
      return true;
    }),
  );

  const departmentScores = department
    ? Object.fromEntries(
        Object.entries(snapshot.departmentScores).filter(([dept]) => dept === department),
      )
    : snapshot.departmentScores;

  return { ...snapshot, employeeScores, departmentScores };
}

/**
 * Aggregate department scores across the supplied snapshots into ranked
 * rows. Uses a weighted mean (weighted by per-month employee count) so a
 * department with many employees isn't drowned out by a tiny one.
 *
 * This aggregates STORED scores only — no recomputation.
 */
function aggregateDepartmentRanking(
  snapshots: MonthSnapshot[],
): DashboardDepartmentRankEntry[] {
  const acc = new Map<
    string,
    {
      scoreWeighted: number;
      employeeMonths: number;
      totalDeductionPoints: number;
      totalBonusPoints: number;
      totalObservations: number;
    }
  >();

  for (const snap of snapshots) {
    for (const [dept, entry] of Object.entries(snap.departmentScores)) {
      const cur = acc.get(dept) ?? {
        scoreWeighted: 0,
        employeeMonths: 0,
        totalDeductionPoints: 0,
        totalBonusPoints: 0,
        totalObservations: 0,
      };
      const weight = entry.totalEmployees > 0 ? entry.totalEmployees : 0;
      cur.scoreWeighted += entry.avgScore * weight;
      cur.employeeMonths += weight;
      cur.totalDeductionPoints += entry.totalDeductionPoints;
      cur.totalBonusPoints += entry.totalBonusPoints;
      cur.totalObservations += entry.totalObservations;
      acc.set(dept, cur);
    }
  }

  const rows: DashboardDepartmentRankEntry[] = [];
  for (const [department, v] of acc) {
    rows.push({
      department,
      averageScore: v.employeeMonths > 0 ? Math.round(v.scoreWeighted / v.employeeMonths) : 0,
      employeeCount: v.employeeMonths,
      totalDeductionPoints: v.totalDeductionPoints,
      totalBonusPoints: v.totalBonusPoints,
      totalObservations: v.totalObservations,
    });
  }
  // Rank by average score desc, then department name for determinism.
  rows.sort((a, b) =>
    b.averageScore !== a.averageScore
      ? b.averageScore - a.averageScore
      : a.department.localeCompare(b.department),
  );
  return rows;
}

/** Per-employee leaderboard aggregation across the supplied snapshots. */
function aggregateLeaderboard(
  snapshots: MonthSnapshot[],
): DashboardLeaderboardEntry[] {
  // Process oldest → newest so the most recent frozen identity wins.
  const ordered = [...snapshots].sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  const acc = new Map<
    string,
    {
      scoreSum: number;
      samples: number;
      deductionPoints: number;
      bonusPoints: number;
      identity: {
        employeeName: string;
        department: string;
        position: string;
      };
    }
  >();

  for (const snap of ordered) {
    for (const entry of Object.values(snap.employeeScores)) {
      const eid = entry.employeeSnapshot.employeeId;
      const cur = acc.get(eid) ?? {
        scoreSum: 0,
        samples: 0,
        deductionPoints: 0,
        bonusPoints: 0,
        identity: {
          employeeName: entry.employeeSnapshot.employeeName,
          department: entry.dept,
          position: entry.employeeSnapshot.position,
        },
      };
      cur.scoreSum += entry.score;
      cur.samples += 1;
      cur.deductionPoints += entry.deductionPoints;
      cur.bonusPoints += entry.bonusPoints;
      // Latest frozen identity for this employee wins.
      cur.identity = {
        employeeName: entry.employeeSnapshot.employeeName,
        department: entry.dept,
        position: entry.employeeSnapshot.position,
      };
      acc.set(eid, cur);
    }
  }

  const rows: DashboardLeaderboardEntry[] = [];
  for (const [employeeId, v] of acc) {
    rows.push({
      employeeId,
      employeeName: v.identity.employeeName,
      department: v.identity.department,
      score: v.samples > 0 ? Math.round(v.scoreSum / v.samples) : 0,
      rank: 0, // assigned below
      position: v.identity.position,
      deductionPoints: v.deductionPoints,
      bonusPoints: v.bonusPoints,
    });
  }
  // Rank by averaged score desc, employeeId asc for determinism (mirrors
  // the canonical engine's tie-break, without redefining the formula).
  rows.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.employeeId.localeCompare(b.employeeId),
  );
  for (let i = 0; i < rows.length; i++) rows[i].rank = i + 1;
  return rows;
}

/** Sum approval stats across the supplied snapshots. */
function aggregateApprovalStats(
  snapshots: MonthSnapshot[],
): DashboardApprovalStats {
  if (snapshots.length === 0) return { ...NEUTRAL_APPROVAL_STATS };
  let total = 0;
  let pending = 0;
  let approved = 0;
  let rejected = 0;
  for (const snap of snapshots) {
    const s = snap.approvalStats;
    if (!s) continue;
    total += s.total ?? 0;
    pending += s.pending ?? 0;
    approved += s.approved ?? 0;
    rejected += s.rejected ?? 0;
  }
  return { total, pending, approved, rejected, avgApprovalHours: 0 };
}

/** Average score of a single snapshot from its employee entries. */
function snapshotAvgScore(snapshot: MonthSnapshot): number {
  const entries = Object.values(snapshot.employeeScores);
  if (entries.length === 0) return 0;
  const sum = entries.reduce((a, e) => a + e.score, 0);
  return Math.round(sum / entries.length);
}

/**
 * Split collected months into the leaderboard slices.
 * Top 10 by rank ascending; bottom 10 by rank descending (worst first),
 * matching the canonical snapshot leaderboard orientation.
 */
function splitLeaderboard(rows: DashboardLeaderboardEntry[]): {
  top: DashboardLeaderboardEntry[];
  bottom: DashboardLeaderboardEntry[];
} {
  const top = rows.slice(0, 10);
  const bottom = rows.slice(-10).reverse();
  return { top, bottom };
}

// ─────────────────────────────────────────────────────────────
//  Improvement classification (canonical baseline rule)
// ─────────────────────────────────────────────────────────────

/** Max rows in the needs-improvement list (mirrors the top list cap). */
const IMPROVEMENT_LIST_CAP = 10;

/**
 * Split the aggregated leaderboard into the DISJOINT top / needs-
 * improvement populations.
 *
 * Canonical rule (no invented threshold): an employee "needs
 * improvement" when their score is below `settings.defaultScore` — the
 * configured baseline every employee starts from. The engine formula
 * (defaultScore − deductions + capped bonus) makes this exactly "has
 * net effective deductions", so a valid 100-score employee with no
 * deductions is never classified as needing improvement.
 *
 * Both lists stay deterministic: scores sort first, employeeId breaks
 * ties (mirroring the engine's tie-break).
 */
function splitTopAndImprovement(
  rows: DashboardLeaderboardEntry[],
  defaultScore: number,
): {
  top: DashboardLeaderboardEntry[];
  needsImprovement: DashboardLeaderboardEntry[];
} {
  // rows arrive sorted best-first (aggregateLeaderboard ordering).
  const top = rows.filter((e) => e.score >= defaultScore).slice(0, 10);
  const needsImprovement = rows
    .filter((e) => e.score < defaultScore)
    .sort((a, b) =>
      a.score !== b.score
        ? a.score - b.score // worst first
        : a.employeeId.localeCompare(b.employeeId),
    )
    .slice(0, IMPROVEMENT_LIST_CAP);
  return { top, needsImprovement };
}

// ─────────────────────────────────────────────────────────────
//  PURE assembly (no DB — fully unit-testable)
// ─────────────────────────────────────────────────────────────

/** Inputs to the pure dashboard assembly. */
export interface BuildDashboardInput {
  range: KpiRangePreset;
  months: string[];
  collected: CollectedMonth[];
  /** Current KPI settings — passed straight to the canonical trend helper. */
  settings: KpiSettings;
  filters?: DashboardFilters;
}

/**
 * Assemble the full dashboard response from collected month snapshots.
 *
 * PURE: performs no I/O. All scores, totals, rankings and stats are
 * derived from the supplied (frozen or canonical-engine-computed)
 * snapshots via the canonical aggregation helpers. The trend delegates
 * entirely to {@link computeTrend} and is computed from STORED frozen
 * snapshots only (never the live preview), per the engine contract.
 *
 * @param input - Collected months, settings, and optional filters.
 * @returns The typed dashboard response.
 */
export function buildDashboardResponse(input: BuildDashboardInput): KpiDashboardResponse {
  const { range, months, collected, settings, filters = {} } = input;

  // Apply optional department/employeeId filters at the snapshot level.
  const filteredCollected = collected.map((c) => ({
    ...c,
    snapshot: filterSnapshot(c.snapshot, filters),
  }));
  const filteredSnapshots = filteredCollected.map((c) => c.snapshot);

  const isLive = collected.some((c) => c.isLive);

  // Canonical aggregation across all months (frozen + live).
  const aggregation = aggregateSnapshots(filteredSnapshots);

  // Trend: STORED snapshots only (exclude the live preview).
  const storedSnapshots = filteredCollected
    .filter((c) => !c.isLive)
    .map((c) => c.snapshot)
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  const trend = computeTrend(storedSnapshots, settings);

  // Leaderboard (aggregated from stored employee scores).
  const leaderboard = aggregateLeaderboard(filteredSnapshots);
  // Disjoint top / needs-improvement populations (canonical baseline rule).
  const { top: topEmployees, needsImprovement } = splitTopAndImprovement(
    leaderboard,
    settings.defaultScore,
  );
  const { bottom: bottomEmployees } = splitLeaderboard(leaderboard);

  // Department ranking + approval stats + category distribution.
  const departmentRanking = aggregateDepartmentRanking(filteredSnapshots);
  const approvalStats = aggregateApprovalStats(filteredSnapshots);
  const categoryDistribution: Record<string, number> = { ...aggregation.categoryTotals };

  // Per-month score series.
  const monthlyScores: DashboardMonthlyScore[] = filteredCollected.map((c) => ({
    monthKey: c.monthKey,
    avgScore: snapshotAvgScore(c.snapshot),
    isLive: c.isLive,
  }));

  const performanceFactor: PerformanceFactor = {
    factorId: 'quality',
    factorName: 'الجودة',
    score: aggregation.avgScore,
    maxScore: settings.defaultScore,
    weight: 1,
    normalized: settings.defaultScore > 0 ? aggregation.avgScore / settings.defaultScore : 0,
    breakdown: categoryDistribution,
  };

  return {
    range,
    months,
    isLive,
    avgScore: aggregation.avgScore,
    totalEmployees: aggregation.totalEmployees,
    totalDeductions: aggregation.totalDeductions,
    totalBonuses: aggregation.totalBonuses,
    trend,
    topEmployees,
    bottomEmployees,
    needsImprovement,
    pendingApprovals: approvalStats.pending,
    categoryDistribution,
    departmentRanking,
    approvalStats,
    monthlyScores,
    performanceFactor,
    settings: {
      defaultScore: settings.defaultScore,
      minimumScore: settings.minimumScore,
      allowBonus: settings.allowBonus,
      maximumBonus: settings.maximumBonus,
    },
  };
}

// ─────────────────────────────────────────────────────────────
//  ORCHESTRATOR (wires pure assembly to DB + canonical engine)
// ─────────────────────────────────────────────────────────────

/** Valid range presets accepted by the dashboard. */
const VALID_RANGES: ReadonlySet<KpiRangePreset> = new Set<KpiRangePreset>([
  'current_month',
  'previous_month',
  'last_3_months',
  'last_6_months',
  'current_year',
  'custom',
]);

/**
 * Resolve the dashboard month keys from the range/customMonths params.
 *
 * Reuses the canonical {@link resolveMonthsInRange}. For `custom`, parses
 * a comma-separated list of strict YYYY-MM keys (the established query
 * convention used by the existing route and the `useKpiDashboard` hook).
 *
 * @returns The resolved month keys plus a validation error (if any).
 */
export function resolveDashboardMonths(
  range: string,
  customMonths?: string | null,
): { monthKeys: string[]; error: string | null } {
  if (!VALID_RANGES.has(range as KpiRangePreset)) {
    return { monthKeys: [], error: 'نطاق غير مدعوم' };
  }
  const preset = range as KpiRangePreset;

  if (preset === 'custom') {
    if (!customMonths) return { monthKeys: [], error: 'لم يتم تحديد أشهر مخصصة' };
    const keys = customMonths
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean)
      .filter((m) => isValidMonthKey(m));
    if (keys.length === 0) return { monthKeys: [], error: 'صيغة الشهر غير صحيحة (YYYY-MM)' };
    return { monthKeys: keys, error: null };
  }

  const monthKeys = resolveMonthsInRange(preset);
  if (monthKeys.length === 0) return { monthKeys: [], error: 'لم يتم تحديد أشهر للعرض' };
  return { monthKeys, error: null };
}

/**
 * Build the KPI dashboard response for a given range.
 *
 * Orchestrates the data-source rule (spec §3):
 *   • closed month  → frozen snapshot (one cached read)
 *   • current open  → live preview via the canonical engine
 *   • historical open → skipped (never recomputed)
 *
 * Performance:
 *   • Snapshot reads use the cached `getMonthSnapshot` (one read/month).
 *   • The live month is computed at most once (canonical engine).
 *   • No per-employee Firebase reads (no N+1).
 *
 * @param range       - Range preset (query param).
 * @param options     - customMonths + optional filters.
 */
export async function getKpiDashboard(
  range: string,
  options: {
    customMonths?: string | null;
    filters?: DashboardFilters;
    now?: Date;
  } = {},
): Promise<{ response: KpiDashboardResponse; error: string | null }> {
  const { customMonths, filters } = options;

  const { monthKeys, error } = resolveDashboardMonths(range, customMonths);
  if (error) return { response: emptyResponse(range as KpiRangePreset, []), error };

  const settings = await getKpiSettings();

  // The TRUE current calendar month — only this month may be live-computed.
  const now = options.now ?? new Date();
  const currentMonthKey = resolveMonthsInRange('current_month', now)[0];

  const collected: CollectedMonth[] = [];

  for (const monthKey of monthKeys) {
    const frozen = await getMonthSnapshot(monthKey);

    if (frozen && frozen.status === 'closed') {
      // Closed → frozen snapshot, never recomputed.
      collected.push({ monthKey, snapshot: frozen, isLive: false });
      continue;
    }

    if (monthKey === currentMonthKey) {
      // Current open month → live preview via the canonical engine.
      const computed = await computeFreshMonthSnapshot(monthKey);
      collected.push({
        monthKey,
        snapshot: buildLivePreview(computed, monthKey),
        isLive: true,
      });
      continue;
    }

    // Historical open month with no frozen snapshot → skip. Recomputing it
    // from today's employee data would violate the §3 frozen guarantee.
  }

  const response = buildDashboardResponse({
    range: range as KpiRangePreset,
    months: monthKeys,
    collected,
    settings,
    filters,
  });

  return { response, error: null };
}

/** Build an empty (zeroed) dashboard response for invalid input. */
function emptyResponse(range: KpiRangePreset, months: string[]): KpiDashboardResponse {
  const neutralTrend: TrendResult = {
    direction: 'stable',
    momDelta: 0,
    rollingAverage: 0,
    movingScore: 0,
    sampleSize: 0,
  };
  return {
    range,
    months,
    isLive: false,
    avgScore: 0,
    totalEmployees: 0,
    totalDeductions: 0,
    totalBonuses: 0,
    trend: neutralTrend,
    topEmployees: [],
    bottomEmployees: [],
    needsImprovement: [],
    pendingApprovals: 0,
    categoryDistribution: {},
    departmentRanking: [],
    approvalStats: { ...NEUTRAL_APPROVAL_STATS },
    monthlyScores: [],
    performanceFactor: {
      factorId: 'quality',
      factorName: 'الجودة',
      score: 0,
      maxScore: 100,
      weight: 1,
      normalized: 0,
      breakdown: {},
    },
    settings: {
      defaultScore: 100,
      minimumScore: 0,
      allowBonus: true,
      maximumBonus: 20,
    },
  };
}
