// ══════════════════════════════════════════════════════════════
//  /api/attendance-kpi/[month]
//
//  GET — the Attendance KPIs for every employee of one month
//  (Phase 2 Milestone 6, spec §14 — safe batch/list read for
//  Employee 360 / dashboard consumers).
//
//  READ-ONLY over the stored attendanceResults collection via the
//  KPI service: NEVER recalculates, NEVER regenerates, NEVER writes
//  Firebase. A month that was never generated returns an empty list
//  — clients that need a result must call the explicit generate
//  endpoint.
//
//  Query params (all optional): employeeId (exact canonical id),
//  department (stored employee snapshot department), limit + offset
//  (simple pagination over the filtered list).
//
//  Permission: 'view' on 'reports' — the identical gate as the
//  /api/attendance-results list route serving the same stored data.
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
import { getAttendanceKpisForMonth } from '@/lib/attendance';
import type { AttendanceKpiResult } from '@/lib/attendance';

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
    let kpis: AttendanceKpiResult[] = await getAttendanceKpisForMonth(monthKey);

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const department = searchParams.get('department');
    const limitParam = Number(searchParams.get('limit'));
    const offsetParam = Number(searchParams.get('offset'));

    if (employeeId) kpis = kpis.filter((k) => k.employeeId === employeeId);
    if (department) kpis = kpis.filter((k) => k.department === department);

    const total = kpis.length;
    const offset = Number.isInteger(offsetParam) && offsetParam > 0 ? offsetParam : 0;
    if (Number.isInteger(limitParam) && limitParam > 0) {
      kpis = kpis.slice(offset, offset + limitParam);
    } else if (offset > 0) {
      kpis = kpis.slice(offset);
    }

    // Deterministic ordering for pagination stability (M3 list-route convention).
    kpis.sort((a, b) => a.employeeId.localeCompare(b.employeeId));

    return Response.json({ month: monthKey, kpis, meta: { count: kpis.length, total } });
  } catch (error) {
    logServerFailure('attendance-kpi/[month]', 'GET', error);
    return internalError();
  }
}
