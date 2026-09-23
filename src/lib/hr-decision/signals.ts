// ══════════════════════════════════════════════════════════════
//  HR Decision-Support — Deterministic signal extraction
//
//  PURE functions over ALREADY-LOADED canonical data:
//    • KPI trend counters derived from the dataset's canonical
//      trend points (verbatim scores — never recomputed).
//    • Follow-up window statistics (current open state by priority
//      + overdue-by-month recurrence) using the CANONICAL status /
//      overdue helpers (lib/metrics/followUpMetrics).
//    • CAPA risk statistics using the CANONICAL helpers
//      (lib/metrics/capaMetrics).
//    • The canonical RiskInput for computeRisk() — the EXISTING
//      risk engine (lib/metrics/riskMetrics) is reused verbatim;
//      no second risk formula is introduced here.
//    • Repeated-issue recurrence via the CANONICAL detector
//      (lib/repetition-detection — same follow-up-type-within-30-days
//      rule the risk vocabulary defines).
// ══════════════════════════════════════════════════════════════

import type { CAPACase, FollowUp } from '@/types';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import type { EmployeeHrMonthSummary } from '@/lib/employee-performance';
import type { RiskInput } from '@/lib/metrics/riskMetrics';
import { isActiveFollowUp, isOverdueFollowUp } from '@/lib/metrics/followUpMetrics';
import { isOverdueCAPA, TERMINAL_CAPA_STATUSES } from '@/lib/metrics/capaMetrics';
import { detectRepetitions } from '@/lib/repetition-detection';
import { monthOfFollowUp } from '@/lib/performance-intelligence';

// ─────────────────────────────────────────────────────────────
//  KPI trend counters (canonical trend points → decision counters)
// ─────────────────────────────────────────────────────────────

export interface KpiTrendCounters {
  /** The period's canonical quality raw score (null = no result — never 0). */
  currentScore: number | null;
  /** True ONLY when a score exists AND it is below the configured target. */
  belowTarget: boolean;
  /** Window months WITH a comparable score. */
  monthsWithScore: number;
  /** Consecutive below-target months ENDING at the reported period
   *  (an unavailable month breaks the run — continuity is never assumed). */
  consecutiveBelowTarget: number;
  /** Consecutive strictly-declining steps ENDING at the reported period. */
  consecutiveDecliningSteps: number;
  /** Deterministic window direction (canonical MoM derivation). */
  direction: 'UP' | 'DOWN' | 'STABLE' | null;
  /** MoM delta in percentage points (null when not comparable). */
  momDeltaPoints: number | null;
}

/**
 * Derive the KPI decision counters from the dataset's canonical
 * trend points. PURE — scores are read verbatim; a missing score is
 * never treated as 0 and never breaks a below-target judgment.
 */
export function buildKpiTrendCounters(
  dataset: EmployeePerformanceDataset,
  targetScore: number,
): KpiTrendCounters {
  const points = dataset.trend.points;
  const last = points.length > 0 ? points[points.length - 1] : undefined;
  const currentScore = last && last.available && last.rawScore !== null ? last.rawScore : null;

  const scored = points.filter((p) => p.available && p.rawScore !== null);
  const monthsWithScore = scored.length;

  // Consecutive below-target run ending at the LAST window month
  // that has a score. The reported month is the window's end; when
  // it has no score there is no current judgment at all.
  let consecutiveBelowTarget = 0;
  if (currentScore !== null) {
    for (let i = points.length - 1; i >= 0; i -= 1) {
      const p = points[i];
      if (!p.available || p.rawScore === null) break;
      if (p.rawScore < targetScore) consecutiveBelowTarget += 1;
      else break;
    }
  }

  // Consecutive strictly-declining steps ending at the current score.
  let consecutiveDecliningSteps = 0;
  if (currentScore !== null) {
    for (let i = points.length - 1; i >= 1; i -= 1) {
      const cur = points[i];
      const prev = points[i - 1];
      if (!cur.available || cur.rawScore === null || !prev.available || prev.rawScore === null) break;
      if (cur.rawScore < prev.rawScore) consecutiveDecliningSteps += 1;
      else break;
    }
  }

  return {
    currentScore,
    belowTarget: currentScore !== null && currentScore < targetScore,
    monthsWithScore,
    consecutiveBelowTarget,
    consecutiveDecliningSteps,
    direction: dataset.trend.direction,
    momDeltaPoints: dataset.trend.mom?.deltaPoints ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
//  Follow-up window statistics (canonical helpers only)
// ─────────────────────────────────────────────────────────────

export interface FollowUpWindowStats {
  /** Current-state OPEN follow-ups by priority (risk-center parity). */
  activeByPriority: { low: number; medium: number; high: number; critical: number };
  /** Σ activeByPriority. */
  activeTotal: number;
  /** Window months (ascending) containing ≥1 overdue follow-up. */
  overdueMonths: string[];
  /** Canonical repeated-issue alerts over the follow-up types (30-day rule). */
  repeatedIssueAlertCount: number;
}

/**
 * Build the follow-up decision statistics from raw records.
 * PURE + injectable clock. Uses ONLY canonical helpers:
 *   • isActiveFollowUp / isOverdueFollowUp (lib/metrics/followUpMetrics)
 *   • monthOfFollowUp (the canonical attribution policy)
 *   • detectRepetitions (the canonical repetition detector)
 */
export function buildFollowUpWindowStats(
  followUps: ReadonlyArray<FollowUp>,
  windowMonths: ReadonlyArray<string>,
  now: Date,
): FollowUpWindowStats {
  const windowSet = new Set(windowMonths);
  const activeByPriority = { low: 0, medium: 0, high: 0, critical: 0 };
  const overdueMonthSet = new Set<string>();

  for (const f of followUps) {
    if (!f) continue;
    if (isActiveFollowUp(f)) {
      const priority = f.priorityLevel ?? 'medium';
      if (priority in activeByPriority) activeByPriority[priority as keyof typeof activeByPriority] += 1;
      if (isOverdueFollowUp(f, now)) {
        const month = monthOfFollowUp(f);
        if (month && windowSet.has(month)) overdueMonthSet.add(month);
      }
    }
  }

  const repetitions = detectRepetitions(
    followUps.map((f) => {
      const month = monthOfFollowUp(f);
      return {
        id: f.id,
        employeeId: f.employeeId,
        issueKey: f.followUpType || '_unclassified',
        issueLabel: f.followUpType || '',
        day: month ? `${month}-01` : '',
        source: 'followUp' as const,
      };
    }),
    now,
  );

  return {
    activeByPriority,
    activeTotal: activeByPriority.low + activeByPriority.medium + activeByPriority.high + activeByPriority.critical,
    overdueMonths: [...overdueMonthSet].sort(),
    repeatedIssueAlertCount: repetitions.length,
  };
}

// ─────────────────────────────────────────────────────────────
//  CAPA risk statistics (canonical helpers only)
// ─────────────────────────────────────────────────────────────

export interface CapaRiskStats {
  openCapaCount: number;
  overdueCapaCount: number;
  criticalCapaCount: number;
  reopenedCapaCount: number;
}

/**
 * CAPA counts for the canonical RiskInput — the same semantics the
 * risk consumers use: open = non-terminal status, overdue computed
 * at read time (never the stale stored field), critical = open AND
 * critical priority, reopened = the stored 'reopened' status.
 * PURE + injectable clock.
 */
export function buildCapaRiskStats(
  capaCases: ReadonlyArray<CAPACase>,
  now: Date,
): CapaRiskStats {
  const stats: CapaRiskStats = { openCapaCount: 0, overdueCapaCount: 0, criticalCapaCount: 0, reopenedCapaCount: 0 };
  for (const c of capaCases) {
    if (!c) continue;
    const terminal = (TERMINAL_CAPA_STATUSES as readonly string[]).includes(c.status);
    if (!terminal) {
      stats.openCapaCount += 1;
      if (c.priority === 'critical') stats.criticalCapaCount += 1;
      if (isOverdueCAPA(c, now)) stats.overdueCapaCount += 1;
    }
    if (c.status === 'reopened') stats.reopenedCapaCount += 1;
  }
  return stats;
}

// ─────────────────────────────────────────────────────────────
//  The canonical RiskInput (existing engine reused verbatim)
// ─────────────────────────────────────────────────────────────

/**
 * Assemble the RiskInput for the CANONICAL computeRisk() call.
 *
 * Scope documentation (deterministic, test-pinned):
 *   • attendance delay/absence — the STORED monthly result for the
 *     reported period (0 only because computeRisk takes counts;
 *     the dimension's own availability stays explicit in the
 *     scorecard, and a NOT_AVAILABLE month contributes NO factor).
 *   • quality / hr deduction COUNTS — effective records attributed
 *     to the reported period (dataset + hr month summary).
 *   • follow-ups — CURRENT open state by priority + overdue
 *     recurrence, from the window stats (risk-center parity).
 *   • complaints — period records still open (dataset facts).
 *   • repeated issues — the canonical 30-day follow-up-type rule.
 *   • CAPA — current open/overdue/critical/reopened state.
 */
export function buildDecisionRiskInput(args: {
  dataset: EmployeePerformanceDataset;
  hrMonth: EmployeeHrMonthSummary | null;
  followUpStats: FollowUpWindowStats;
  capaStats: CapaRiskStats;
}): RiskInput {
  const { dataset, hrMonth, followUpStats, capaStats } = args;
  const attendance = dataset.attendance.status === 'AVAILABLE' ? dataset.attendance.result : null;
  return {
    delayCount: attendance ? attendance.lateDays : 0,
    absenceCount: attendance ? attendance.absentDays : 0,
    qualityCount: dataset.quality.deductions.count,
    hrCount: hrMonth ? hrMonth.deductionCount : 0,
    openFollowUpCount: followUpStats.activeTotal,
    highPriorityFollowUpCount: followUpStats.activeByPriority.high,
    criticalFollowUpCount: followUpStats.activeByPriority.critical,
    openComplaintCount: dataset.complaints.stillOpen,
    repeatedIssueCount: followUpStats.repeatedIssueAlertCount,
    openCapaCount: capaStats.openCapaCount,
    overdueCapaCount: capaStats.overdueCapaCount,
    criticalCapaCount: capaStats.criticalCapaCount,
    reopenedCapaCount: capaStats.reopenedCapaCount,
  };
}
