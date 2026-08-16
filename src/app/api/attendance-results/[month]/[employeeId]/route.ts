// ══════════════════════════════════════════════════════════════
//  /api/attendance-results/[month]/[employeeId]
//
//  GET — fetch ONE persisted monthly attendance result by canonical
//  employee id (Phase 2 Milestone 3, spec §13/§14).
//
//  READ-ONLY against the attendanceResults collection: this route
//  NEVER recalculates. When no result has been generated for the
//  employee/month it returns 404 with an EXPLICIT not_generated
//  status — never a silently computed live value. Generating is a
//  separate, explicit, permission-gated endpoint.
//
//  Permission: 'view' on 'reports' (same gate as the list route and
//  /api/reports/generate).
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
import { getAttendanceResult } from '@/lib/attendance';

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
    const result = await getAttendanceResult(monthKey, employeeId);
    if (!result) {
      return Response.json(
        { status: 'not_generated', month: monthKey, employeeId },
        { status: 404 },
      );
    }

    return Response.json(result);
  } catch (error) {
    logServerFailure('attendance-results/[month]/[employeeId]', 'GET', error);
    return internalError();
  }
}
