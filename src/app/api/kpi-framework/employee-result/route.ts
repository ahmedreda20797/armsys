// ══════════════════════════════════════════════════════════════
//  /api/kpi-framework/employee-result
//
//  GET ?employeeId=&month= — the company-KPI result for one employee
//  over one month (kpiDashboard view + existing employee scope).
//
//  Response (200 even for "no result" outcomes — the STATUS is the
//  data; no fabricated numbers):
//    {
//      employeeId, month,
//      status: 'FROZEN_RESULT' | 'RESOLVED' | 'EMPLOYEE_NOT_FOUND'
//            | 'NOT_ELIGIBLE_PERIOD' | 'NO_SCHEME' | 'AMBIGUOUS'
//            | 'OVERRIDE_NOT_RESOLVABLE',
//      resolution: KpiSchemeResolution | null,
//      result: EmployeeKpiResult | null
//    }
//
//  Employee NOT found → 404 (anti-enumeration, same as
//  /api/employee-performance). Out-of-scope employee → 404.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  validationError, forbiddenError, unauthorizedError, notFoundError, internalError, logServerFailure,
} from '@/lib/api-error';
import { computeEmployeeKpiResult } from '@/lib/kpi-framework';
import { validateMonthKey } from '@/lib/month-utils';
import { employeeInScope, authScopeViewer } from '@/lib/scope/server';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'kpiDashboard', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const employeeId = request.nextUrl.searchParams.get('employeeId')?.trim() || '';
    const month = request.nextUrl.searchParams.get('month')?.trim() || '';
    if (!employeeId) return validationError('معرّف الموظف مطلوب');
    const monthError = validateMonthKey(month);
    if (monthError) return validationError(monthError);

    // Existing employee scope — no new authorization system.
    const inScope = await employeeInScope(authScopeViewer(auth), auth.permissions, employeeId);
    if (!inScope) return notFoundError('الموظف غير موجود');

    const outcome = await computeEmployeeKpiResult(employeeId, month);

    if (outcome.status === 'EMPLOYEE_NOT_FOUND') {
      return notFoundError('الموظف غير موجود');
    }

    return Response.json({
      employeeId: outcome.employeeId,
      month: outcome.period,
      status: outcome.status,
      resolution: outcome.resolution,
      result: outcome.result,
    });
  } catch (error) {
    logServerFailure('kpi-framework/employee-result', 'GET', error);
    return internalError();
  }
}
