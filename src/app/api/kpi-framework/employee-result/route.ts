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
//      result: EmployeeKpiResult | null,
//      performanceSignals: {
//        closedDeals: { count, unknownClosure, monthKey, dimension: 'CLOSED' }
//      }   — canonical non-weighted performance signal (§DEAL-DATES)
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
import { getAll, TTL } from '@/lib/db';
// §DEAL-DATES — the ONE canonical closed-deal calculation.
import { countClosedDealsForMonth } from '@/lib/deal-dates';
import type { TravelDeal } from '@/types';

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

    // §4.3 CANONICAL PERFORMANCE SIGNAL — the employee's closed-deal
    // output for the evaluation month (CLOSED dimension: closedAt),
    // computed by the one canonical helper (deal-dates) inside the
    // caller's already-enforced employee scope. This is a SIGNAL for
    // the target/performance evaluation layer — it is deliberately NOT
    // weighted into any KPI component: the default scheme's `target`
    // component is calculationType 'none' (PENDING placeholder), and
    // inventing a conversion would fabricate a business rule.
    const empTravelDeals = (await getAll<TravelDeal>('travelDeals', TTL.MEDIUM))
      .filter((d) => d.employeeId === employeeId);
    const closedCounts = countClosedDealsForMonth(empTravelDeals, month);

    return Response.json({
      employeeId: outcome.employeeId,
      month: outcome.period,
      status: outcome.status,
      resolution: outcome.resolution,
      result: outcome.result,
      // Canonical performance signals (dimension-labeled, non-weighted).
      performanceSignals: {
        closedDeals: {
          count: closedCounts.closed,
          unknownClosure: closedCounts.unknown,
          monthKey: month,
          dimension: 'CLOSED',
        },
      },
    });
  } catch (error) {
    logServerFailure('kpi-framework/employee-result', 'GET', error);
    return internalError();
  }
}
