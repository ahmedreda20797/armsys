// ══════════════════════════════════════════════════════════════
//  GET /api/kpi-reports/diagnose — KPI visibility trace (Phase 6.3)
//
//  READ-ONLY diagnostic for spec §33-§37: why does an employee (not)
//  appear in the KPI reports for a month? Walks the exact reporting
//  chain with the SAME loaders the reports use and reports the FIRST
//  layer where the employee drops out.
//
//  Thin route (project convention): authenticate → authorize →
//  resolve the AUTHORIZED scope (M0.5) → run the trace.
//
//  ANTI-ENUMERATION (Phase 6.1 doctrine): an employeeId outside the
//  caller's scope gets the SAME generic "not found" answer as a
//  nonexistent id — the endpoint never confirms the existence of an
//  out-of-scope employee. Layer details are returned for in-scope
//  (or unrestricted) callers only.
//
//  Query parameters:
//    month      (required, YYYY-MM)
//    employeeId (required)
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
import { defaultKpiReportingLoaders } from '@/lib/kpi-reporting/loaders';
import { traceEmployeeKpiVisibility } from '@/lib/kpi-reporting/visibility-trace';

/** Generic answer for unknown OR out-of-scope ids (no existence leak). */
const NOT_FOUND_ANSWER = {
  found: false,
  verdict: 'لا توجد معلومات عن هذا الموظف في نطاقك لهذه الفترة.',
} as const;

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

    const employeeId = searchParams.get('employeeId') ?? '';
    if (!employeeId || employeeId.length > 128) {
      return validationError('معرّف الموظف مطلوب');
    }

    // ── Authorized scope (M0.5) — the SAME engine the reports use ──
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user),
      undefined,
      permCheck.user.permissions,
    );
    const unrestricted = scopeCtx.isUnrestricted;
    const inScope = unrestricted || scopeCtx.employeeIds.has(employeeId);
    if (!inScope) {
      // Fail closed WITHOUT revealing whether the id exists at all.
      return Response.json({ monthKey: month, employeeId, ...NOT_FOUND_ANSWER });
    }

    const trace = await traceEmployeeKpiVisibility(
      { monthKey: month!, employeeId },
      defaultKpiReportingLoaders,
      { inScope: true, unrestricted },
    );

    return Response.json({ found: true, ...trace });
  } catch (error) {
    logServerFailure('kpi-reports-diagnose', 'GET', error);
    return internalError();
  }
}
