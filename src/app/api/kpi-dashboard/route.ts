// ══════════════════════════════════════════════════════════════
//  /api/kpi-dashboard
//
//  GET — KPI dashboard summary for a given range.
//
//  Returns aggregated scores, trends, department rankings, top/bottom
//  employees, pending approvals, and category distribution.
//
//  The dashboard reads PRECOMPUTED snapshots for closed months and
//  LIVE-COMPUTES only for the current open month.
//
//  Permission: requireAuth.
//  Query params:
//    ?range=current_month|previous_month|last_3_months|last_6_months|current_year
//    &customMonths=2026-07,2026-06  (only when range=custom)
//    &department=...                (optional department filter)
//    &employeeId=...                 (optional employee filter)
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, getById, TTL } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import {
  unauthorizedError, validationError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { getKpiSettings } from '@/lib/kpi-settings';
import { MONTH_SNAPSHOTS_TABLE } from '@/lib/month-lock';
import {
  resolveMonthsInRange,
  aggregateSnapshots,
  computeTrend,
  computeEmployeeScore,
  isApprovedKpiObs,
  isPendingApprovalObs,
} from '@/lib/metrics/kpiMetrics';
import type {
  KpiRangePreset,
  KpiSettings,
  MonthSnapshot,
  QualityObservation,
  PerformanceFactor,
  EmployeeScoreResult,
} from '@/types/quality-kpi';
import type { Employee } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const { searchParams } = new URL(request.url);
    const rangeParam = (searchParams.get('range') || 'current_month') as KpiRangePreset;
    const customMonthsParam = searchParams.get('customMonths');
    const department = searchParams.get('department');
    const employeeId = searchParams.get('employeeId');

    // Resolve month keys for the requested range.
    let monthKeys: string[];
    if (rangeParam === 'custom' && customMonthsParam) {
      monthKeys = customMonthsParam.split(',').map((m) => m.trim()).filter(Boolean);
    } else {
      monthKeys = resolveMonthsInRange(rangeParam);
    }

    if (monthKeys.length === 0) {
      return validationError('لم يتم تحديد أشهر للعرض');
    }

    const settings = await getKpiSettings();

    // ── Load snapshots for all requested months ──
    const snapshots: MonthSnapshot[] = [];
    const currentMonthKey = monthKeys[0]; // most recent first

    for (const mk of monthKeys) {
      const snap = await getById<MonthSnapshot>(MONTH_SNAPSHOTS_TABLE, mk);
      if (snap && snap.status === 'closed') {
        snapshots.push(snap);
      }
    }

    // ── If the current month is not closed, live-compute it ──
    const currentSnapshotExists = snapshots.some((s) => s.monthKey === currentMonthKey);
    let liveScores: EmployeeScoreResult[] | null = null;

    if (!currentSnapshotExists) {
      const allObs = await getAll<QualityObservation>('qualityObservations', TTL.MEDIUM);
      const monthObs = allObs.filter((o) => o.month === currentMonthKey);

      if (department) {
        // Server-side department filter.
        const employees = await getAll<Employee>('employees', TTL.STATIC);
        const deptEmployeeIds = new Set(
          employees.filter((e) => e.department === department).map((e) => e.id),
        );
        // For live computation, we need employee names.
        const empMap = new Map(employees.map((e) => [e.id, e]));
        liveScores = [];
        const byEmployee = new Map<string, QualityObservation[]>();
        for (const o of monthObs) {
          if (!deptEmployeeIds.has(o.employeeId)) continue;
          const arr = byEmployee.get(o.employeeId);
          if (arr) arr.push(o); else byEmployee.set(o.employeeId, [o]);
        }
        for (const [eid, obs] of byEmployee) {
          liveScores.push(computeEmployeeScore(obs, settings, eid));
        }
      } else if (employeeId) {
        const empObs = monthObs.filter((o) => o.employeeId === employeeId);
        liveScores = empObs.length > 0
          ? [computeEmployeeScore(empObs, settings, employeeId)]
          : [];
      } else {
        const byEmployee = new Map<string, QualityObservation[]>();
        for (const o of monthObs) {
          const arr = byEmployee.get(o.employeeId);
          if (arr) arr.push(o); else byEmployee.set(o.employeeId, [o]);
        }
        liveScores = [];
        for (const [eid, obs] of byEmployee) {
          liveScores.push(computeEmployeeScore(obs, settings, eid));
        }
      }
    }

    // ── Aggregate closed snapshots ──
    const allMonthKeys = new Set(monthKeys);
    const closedInRange = snapshots.filter((s) => allMonthKeys.has(s.monthKey));

    // If department/employee filter, filter snapshot entries.
    let filteredSnapshots = closedInRange;
    if (department) {
      filteredSnapshots = closedInRange.map((snap) => ({
        ...snap,
        employeeScores: Object.fromEntries(
          Object.entries(snap.employeeScores).filter(
            ([, entry]) => entry.employeeSnapshot.departmentName === department
              || entry.dept === department,
          ),
        ),
        departmentScores: Object.fromEntries(
          Object.entries(snap.departmentScores).filter(
            ([dept]) => dept === department,
          ),
        ),
      }));
    }
    if (employeeId) {
      filteredSnapshots = closedInRange.map((snap) => ({
        ...snap,
        employeeScores: Object.fromEntries(
          Object.entries(snap.employeeScores).filter(
            ([eid]) => eid === employeeId,
          ),
        ),
      }));
    }

    const aggregation = aggregateSnapshots(filteredSnapshots);

    // Merge live scores into the aggregation (current month not yet closed).
    if (liveScores && liveScores.length > 0) {
      let liveTotal = 0;
      let liveDeductions = 0;
      let liveBonuses = 0;
      for (const s of liveScores) {
        liveTotal += s.score;
        liveDeductions += s.deductionPoints;
        liveBonuses += s.bonusPoints;
      }
      // Simple merge: add live counts to closed aggregation.
      const combinedScoreCount =
        (aggregation.totalEmployees || 0) > 0
          ? aggregation.totalEmployees + liveScores.length
          : liveScores.length;
      const combinedAvg =
        combinedScoreCount > 0
          ? Math.round(
              (aggregation.avgScore * (aggregation.totalEmployees || 0) + liveTotal)
              / combinedScoreCount,
            )
          : Math.round(liveTotal / liveScores.length);

      aggregation.avgScore = combinedAvg;
      aggregation.totalEmployees = combinedScoreCount;
      aggregation.totalDeductions += liveDeductions;
      aggregation.totalBonuses += liveBonuses;
    }

    // ── Trend (from stored snapshots only) ──
    const trend = computeTrend(closedInRange.sort((a, b) => b.monthKey.localeCompare(a.monthKey)), settings);

    // ── Top/bottom employees across all months ──
    const topEmployees = closedInRange.flatMap((s) => s.topEmployees || []);
    const bottomEmployees = closedInRange.flatMap((s) => s.bottomEmployees || []);

    // ── Pending approvals for the current month ──
    let pendingApprovals = 0;
    if (!currentSnapshotExists) {
      const allObs = await getAll<QualityObservation>('qualityObservations', TTL.MEDIUM);
      const currentObs = allObs.filter((o) => o.month === currentMonthKey);
      pendingApprovals = currentObs.filter((o) => isPendingApprovalObs(o)).length;
    } else {
      // Use snapshot approval stats.
      const currentSnap = closedInRange.find((s) => s.monthKey === currentMonthKey);
      if (currentSnap) pendingApprovals = currentSnap.approvalStats?.pending ?? 0;
    }

    // ── Category distribution (accumulated from snapshots) ──
    const categoryDistribution: Record<string, number> = { ...aggregation.categoryTotals };

    // ── Performance Engine adapter ──
    const performanceFactor: PerformanceFactor = {
      factorId: 'quality',
      factorName: 'الجودة',
      score: aggregation.avgScore,
      maxScore: settings.defaultScore,
      weight: 1,
      normalized: settings.defaultScore > 0 ? aggregation.avgScore / settings.defaultScore : 0,
      breakdown: categoryDistribution,
    };

    return Response.json({
      range: rangeParam,
      months: monthKeys,
      avgScore: aggregation.avgScore,
      totalEmployees: aggregation.totalEmployees,
      totalDeductions: aggregation.totalDeductions,
      totalBonuses: aggregation.totalBonuses,
      trend,
      topEmployees,
      bottomEmployees,
      pendingApprovals,
      categoryDistribution,
      performanceFactor,
      settings: {
        defaultScore: settings.defaultScore,
        minimumScore: settings.minimumScore,
        allowBonus: settings.allowBonus,
        maximumBonus: settings.maximumBonus,
      },
    });
  } catch (error) {
    logServerFailure('kpi-dashboard', 'GET', error);
    return internalError();
  }
}
