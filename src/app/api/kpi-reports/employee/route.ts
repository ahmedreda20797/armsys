// ══════════════════════════════════════════════════════════════
//  GET /api/kpi-reports/employee — Employee KPI Report (Phase 2)
//
//  Thin route: authenticate → authorize → AUTHORIZED scope check on
//  the requested employee (fail-closed 404, anti-enumeration) →
//  delegate to the kpi-reporting service.
//
//  Query parameters:
//    employeeId  (required)
//    month       (required, YYYY-MM)
//    trendMonths (optional, default 6, clamped 1..36)
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError,
  internalError,
  logServerFailure,
  notFoundError,
  unauthorizedError,
  validationError,
} from '@/lib/api-error';
import { validateMonthKey } from '@/lib/month-utils';
import { asScopeViewer, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { buildEmployeeKpiReport } from '@/lib/kpi-reporting';
import { technicalReportAudienceGuard } from '@/lib/report-audience/server-guard';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'kpiReports', 'view');
    if (!permCheck.allowed || !permCheck.user) {
      return forbiddenError(permCheck.error);
    }

    // ── Report-audience guard (Qnalys audience model): technical
    //    detail leaves the server for TECHNICAL audiences only. HR /
    //    TEAM_LEADER callers are directed to their own audience
    //    report (/api/reports/hr-performance) — enforced HERE, not
    //    hidden in a frontend.
    const audienceRejection = technicalReportAudienceGuard(permCheck.user);
    if (audienceRejection) return audienceRejection;

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    if (!employeeId) return validationError('معرّف الموظف مطلوب');

    const month = searchParams.get('month');
    const monthError = validateMonthKey(month);
    if (monthError) return validationError(monthError);

    const trendMonthsRaw = searchParams.get('trendMonths');
    const trendMonths = trendMonthsRaw === null ? undefined : Number(trendMonthsRaw);
    if (trendMonths !== undefined && !Number.isFinite(trendMonths)) {
      return validationError('عدد أشهر الاتجاه غير صالح');
    }

    // ── Authorized scope on the TARGET employee (fail-closed 404) ──
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user),
      undefined,
      permCheck.user.permissions,
    );
    if (!scopeCtx.isUnrestricted && !scopeCtx.includes(employeeId!)) {
      // Anti-enumeration: out-of-scope employees "do not exist".
      return notFoundError('الموظف غير موجود');
    }

    const report = await buildEmployeeKpiReport({
      employeeId: employeeId!,
      monthKey: month!,
      trendMonths: trendMonths === undefined ? undefined : Math.trunc(trendMonths),
    });

    if (report.outcomeStatus === 'EMPLOYEE_NOT_FOUND') {
      return notFoundError('الموظف غير موجود');
    }

    return Response.json(report);
  } catch (error) {
    logServerFailure('kpi-reports-employee', 'GET', error);
    return internalError();
  }
}
