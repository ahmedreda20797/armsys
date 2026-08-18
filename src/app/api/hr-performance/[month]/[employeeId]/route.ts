// ══════════════════════════════════════════════════════════════
//  /api/hr-performance/[month]/[employeeId]
//
//  GET — the HR PerformanceFactor for ONE employee-month
//  (Phase 2 Milestone 7, spec §8).
//
//  READ-ONLY over the stored hrDeductions collection via the HR
//  PerformanceFactor service: this route NEVER recalculates,
//  NEVER writes Firebase. When no HR deduction records exist
//  for the employee/month it returns the factor with
//  hasData=false — never a fabricated value, never data from
//  another domain (Attendance/Quality/Sales).
//
//  Permission: 'view' on 'reports' — the identical gate as the
//  /api/attendance-kpi and /api/attendance-results read routes.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError,
  internalError,
  logServerFailure,
  unauthorizedError,
  validationError,
} from '@/lib/api-error';
import { validateMonthKey } from '@/lib/month-utils';
import { getHrPerformanceFactor } from '@/lib/hr-performance';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ month: string; employeeId: string }> },
) {
  try {
    // ── 1. Authenticate + authorize ──
    const permCheck = await verifyPermission(request, 'reports', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);
    if (!permCheck.user?.id) return unauthorizedError();

    // ── 2. Validate inputs ──
    const { month: monthKey, employeeId } = await params;
    const monthError = validateMonthKey(monthKey);
    if (monthError) return validationError(monthError);
    if (!employeeId) return validationError('معرّف الموظف مطلوب');

    // ── 3. Read stored HR deduction data only — no cross-domain access ──
    const factor = await getHrPerformanceFactor(monthKey, employeeId);

    return Response.json(factor);
  } catch (error) {
    logServerFailure('hr-performance/[month]/[employeeId]', 'GET', error);
    return internalError();
  }
}
