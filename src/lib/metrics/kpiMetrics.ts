// ══════════════════════════════════════════════════════════════
//  CANONICAL KPI ENGINE — single source of truth for Quality KPIs
//
//  Architecture:
//    Database
//      → src/lib/db.ts                     (data access + cache)
//      → src/lib/kpi-scoring/score-calculator (generic formula)
//      → src/lib/metrics/kpiMetrics.ts     (THIS — canonical KPI calculations)
//      → src/app/api/*                     (thin HTTP layer, calls this)
//      → UI components                     (display only — never recompute)
//
//  Rules enforced here:
//    • Score = config-driven (KpiSettings param, never hardcoded).
//    • Only APPROVED observations with applyPointDeduction=true count.
//    • Pending / rejected observations have zero KPI impact.
//    • Bonuses are capped by maximumBonus; gated by allowBonus.
//    • Score floors at minimumScore (default 0, never negative).
//    • Invalid/negative points are ignored (treated as 0).
//    • Weighted points = Σ(points × categoryWeight), stored for
//      future analytics. The current formula uses raw points only.
//    • Trend uses STORED snapshots only — never live recalculation.
//    • Timeline is derived from audit/approval history (no dup fields).
//
//  No module outside lib/metrics may define a KPI score, the formula,
//  or a trend direction.
// ══════════════════════════════════════════════════════════════

import type {
  ApprovalStatus,
  AuditEvent,
  ApprovalEvent as ApprovalEventType,
  DepartmentScoreEntry,
  EmployeeScoreEntry,
  EmployeeSnapshot,
  KpiRangePreset,
  KpiSettings,
  MonthApprovalStats,
  MonthSnapshot,
  ObservationStatus,
  RankedEmployee,
  TrendDirection,
  TrendResult,
  EmployeeScoreResult,
  PerformanceFactor,
} from '@/types/quality-kpi';
import { computeScoreFromAdjustments, toPerformanceFactor } from '@/lib/kpi-scoring';
import { buildTimeline } from '@/lib/audit';

// ─────────────────────────────────────────────────────────────
//  Observation filters (used by engine and API routes)
// ─────────────────────────────────────────────────────────────

/** An observation-like shape with the fields the engine reads. */
export interface ObservationLike {
  id: string;
  employeeId: string;
  month: string;
  applyPointDeduction: boolean;
  points: number;
  isBonus: boolean;
  approvalStatus: ApprovalStatus;
  categoryId: string;
  categoryWeight: number;
  status: ObservationStatus;
}

/** An employee-like shape for snapshot generation. */
export interface EmployeeLike {
  id: string;
  name: string;
  department: string | null;
  position: string | null;
}

/** A supervisor map for snapshot generation. */
export type SupervisorMap = Map<string, string | null>;

/**
 * Category-level aggregation with full breakdown.
 * Provides deduction points, bonus points, weighted points,
 * and observation count per category.
 */
export interface CategoryTotal {
  /** Sum of deduction points from approved observations in this category. */
  deductionPoints: number;
  /** Sum of bonus points from approved observations in this category. */
  bonusPoints: number;
  /** Sum of (points × categoryWeight) from approved observations. */
  weightedPoints: number;
  /** Number of approved observations in this category. */
  count: number;
}

/** True if the observation is approved AND applies to KPI scoring. */
export function isApprovedKpiObs(obs: ObservationLike): boolean {
  return obs.applyPointDeduction && obs.approvalStatus === 'approved';
}

/** True if the observation is an approved deduction (not bonus). */
export function isEffectiveDeductionObs(obs: ObservationLike): boolean {
  return isApprovedKpiObs(obs) && !obs.isBonus;
}

/** True if the observation is an approved bonus. */
export function isEffectiveBonusObs(obs: ObservationLike): boolean {
  return isApprovedKpiObs(obs) && obs.isBonus;
}

/** True if the observation is pending approval (counts in stats, not score). */
export function isPendingApprovalObs(obs: ObservationLike): boolean {
  return obs.applyPointDeduction && obs.approvalStatus === 'pending';
}

/** True if the observation is rejected. */
export function isRejectedObs(obs: ObservationLike): boolean {
  return obs.applyPointDeduction && obs.approvalStatus === 'rejected';
}

/**
 * Validate that observation points are valid for KPI scoring.
 * Points must be a finite, non-negative number.
 * Invalid points (NaN, Infinity, negative) are silently ignored.
 *
 * @param points - The points value to validate.
 * @returns True if points are valid and non-negative.
 */
export function isValidPoints(points: number): boolean {
  return Number.isFinite(points) && points >= 0;
}

// ─────────────────────────────────────────────────────────────
//  Score computation (delegates to generic kpi-scoring)
// ─────────────────────────────────────────────────────────────

/**
 * Compute a single employee's score from their observations for
 * a specific month. Only approved observations with
 * applyPointDeduction=true and valid (non-negative, finite) points
 * are included.
 *
 * Formula (delegates to generic computeScoreFromAdjustments):
 *   score = clamp(minimumScore, defaultScore - deductionPoints + allowedBonus, ∞)
 *   where:
 *     allowedBonus = allowBonus ? min(bonusPoints, maximumBonus) : 0
 *
 * Weighted points = Σ(points × categoryWeight) are computed for
 * analytics but do NOT affect the score formula.
 *
 * @param observations - The employee's filtered observations for the month.
 * @param settings    - Current KPI settings (config-driven).
 * @param employeeId   - Employee to score.
 * @returns Full employee score result including counts, category totals, and weighted analytics.
 */
export function computeEmployeeScore(
  observations: ObservationLike[],
  settings: KpiSettings,
  employeeId: string,
): EmployeeScoreResult {
  let deductionPoints = 0;
  let bonusPoints = 0;
  let weightedPoints = 0;
  let approvedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;
  let effectiveDeductionCount = 0;
  let effectiveBonusCount = 0;
  const categoryTotals: Record<string, number> = {};

  for (const obs of observations) {
    // Observations without point deduction never affect KPI points,
    // even if approved.
    if (!obs.applyPointDeduction) continue;

    // Count all approval-relevant statuses
    if (obs.approvalStatus === 'approved') approvedCount++;
    else if (obs.approvalStatus === 'pending') pendingCount++;
    else if (obs.approvalStatus === 'rejected') rejectedCount++;

    // Only approved observations affect the score.
    // Additionally, points must be valid (non-negative, finite).
    if (isApprovedKpiObs(obs) && isValidPoints(obs.points)) {
      if (obs.isBonus) {
        bonusPoints += obs.points;
        effectiveBonusCount++;
      } else {
        deductionPoints += obs.points;
        effectiveDeductionCount++;
      }
      weightedPoints += obs.points * obs.categoryWeight;

      // Category totals (accumulates for approved observations only).
      const cat = obs.categoryId || '_unclassified';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + obs.points;
    }
  }

  const result = computeScoreFromAdjustments({
    startScore: settings.defaultScore,
    deductions: deductionPoints,
    bonuses: bonusPoints,
    allowBonus: settings.allowBonus,
    maximumBonus: settings.maximumBonus,
    minimumScore: settings.minimumScore,
  });

  return {
    employeeId,
    score: result.score,
    deductionPoints,
    bonusPoints: result.effectiveBonus,
    weightedPoints,
    observationCount: observations.length,
    approvedCount,
    pendingCount,
    rejectedCount,
    categoryTotals,
  };
}

// ─────────────────────────────────────────────────────────────
//  Month snapshot generation
// ─────────────────────────────────────────────────────────────

/**
 * Generate an immutable month snapshot from live observations.
 *
 * This is the ONLY function that produces MonthSnapshot data. The
 * Close Month API calls this once and writes the result; it is
 * never recomputed.
 *
 * The snapshot freezes each employee's metadata (name, department,
 * position, supervisor) at close time — later transfers/promotions
 * cannot mutate historical months.
 *
 * Ranking is deterministic: employees are sorted by score descending,
 * then by employeeId ascending for tie-breaking (no random ordering).
 *
 * @param observations  - All observations for the month.
 * @param monthKey      - "2026-08" format.
 * @param employees     - Employee lookup map.
 * @param supervisorMap - Employee → supervisor mapping.
 * @param settings      - KPI settings used to compute (frozen in snapshot).
 * @returns Complete month snapshot payload (without 'id' — assigned by persistence layer).
 */
export function computeMonthSnapshot(
  observations: ObservationLike[],
  monthKey: string,
  employees: Map<string, EmployeeLike>,
  supervisorMap: SupervisorMap,
  settings: KpiSettings,
): Omit<MonthSnapshot, 'id'> {
  // Group observations by employee — single pass, Map-keyed.
  const obsByEmployee = new Map<string, ObservationLike[]>();
  for (const obs of observations) {
    const existing = obsByEmployee.get(obs.employeeId);
    if (existing) {
      existing.push(obs);
    } else {
      obsByEmployee.set(obs.employeeId, [obs]);
    }
  }

  const employeeScores: Record<string, EmployeeScoreEntry> = {};
  const deptMap = new Map<string, number[]>();

  // Compute per-employee scores — linear in employee count.
  const scoredEntries: Array<{ employeeId: string; entry: EmployeeScoreEntry }> = [];

  for (const [employeeId, empObs] of obsByEmployee) {
    const emp = employees.get(employeeId);
    const scoreResult = computeEmployeeScore(empObs, settings, employeeId);

    const dept = emp?.department || 'غير محدد';

    // Freeze employee metadata into snapshot — copied values only,
    // no references to mutable live employee objects.
    const snapshot: EmployeeSnapshot = {
      employeeId,
      employeeName: emp?.name || 'غير معروف',
      departmentId: dept,
      departmentName: dept,
      position: emp?.position || '',
      supervisorId: supervisorMap.get(employeeId) ?? null,
    };

    const entry: EmployeeScoreEntry = {
      employeeSnapshot: snapshot,
      score: scoreResult.score,
      deductionPoints: scoreResult.deductionPoints,
      bonusPoints: scoreResult.bonusPoints,
      weightedPoints: scoreResult.weightedPoints,
      observationCount: scoreResult.observationCount,
      approvedCount: scoreResult.approvedCount,
      pendingCount: scoreResult.pendingCount,
      rejectedCount: scoreResult.rejectedCount,
      categoryTotals: scoreResult.categoryTotals,
      rank: 0,
      dept,
    };

    employeeScores[employeeId] = entry;
    scoredEntries.push({ employeeId, entry });

    // Accumulate for department aggregation.
    const deptScores = deptMap.get(dept);
    if (deptScores) {
      deptScores.push(scoreResult.score);
    } else {
      deptMap.set(dept, [scoreResult.score]);
    }
  }

  // Rank employees by score descending, then by employeeId for
  // deterministic tie-breaking (never random).
  scoredEntries.sort((a, b) => {
    if (b.entry.score !== a.entry.score) return b.entry.score - a.entry.score;
    return a.employeeId.localeCompare(b.employeeId);
  });
  for (let i = 0; i < scoredEntries.length; i++) {
    scoredEntries[i].entry.rank = i + 1;
  }

  // Department aggregation.
  const departmentScores: Record<string, DepartmentScoreEntry> = {};
  for (const [dept, scores] of deptMap) {
    const sum = scores.reduce((a, b) => a + b, 0);
    departmentScores[dept] = {
      avgScore: scores.length > 0 ? Math.round(sum / scores.length) : 0,
      totalEmployees: scores.length,
      totalDeductionPoints: 0, // Filled from scoredEntries below.
      totalBonusPoints: 0,
      totalObservations: 0,
    };
  }
  // Fill totals from scored entries (second pass, still linear).
  for (const { entry } of scoredEntries) {
    const dept = entry.dept;
    const deptEntry = departmentScores[dept];
    if (deptEntry) {
      deptEntry.totalDeductionPoints += entry.deductionPoints;
      deptEntry.totalBonusPoints += entry.bonusPoints;
      deptEntry.totalObservations += entry.observationCount;
    }
  }

  // Leaderboard: top/bottom 10.
  const topEmployees: RankedEmployee[] = scoredEntries.slice(0, 10).map(({ entry }) => ({
    employeeId: entry.employeeSnapshot.employeeId,
    employeeName: entry.employeeSnapshot.employeeName,
    department: entry.dept,
    score: entry.score,
    rank: entry.rank,
  }));
  const bottomEmployees: RankedEmployee[] = scoredEntries
    .slice(-10)
    .reverse()
    .map(({ entry }) => ({
      employeeId: entry.employeeSnapshot.employeeId,
      employeeName: entry.employeeSnapshot.employeeName,
      department: entry.dept,
      score: entry.score,
      rank: entry.rank,
    }));

  // Category totals (all approved observations, not per-employee).
  const categoryTotals: Record<string, number> = {};
  for (const obs of observations) {
    if (!isApprovedKpiObs(obs) || !isValidPoints(obs.points)) continue;
    const cat = obs.categoryId || '_unclassified';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + obs.points;
  }

  // Approval stats.
  let totalApprovalRelevant = 0;
  let pending = 0;
  let approved = 0;
  let rejected = 0;
  for (const obs of observations) {
    if (!obs.applyPointDeduction) continue;
    totalApprovalRelevant++;
    if (obs.approvalStatus === 'pending') pending++;
    else if (obs.approvalStatus === 'approved') approved++;
    else if (obs.approvalStatus === 'rejected') rejected++;
  }

  const approvalStats: MonthApprovalStats = {
    total: totalApprovalRelevant,
    pending,
    approved,
    rejected,
    avgApprovalHours: 0, // Computed from timestamps when data available.
  };

  return {
    schemaVersion: 1,
    monthKey,
    status: 'closed',
    closedAt: null, // Set by the Close Month API.
    closedBy: null,
    closedByName: null,
    reopenCount: 0,
    reopenReason: '',
    auditLog: [],
    generatedAt: new Date().toISOString(),
    settingsSnapshot: settings,
    employeeScores,
    departmentScores,
    topEmployees,
    bottomEmployees,
    categoryTotals,
    approvalStats,
  };
}

// ─────────────────────────────────────────────────────────────
//  Date range resolution
// ─────────────────────────────────────────────────────────────

/**
 * Resolve month keys (YYYY-MM) for a given range preset.
 *
 * Uses the provided `now` parameter for deterministic testability.
 * Returns months in reverse chronological order (most recent first).
 *
 * Year-boundary handling:
 * - January → previous_month = previous December of the prior year.
 * - January → last_3_months includes November, December of prior year.
 * - January → current_year = January only (first month of year).
 * - December → current_year includes January through December.
 *
 * @param range - The KPI range preset.
 * @param now   - Reference date (defaults to current date; injectable for testing).
 * @returns Array of normalized "YYYY-MM" month keys, most recent first.
 */
export function resolveMonthsInRange(range: KpiRangePreset, now?: Date): string[] {
  const date = now ?? new Date();
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed

  switch (range) {
    case 'current_month':
      return [`${year}-${String(month + 1).padStart(2, '0')}`];

    case 'previous_month': {
      const prev = new Date(year, month - 1, 1);
      return [`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`];
    }

    case 'last_3_months':
      return buildMonthKeys(year, month, 3);

    case 'last_6_months':
      return buildMonthKeys(year, month, 6);

    case 'current_year':
      return buildMonthKeys(year, month, month + 1);

    case 'custom':
      // Caller provides specific months — return empty and let the API layer handle it.
      return [];

    default:
      return [`${year}-${String(month + 1).padStart(2, '0')}`];
  }
}

/** Build N month keys ending at (year, month), most recent first. */
function buildMonthKeys(year: number, month: number, count: number): string[] {
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(year, month - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
//  Trend computation (from stored snapshots only)
// ─────────────────────────────────────────────────────────────

/**
 * Compute a trend from stored monthly snapshots.
 *
 * Uses only the precomputed scores in snapshots — NEVER live
 * recalculation. The algorithm is chosen by `trendCalculation`
 * in the KPI settings.
 *
 * **Trend modes** (assumptions documented):
 *
 * - `rollingAverage`: Direction is determined by comparing the
 *   latest snapshot's average score against the rolling average of
 *   all supplied snapshots. If deviation > 3 → improving/declining.
 *   Otherwise → stable.
 *
 * - `movingScore`: Direction is determined by month-over-month delta
 *   (latest score minus previous score). If delta > 3 → improving;
 *   delta < -3 → declining; otherwise stable.
 *
 * - `simpleAverage`: Same as movingScore but with a smaller threshold
 *   of 2. If delta > 2 → improving; delta < -2 → declining;
 *   otherwise stable.
 *
 * @param snapshots - Monthly snapshots ordered most-recent first.
 * @param settings  - Current KPI settings (for trendCalculation mode).
 * @returns Trend result with direction, deltas, and sample size.
 */
export function computeTrend(
  snapshots: MonthSnapshot[],
  settings: KpiSettings,
): TrendResult {
  if (snapshots.length === 0) {
    return { direction: 'stable', momDelta: 0, rollingAverage: 0, movingScore: 0, sampleSize: 0 };
  }

  // Extract average scores from snapshots.
  const scores = snapshots.map((s) => {
    const entries = Object.values(s.employeeScores);
    if (entries.length === 0) return 0;
    const sum = entries.reduce((a, e) => a + e.score, 0);
    return Math.round(sum / entries.length);
  });

  const movingScore = scores[0];
  const momDelta = scores.length >= 2 ? scores[0] - scores[1] : 0;

  // Rolling average across all supplied snapshots.
  const rollingAverage = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  // Direction — chosen by settings.
  const direction = resolveTrendDirection(momDelta, scores, settings.trendCalculation);

  return { direction, momDelta, rollingAverage, movingScore, sampleSize: snapshots.length };
}

/** Resolve trend direction based on the configured calculation mode. */
function resolveTrendDirection(
  momDelta: number,
  scores: number[],
  mode: KpiSettings['trendCalculation'],
): TrendDirection {
  // All modes use momDelta for direction, but thresholds differ.
  switch (mode) {
    case 'simpleAverage': {
      if (momDelta > 2) return 'improving';
      if (momDelta < -2) return 'declining';
      return 'stable';
    }
    case 'movingScore': {
      if (momDelta > 3) return 'improving';
      if (momDelta < -3) return 'declining';
      return 'stable';
    }
    case 'rollingAverage':
    default: {
      // Compare latest score against rolling average.
      if (scores.length < 2) return 'stable';
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const deviation = scores[0] - avg;
      if (deviation > 3) return 'improving';
      if (deviation < -3) return 'declining';
      return 'stable';
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  Snapshot aggregation (for range-based dashboard queries)
// ─────────────────────────────────────────────────────────────

/**
 * Aggregate multiple monthly snapshots into a single summary.
 *
 * Used by the dashboard when displaying "Last 3 Months", "Last 6
 * Months", etc.
 *
 * **Aggregation behavior** (important: not every field is averaged):
 *
 * | Field                | Aggregation     | Notes                                        |
 * |----------------------|-----------------|----------------------------------------------|
 * | `avgScore`           | Average         | Mean of per-employee score entries across all months. Each employee-month entry contributes one data point. |
 * | `totalEmployees`     | Count (unique)  | Distinct employee IDs across all months.     |
 * | `totalDeductions`    | Sum             | Total deduction points across all entries.   |
 * | `totalBonuses`       | Sum             | Total bonus points across all entries.       |
 * | `categoryTotals`     | Sum             | Category points accumulated across all months. |
 *
 * @param snapshots - Monthly snapshots to aggregate.
 * @returns Aggregated summary with avg, totals, and category breakdown.
 */
export function aggregateSnapshots(snapshots: MonthSnapshot[]): {
  avgScore: number;
  totalEmployees: number;
  totalDeductions: number;
  totalBonuses: number;
  categoryTotals: Record<string, number>;
} {
  if (snapshots.length === 0) {
    return { avgScore: 0, totalEmployees: 0, totalDeductions: 0, totalBonuses: 0, categoryTotals: {} };
  }

  let totalScore = 0;
  let scoreCount = 0;
  let totalDeductions = 0;
  let totalBonuses = 0;
  const categoryTotals: Record<string, number> = {};

  // De-duplicate employees across months (an employee may appear in multiple months).
  const seenEmployees = new Set<string>();

  for (const snapshot of snapshots) {
    for (const entry of Object.values(snapshot.employeeScores)) {
      const eid = entry.employeeSnapshot.employeeId;
      totalScore += entry.score;
      totalDeductions += entry.deductionPoints;
      totalBonuses += entry.bonusPoints;
      scoreCount++;
      seenEmployees.add(eid);

      // Category totals accumulate across months.
      for (const [cat, pts] of Object.entries(entry.categoryTotals)) {
        categoryTotals[cat] = (categoryTotals[cat] || 0) + pts;
      }
    }
  }

  return {
    avgScore: scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0,
    totalEmployees: seenEmployees.size,
    totalDeductions,
    totalBonuses,
    categoryTotals,
  };
}

// ─────────────────────────────────────────────────────────────
//  Timeline derivation (from audit/approval history)
// ─────────────────────────────────────────────────────────────

/**
 * Build a chronological observation timeline from audit and approval
 * events. Delegates to the generic buildTimeline from lib/audit.
 *
 * This is the single source for the timeline view — no duplicated
 * fields needed on the observation itself.
 *
 * The conceptual sequence is:
 *   Created → Edited → Submitted → Approved/Rejected/Override →
 *   CAPA Linked → Resolved → Closed
 *
 * The timeline is derived from the existing append-only histories.
 * Results are sorted newest-first (chronologically ordered).
 *
 * @param auditLog        - Per-record audit trail (edits, status changes, etc.).
 * @param approvalHistory - Append-only approval events (submit, approve, reject, etc.).
 * @returns Sorted timeline points ready for display.
 */
export function buildObservationTimeline(
  auditLog: AuditEvent[],
  approvalHistory: ApprovalEventType[],
): ReturnType<typeof buildTimeline> {
  return buildTimeline(auditLog, approvalHistory);
}

// ─────────────────────────────────────────────────────────────
//  Performance Engine adapter (Quality → unified interface)
// ─────────────────────────────────────────────────────────────

/**
 * Convert a quality employee score into a PerformanceFactor
 * for the future unified Performance Engine.
 *
 * The Quality KPI module is the first consumer; future modules
 * (Attendance, Productivity, etc.) will expose the same interface.
 *
 * This is an adapter/interface only — it does NOT build the
 * Performance Engine, Attendance KPI, Sales KPI, HR KPI, or
 * Travel KPI. Those are future work.
 *
 * @param scoreResult - The computed employee score from computeEmployeeScore.
 * @param maxScore    - The maximum possible score (default 100).
 * @returns A PerformanceFactor exposing { score, maxScore, weight, breakdown }.
 */
export function qualityToPerformanceFactor(
  scoreResult: EmployeeScoreResult,
  maxScore: number = 100,
): PerformanceFactor {
  return toPerformanceFactor(
    'quality',
    'الجودة',
    {
      score: scoreResult.score,
      deductions: scoreResult.deductionPoints,
      effectiveBonus: scoreResult.bonusPoints,
      rawBonus: scoreResult.bonusPoints,
      bonusCapped: false,
    },
    1, // default weight in unified engine
    scoreResult.categoryTotals,
  );
}
