// ══════════════════════════════════════════════════════════════
//  GET /api/performance-hub — Employee Performance Hub dataset
//  (مركز أداء الموظف)
//
//  Thin route: authenticate → authorize (the existing 'employee360'
//  permission — the Hub is the employee-analysis workspace; no second
//  permission system) → SECTION gates (the same resolver Employee 360
//  uses) → AUTHORIZED scope check on the requested employee
//  (fail-closed 404, anti-enumeration) → delegate to the read-only
//  service.
//
//  Query parameters:
//    employeeId (required)
//    month      (required, YYYY-MM)
//    minOccurrences (optional, default 2, ≥ 2 — canonical repeated rule)
//
//  Server-side withholding (never UI-hidden):
//    risk — null unless the employee360 'risk' section is granted
//    hr   — null unless the employee360 'hrDeductions' section is
//           granted (the HR records are never even read)
//    teamBenchmark — members are narrowed to the caller's authorized
//           employee scope before any aggregation
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
import { resolveEmployee360SectionGate } from '@/lib/permissions/employee360-access';
import {
  getEmployeePerformanceHubDataset,
} from '@/lib/performance-hub';
import { DEFAULT_MIN_OCCURRENCES } from '@/lib/performance-intelligence';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'employee360', 'view');
    if (!permCheck.allowed || !permCheck.user) {
      return forbiddenError(permCheck.error);
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    if (!employeeId) return validationError('معرّف الموظف مطلوب');

    const month = searchParams.get('month');
    const monthError = validateMonthKey(month);
    if (monthError) return validationError(monthError);

    const minOccurrencesRaw = searchParams.get('minOccurrences');
    let minOccurrences: number | undefined;
    if (minOccurrencesRaw !== null) {
      const parsed = Number(minOccurrencesRaw);
      if (!Number.isFinite(parsed) || parsed < 2) {
        return validationError('الحد الأدنى للتكرار يجب أن يكون 2 على الأقل');
      }
      minOccurrences = Math.trunc(parsed);
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

    // ── Section gates — the SAME resolver the Employee 360 profile
    //    uses; restricted blocks are withheld server-side. ──
    const sectionGate = resolveEmployee360SectionGate(permCheck.user.permissions);

    const dataset = await getEmployeePerformanceHubDataset({
      employeeId: employeeId!,
      monthKey: month!,
      minOccurrences: minOccurrences ?? DEFAULT_MIN_OCCURRENCES,
      riskEnabled: sectionGate.risk,
      hrAuthorized: sectionGate.hrDeductions,
      scopeIncludes: (id: string) => scopeCtx.isUnrestricted || scopeCtx.includes(id),
    });

    if (!dataset) return notFoundError('الموظف غير موجود');

    return Response.json(dataset);
  } catch (error) {
    logServerFailure('performance-hub', 'GET', error);
    return internalError();
  }
}
