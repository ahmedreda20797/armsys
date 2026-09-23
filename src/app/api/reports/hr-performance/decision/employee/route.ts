// ══════════════════════════════════════════════════════════════
//  GET /api/reports/hr-performance/decision/employee — one employee's
//  HR decision-support report (the drill-down behind the team view).
//
//  Same authorization chain as the team route; the requested employee
//  must lie INSIDE the caller's authorized scope (fail-closed 404 —
//  parity with /api/analytics/employee-performance: an out-of-scope
//  employee is indistinguishable from a missing one).
//
//  The response is the sanitized HR-safe projection ONLY — no
//  observation text, no deduction reasons, no complaint/CAPA detail,
//  no evidence records, no component math.
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
import { resolveReportAudience } from '@/lib/report-audience';
import { getHrEmployeeDecisionReport } from '@/lib/hr-decision';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'reports', 'view');
    if (!permCheck.allowed || !permCheck.user) {
      return forbiddenError(permCheck.error);
    }

    const audience = resolveReportAudience({
      role: permCheck.user.role,
      permissions: permCheck.user.permissions,
    });

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const monthError = validateMonthKey(month);
    if (monthError) return validationError(monthError);

    const employeeId = searchParams.get('employeeId') ?? '';
    if (!employeeId) return validationError('معرّف الموظف مطلوب');

    const windowMonthsParam = Number(searchParams.get('windowMonths') ?? '');
    const windowMonths = Number.isFinite(windowMonthsParam) && windowMonthsParam >= 1
      ? Math.min(36, Math.trunc(windowMonthsParam))
      : undefined;

    // ── Authorized scope (M0.5): out-of-scope → 404 (fail-closed) ──
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user),
      undefined,
      permCheck.user.permissions,
    );
    if (!scopeCtx.isUnrestricted && !scopeCtx.includes(employeeId)) {
      return notFoundError('الموظف غير موجود');
    }

    const report = await getHrEmployeeDecisionReport({
      employeeId,
      monthKey: month!,
      windowMonths,
    });
    if (!report) return notFoundError('الموظف غير موجود');

    return Response.json({ ...report, resolvedAudience: audience });
  } catch (error) {
    logServerFailure('reports-hr-decision-employee', 'GET', error);
    return internalError();
  }
}
