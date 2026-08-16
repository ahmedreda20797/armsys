// ══════════════════════════════════════════════════════════════
//  /api/employee-performance/[employeeId]
//
//  GET — scoped Employee 360 performance history (Phase 2
//  Milestone 5, spec §23). Returns the shared Time-Scope contract
//  layers for ONE employee (canonical `employeeId` identity):
//
//    { employeeId, scope, current, history, career, sources }
//
//  READ-ONLY reader/assembler: attendance comes from stored
//  attendanceResults, quality from stored monthSnapshots, HR from
//  existing hrDeductions — nothing is recalculated here. A missing
//  month is an explicit null, never a silently computed value.
//
//  Query parameters (the shared TimeScope vocabulary — no second
//  range system):
//    scope   — career (default) | current_month | previous_month |
//              selected_month | last_3_months | last_6_months |
//              current_year | custom_range | day
//    month   — YYYY-MM  (required when scope=selected_month)
//    months  — CSV list (required when scope=custom_range)
//    date    — YYYY-MM-DD (required when scope=day)
//
//  Permission: 'view' on 'employees' — same gate as the existing
//  /api/employee-360/[id] route this endpoint serves.
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
import { isValidMonthKey } from '@/lib/month-utils';
import { isValidDayKey } from '@/lib/time-scope';
import { getEmployeePerformance } from '@/lib/employee-performance';
import type { TimeScope, TimeScopeKind } from '@/lib/time-scope';

const SCOPE_KINDS: readonly TimeScopeKind[] = [
  'career',
  'current_month',
  'previous_month',
  'selected_month',
  'last_3_months',
  'last_6_months',
  'current_year',
  'custom_range',
  'day',
];

/** Parse + validate the query parameters into a TimeScope (strict — malformed input is a caller bug). */
function parseScope(searchParams: URLSearchParams): { scope: TimeScope } | { error: string } {
  const raw = searchParams.get('scope') || 'career';
  if (!SCOPE_KINDS.includes(raw as TimeScopeKind)) {
    return { error: `نطاق غير صالح: ${raw} (المسموح: ${SCOPE_KINDS.join(', ')})` };
  }
  const kind = raw as TimeScopeKind;

  switch (kind) {
    case 'selected_month': {
      const month = searchParams.get('month') || '';
      if (!isValidMonthKey(month)) return { error: 'باراميتر month مطلوب بصيغة YYYY-MM عند اختيار شهر محدد' };
      return { scope: { kind, monthKey: month } };
    }
    case 'custom_range': {
      const monthsParam = searchParams.get('months') || '';
      const monthKeys = monthsParam.split(',').map((m) => m.trim()).filter(Boolean);
      if (monthKeys.length === 0) return { error: 'باراميتر months مطلوب (قائمة أشهر YYYY-MM مفصولة بفواصل) عند اختيار نطاق مخصص' };
      for (const key of monthKeys) {
        if (!isValidMonthKey(key)) return { error: `شهر غير صالح في النطاق المخصص: ${key} (YYYY-MM مطلوب)` };
      }
      return { scope: { kind, monthKeys } };
    }
    case 'day': {
      const date = searchParams.get('date') || '';
      if (!isValidDayKey(date)) return { error: 'باراميتر date مطلوب بصيغة YYYY-MM-DD عند اختيار يوم محدد' };
      return { scope: { kind, date } };
    }
    default:
      return { scope: { kind } };
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ employeeId: string }> },
) {
  try {
    // ── 1. Authenticate + authorize (Employee 360 gate) ──
    const permCheck = await verifyPermission(request, 'employees', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);
    if (!permCheck.user?.id) return unauthorizedError();

    // ── 2. Validate inputs ──
    const { employeeId } = await params;
    if (!employeeId) return validationError('معرّف الموظف مطلوب');

    const parsed = parseScope(new URL(request.url).searchParams);
    if ('error' in parsed) return validationError(parsed.error);

    // ── 3. Assemble stored results into the contract layers ──
    const performance = await getEmployeePerformance({ employeeId, scope: parsed.scope });
    if (!performance) {
      return Response.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    return Response.json(performance);
  } catch (error) {
    logServerFailure('employee-performance/[employeeId]', 'GET', error);
    return internalError();
  }
}
