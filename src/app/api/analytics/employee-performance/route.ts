// ══════════════════════════════════════════════════════════════
//  GET /api/analytics/employee-performance — Analytics (Phase 5.3)
//
//  Deterministic statistical analysis over the VERIFIED
//  EmployeePerformanceDataset. This route is a thin, read-only
//  shell around two existing components:
//    1. getEmployeePerformanceDataset — the SINGLE source of the
//       analytical dataset (no second query path, no
//       reconstruction — spec §1/§3).
//    2. runEmployeeAnalytics — the in-process TypeScript engine
//       (Phase 5.3: NO Python runtime, no subprocess, no remote
//       service — the analytics engine lives in this deployment).
//
//  SECURITY (spec §30): authorization happens BEFORE any employee
//  data is fetched or analyzed — same JWT + kpiReports
//  permission + employee-scope doctrine as the Performance
//  Intelligence route (404 anti-enumeration for out-of-scope ids).
//
//  FAILURE ISOLATION (spec §27/§28): a failing analytics run is an
//  explicit 200 response with an ANALYTICS_ERROR status — never a
//  crash, never a silent zero, and never a dependency for any
//  other page.
//
//  READ-ONLY (spec §4): this route performs no writes anywhere.
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
import { monthKeyOf } from '@/lib/kpi-reporting/period-basis';
import { asScopeViewer, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import {
  getEmployeePerformanceDataset,
  DEFAULT_WINDOW_MONTHS,
  MAX_WINDOW_MONTHS,
  MIN_WINDOW_MONTHS,
} from '@/lib/performance-intelligence';
import {
  analyticsApiResponseBody,
  runEmployeeAnalytics,
  type AnalyticsServiceOutcome,
} from '@/lib/analytics/service';

export async function GET(request: NextRequest) {
  try {
    // ── Authentication (JWT Bearer — existing doctrine) ──
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    // ── Permission: same key as KPI Reports / Smart Quality Report ──
    const permCheck = await verifyPermission(request, 'kpiReports', 'view');
    if (!permCheck.allowed || !permCheck.user) {
      return forbiddenError(permCheck.error);
    }

    // ── Query params (same conventions as /api/performance-intelligence) ──
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId')?.trim() ?? '';
    if (!employeeId) {
      return validationError('employeeId مطلوب');
    }

    const monthParam = searchParams.get('month');
    const month = monthParam ?? monthKeyOf(new Date());
    const monthError = validateMonthKey(month);
    if (monthError) return validationError(monthError);

    const windowParam = Number(searchParams.get('windowMonths'));
    if (Number.isFinite(windowParam) && windowParam >= 1 &&
        (windowParam < MIN_WINDOW_MONTHS || windowParam > MAX_WINDOW_MONTHS)) {
      return validationError(
        `windowMonths يجب أن يكون بين ${MIN_WINDOW_MONTHS} و ${MAX_WINDOW_MONTHS}`,
      );
    }
    const windowMonths = Number.isFinite(windowParam) && windowParam >= 1
      ? Math.min(Math.floor(windowParam), MAX_WINDOW_MONTHS)
      : DEFAULT_WINDOW_MONTHS;

    const minOccParam = Number(searchParams.get('minOccurrences'));
    const minOccurrences = Number.isFinite(minOccParam) && minOccParam >= 2
      ? Math.floor(minOccParam)
      : 2;

    // ── Employee scope on the TARGET (fail-closed 404, anti-enumeration) ──
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user), undefined, permCheck.user.permissions,
    );
    if (!scopeCtx.isUnrestricted && !scopeCtx.includes(employeeId)) {
      return notFoundError('الموظف غير موجود');
    }

    // ── ONE dataset from the existing verified service ──
    const dataset = await getEmployeePerformanceDataset({
      employeeId,
      monthKey: month,
      windowMonths,
      minOccurrences,
    });
    if (!dataset) return notFoundError('الموظف غير موجود');

    // ── Authorized data → in-process TypeScript engine (never throws) ──
    const outcome: AnalyticsServiceOutcome = await runEmployeeAnalytics(dataset);
    if (!outcome.ok) {
      // Contract/engine failures are logged for observability without
      // leaking payload data; the client still gets an explicit 200.
      logServerFailure('analytics-employee-performance', 'GET',
        new Error(`analytics: ${outcome.reason}`),
        { reason: outcome.reason });
    }
    return Response.json(analyticsApiResponseBody(outcome));
  } catch (error) {
    logServerFailure('analytics-employee-performance', 'GET', error);
    return internalError();
  }
}
