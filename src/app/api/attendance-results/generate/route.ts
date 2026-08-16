// ══════════════════════════════════════════════════════════════
//  /api/attendance-results/generate
//
//  POST — generate + persist the canonical monthly attendance
//  results for one month (Phase 2 Milestone 3, spec §8).
//
//  THIN route: authenticate → authorize → validate month → delegate
//  to the monthly-results service. No attendance rule lives here —
//  the service calls the canonical computeMonthlyAttendance() once
//  per employee and persists its direct output.
//
//  Generation is IDEMPOTENT: regenerating an employee/month replaces
//  the canonical result under the same deterministic id (never a
//  duplicate record) and writes audit entries. This is NOT Close
//  Month — open and historical months may be regenerated when
//  explicitly requested; formal monthly locking is a later milestone.
//
//  Permission: 'update' on 'attendance' — generation writes the
//  canonical attendance-domain result collection, so the existing
//  attendance edit permission (create/update/delete/export action
//  set) gates it via the standard permission system.
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
import { resolveActor } from '@/lib/auth/actor-resolver';
import { validateMonthKey } from '@/lib/month-utils';
import { generateMonthlyAttendanceResults } from '@/lib/attendance';

export async function POST(request: NextRequest) {
  try {
    // ── 1. Authenticate + authorize (existing permission system) ──
    const permCheck = await verifyPermission(request, 'attendance', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);
    if (!permCheck.user?.id) return unauthorizedError();

    // ── 2. Validate month key (strict YYYY-MM) ──
    const { month } = await request.json();
    if (!month) return validationError('الشهر مطلوب (YYYY-MM)');
    const monthError = validateMonthKey(month);
    if (monthError) return validationError(monthError);

    // ── 3. Resolve actor server-side (never trust client identity) ──
    const actor = await resolveActor(permCheck.user.id);

    // ── 4. Delegate to the service (canonical engine + persist + audit) ──
    const summary = await generateMonthlyAttendanceResults(month, actor);
    return Response.json(summary);
  } catch (error) {
    logServerFailure('attendance-results/generate', 'POST', error);
    return internalError();
  }
}
