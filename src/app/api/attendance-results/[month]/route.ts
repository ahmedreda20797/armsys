// ══════════════════════════════════════════════════════════════
//  /api/attendance-results/[month]
//
//  GET — list the PERSISTED monthly attendance results for a month
//  (Phase 2 Milestone 3, spec §13/§14).
//
//  READ-ONLY against the attendanceResults collection: this route
//  NEVER recalculates. A month that was never generated returns an
//  empty list — clients that need a result must call the explicit
//  generate endpoint.
//
//  Query params (all optional): employeeId (exact canonical id),
//  department (employeeSnapshot.department), limit + offset (simple
//  pagination over the filtered list).
//
//  Permission: 'view' on 'reports' — the same gate that protects
//  /api/reports/generate, which serves the same canonical
//  computation without persistence.
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
import { getAttendanceResultsForMonth } from '@/lib/attendance';
import type { StoredAttendanceResult } from '@/lib/attendance';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ month: string }> },
) {
  try {
    // ── 1. Authenticate + authorize ──
    const permCheck = await verifyPermission(request, 'reports', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);
    if (!permCheck.user?.id) return unauthorizedError();

    // ── 2. Validate month key (strict YYYY-MM) ──
    const { month: monthKey } = await params;
    const monthError = validateMonthKey(monthKey);
    if (monthError) return validationError(monthError);

    // ── 3. Stored results only — no recalculation, no regeneration ──
    let results: StoredAttendanceResult[] = await getAttendanceResultsForMonth(monthKey);

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const department = searchParams.get('department');
    const limitParam = Number(searchParams.get('limit'));
    const offsetParam = Number(searchParams.get('offset'));

    if (employeeId) results = results.filter((r) => r.employeeId === employeeId);
    if (department) results = results.filter((r) => r.employeeSnapshot?.department === department);

    const total = results.length;
    const offset = Number.isInteger(offsetParam) && offsetParam > 0 ? offsetParam : 0;
    if (Number.isInteger(limitParam) && limitParam > 0) {
      results = results.slice(offset, offset + limitParam);
    } else if (offset > 0) {
      results = results.slice(offset);
    }

    // Deterministic ordering for pagination stability.
    results.sort((a, b) => a.employeeId.localeCompare(b.employeeId));

    return Response.json({ month: monthKey, results, meta: { count: results.length, total } });
  } catch (error) {
    logServerFailure('attendance-results/[month]', 'GET', error);
    return internalError();
  }
}
