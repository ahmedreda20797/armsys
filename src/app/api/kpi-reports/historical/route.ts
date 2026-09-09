// ══════════════════════════════════════════════════════════════
//  GET /api/kpi-reports/historical — Historical Quality KPI Report
//
//  Frozen-first (spec §9/§26): a CLOSED month is answered from its
//  immutable snapshot — frozen raw scores, frozen weights, frozen
//  contributions, scheme id + version. It is NEVER recalculated
//  under the current scheme. A past month that was never closed is
//  answered live but clearly labeled `valueBasis: 'LIVE'`
//  (NOT FINALIZED) — never presented as final.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError,
  internalError,
  logServerFailure,
  unauthorizedError,
  validationError,
} from '@/lib/api-error';
import { validateMonthKey } from '@/lib/month-utils';
import { asScopeViewer, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { buildMonthlyKpiReport } from '@/lib/kpi-reporting';
import type { KpiMonthlySortKey, KpiReportRowStatus } from '@/lib/kpi-reporting';

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'AVAILABLE', 'PENDING', 'INCOMPLETE', 'ZERO', 'FINALIZED',
  'NOT_ELIGIBLE', 'NO_SCHEME', 'AMBIGUOUS', 'OVERRIDE_NOT_RESOLVABLE',
]);

const VALID_SORT_KEYS: ReadonlySet<string> = new Set([
  'employeeName', 'department', 'team', 'score', 'status',
]);

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'kpiReports', 'view');
    if (!permCheck.allowed || !permCheck.user) {
      return forbiddenError(permCheck.error);
    }

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const monthError = validateMonthKey(month);
    if (monthError) return validationError(monthError);

    const statusParam = searchParams.get('status');
    if (statusParam && !VALID_STATUSES.has(statusParam)) {
      return validationError('قيمة الحالة غير صالحة');
    }
    const sortByParam = searchParams.get('sortBy') ?? 'employeeName';
    if (!VALID_SORT_KEYS.has(sortByParam)) {
      return validationError('مفتاح الترتيب غير صالح');
    }
    const sortDirParam = searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc';

    // ── Authorized employee scope (M0.5) ──
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user),
      undefined,
      permCheck.user.permissions,
    );
    const scopeLimit = scopeCtx.isUnrestricted ? null : [...scopeCtx.employeeIds];

    const report = await buildMonthlyKpiReport({
      monthKey: month!,
      reportKind: 'HISTORICAL',
      filters: {
        employeeQuery: searchParams.get('employeeQuery') ?? undefined,
        department: searchParams.get('department') ?? undefined,
        team: searchParams.get('team') ?? undefined,
        status: (statusParam as KpiReportRowStatus | null) ?? undefined,
        includeArchived: searchParams.get('includeArchived') === 'true',
        scopeLimit,
      },
      sort: { key: sortByParam as KpiMonthlySortKey, direction: sortDirParam },
    });

    return Response.json(report);
  } catch (error) {
    logServerFailure('kpi-reports-historical', 'GET', error);
    return internalError();
  }
}
