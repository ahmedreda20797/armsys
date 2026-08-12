// ══════════════════════════════════════════════════════════════
//  /api/kpi-dashboard  (Milestone 6A)
//
//  GET — KPI dashboard summary for a given range.
//
//  THIN route: authenticates, parses the query string, delegates to the
//  KPI Dashboard service (src/lib/kpi-dashboard.ts), which in turn reads
//  FROZEN snapshots for closed months and LIVE-COMPUTES only the current
//  open month via the canonical KPI engine. No score/trend/ranking
//  formula lives here.
//
//  Permission: requireAuth (any authenticated user may view the dashboard;
//  finer-grained page visibility is handled by the router/permissions layer).
//
//  Query params (established convention — reused, not reinvented):
//    ?range=current_month|previous_month|last_3_months|last_6_months|current_year|custom
//    &customMonths=2026-07,2026-06  (only when range=custom; strict YYYY-MM)
//    &department=...                 (optional department filter)
//    &employeeId=...                 (optional employee filter)
//
//  Response contract: see KpiDashboardResponse in src/lib/kpi-dashboard.ts.
//  Established field names (avgScore, categoryDistribution …) are preserved
//  for backward compatibility; Milestone 6 ADDS isLive, departmentRanking,
//  approvalStats and monthlyScores.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/verify-permission';
import {
  unauthorizedError, validationError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { getKpiDashboard } from '@/lib/kpi-dashboard';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || 'current_month';
    const customMonths = searchParams.get('customMonths');
    const department = searchParams.get('department');
    const employeeId = searchParams.get('employeeId');

    const { response, error } = await getKpiDashboard(range, {
      customMonths,
      filters: {
        department: department || null,
        employeeId: employeeId || null,
      },
    });

    if (error) return validationError(error);

    return Response.json(response);
  } catch (error) {
    logServerFailure('kpi-dashboard', 'GET', error);
    return internalError();
  }
}
