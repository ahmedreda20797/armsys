// ══════════════════════════════════════════════════════════════
//  GET /api/performance-intelligence — Employee Performance
//  Intelligence dataset (Phase 3)
//
//  Thin route: authenticate → authorize (existing kpiReports
//  permission — no second permission system) → AUTHORIZED scope
//  check on the requested employee (fail-closed 404,
//  anti-enumeration) → delegate to the read-only service.
//
//  Query parameters:
//    employeeId   (required)
//    month        (required, YYYY-MM)
//    windowMonths (optional, default 6, clamped 1..36)
//    minOccurrences (optional, default 2, clamped ≥ 2)
//
//  The response is DETERMINISTIC FACTS ONLY — no narratives.
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
import {
  getEmployeePerformanceDataset,
  MAX_WINDOW_MONTHS,
  MIN_WINDOW_MONTHS,
} from '@/lib/performance-intelligence';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'kpiReports', 'view');
    if (!permCheck.allowed || !permCheck.user) {
      return forbiddenError(permCheck.error);
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    if (!employeeId) return validationError('معرّف الموظف مطلوب');

    const month = searchParams.get('month');
    const monthError = validateMonthKey(month);
    if (monthError) return validationError(monthError);

    const windowMonthsRaw = searchParams.get('windowMonths');
    let windowMonths: number | undefined;
    if (windowMonthsRaw !== null) {
      const parsed = Number(windowMonthsRaw);
      if (!Number.isFinite(parsed)) return validationError('عدد أشهر النافذة غير صالح');
      windowMonths = Math.max(MIN_WINDOW_MONTHS, Math.min(MAX_WINDOW_MONTHS, Math.trunc(parsed)));
    }

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

    const dataset = await getEmployeePerformanceDataset({
      employeeId: employeeId!,
      monthKey: month!,
      windowMonths,
      minOccurrences,
    });

    if (!dataset) return notFoundError('الموظف غير موجود');

    return Response.json(dataset);
  } catch (error) {
    logServerFailure('performance-intelligence', 'GET', error);
    return internalError();
  }
}
