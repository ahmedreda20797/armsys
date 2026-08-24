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
//  Permission (M0.2): authentication + 'kpiDashboard' view — the SAME
//  page key the frontend router/sidebar checks (visiblePages ↔
//  PageRouter ↔ API). A user whose effective kpiDashboard level is
//  'none' cannot retrieve dashboard data directly through the API.
//  Admin bypass unchanged (inside verifyPermission).
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
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  unauthorizedError, forbiddenError, validationError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { getKpiDashboard } from '@/lib/kpi-dashboard';
import { authScopeViewer, resolveEmployeeScopeFromDb } from '@/lib/scope/server';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    // M0.2: KPI dashboard data is gated by the existing 'kpiDashboard'
    // page permission (view = read or edit level). No new permission key.
    const permCheck = await verifyPermission(request, 'kpiDashboard', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { searchParams } = new URL(request.url);
    const range = searchParams.get('range') || 'current_month';
    const customMonths = searchParams.get('customMonths');
    const department = searchParams.get('department');
    const employeeId = searchParams.get('employeeId');

    // M0.5 read scope: resolve the caller's authorized employee set from
    // the canonical scope engine and hand it to the service, which
    // intersects every snapshot BEFORE aggregation (leaderboards,
    // department rankings, category totals, approval stats all derive
    // from authorized entries only). Unrestricted viewers (Admin, HR,
    // Quality) pass null — the service then skips the restriction
    // entirely (established behavior, zero added cost).
    const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
    const authorizedEmployeeIds = scopeCtx.isUnrestricted ? null : scopeCtx.employeeIds;

    const { response, error } = await getKpiDashboard(range, {
      customMonths,
      filters: {
        department: department || null,
        employeeId: employeeId || null,
        authorizedEmployeeIds,
      },
    });

    if (error) return validationError(error);

    return Response.json(response);
  } catch (error) {
    logServerFailure('kpi-dashboard', 'GET', error);
    return internalError();
  }
}
