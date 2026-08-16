// ══════════════════════════════════════════════════════════════
//  /api/attendance-kpi/[month]/[employeeId]
//
//  GET — the Attendance KPI (PerformanceFactor representation) for
//  ONE employee-month (Phase 2 Milestone 6, spec §13).
//
//  READ-ONLY over the stored attendanceResults collection via the
//  KPI service: this route NEVER recalculates, NEVER regenerates,
//  NEVER writes Firebase. When no persisted result exists for the
//  employee/month it returns 404 with an EXPLICIT not_generated
//  status — never a fallback to raw biometrics, never a fabricated
//  100, never another month's KPI. Generation stays a separate,
//  explicit, permission-gated operation
//  (POST /api/attendance-results/generate).
//
//  Permission: 'view' on 'reports' — the identical gate as the
//  /api/attendance-results read routes that serve the same stored
//  data.
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
import { getAttendanceKpi } from '@/lib/attendance';

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

    // ── 3. Stored result only — explicit not_generated when absent ──
    const kpi = await getAttendanceKpi(monthKey, employeeId);
    if (!kpi) {
      return Response.json(
        { status: 'not_generated', month: monthKey, employeeId },
        { status: 404 },
      );
    }

    return Response.json(kpi);
  } catch (error) {
    logServerFailure('attendance-kpi/[month]/[employeeId]', 'GET', error);
    return internalError();
  }
}
