// ══════════════════════════════════════════════════════════════
//  GET /api/kpi-reports/summary — Quality KPI Management Summary
//
//  Concise management-level statistics for one period (spec §15).
//  The payload carries `statisticsKind: 'QUALITY_KPI'` + an explicit
//  Arabic label — these are QUALITY KPI statistics and must never be
//  presented as company-wide KPI statistics while only Quality is
//  available.
//
//  Query parameters: month (required, YYYY-MM)
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError,
  internalError,
  logServerFailure,
  unauthorizedError,
  validationError,
} from '@/lib/api-error';
import { validateMonthKey } from '@/lib/month-utils';
import { asScopeViewer, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { buildKpiManagementSummary } from '@/lib/kpi-reporting';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'kpiReports', 'view');
    if (!permCheck.allowed || !permCheck.user) {
      return forbiddenError(permCheck.error);
    }

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const monthError = validateMonthKey(month);
    if (monthError) return validationError(monthError);

    // ── Authorized employee scope (M0.5) — scoped statistics ──
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user),
      undefined,
      permCheck.user.permissions,
    );
    const scopeLimit = scopeCtx.isUnrestricted ? null : [...scopeCtx.employeeIds];

    const summary = await buildKpiManagementSummary({
      monthKey: month!,
      filters: { scopeLimit },
    });

    return Response.json(summary);
  } catch (error) {
    logServerFailure('kpi-reports-summary', 'GET', error);
    return internalError();
  }
}
