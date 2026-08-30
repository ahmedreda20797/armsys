// ══════════════════════════════════════════════════════════════
//  GET /api/kpi-reports/mtd — Month-To-Date Quality KPI Report
//
//  MTD ≠ finalized monthly snapshot (spec §7/§8): the report is
//  computed LIVE from the existing quality data under the CURRENT
//  calculation rules and is clearly labeled MTD. If the requested
//  month was already closed by the existing Month Close process,
//  the response carries `valueBasis: 'FINALIZED'` and the frozen
//  values — MTD never overwrites or masquerades as FINAL.
//
//  `month` is optional and defaults to the current calendar month.
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
import { buildMonthlyKpiReport, monthKeyOf } from '@/lib/kpi-reporting';
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
    const monthParam = searchParams.get('month');
    const month = monthParam ?? monthKeyOf(new Date());
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
      monthKey: month,
      reportKind: 'MTD',
      filters: {
        employeeQuery: searchParams.get('employeeQuery') ?? undefined,
        department: searchParams.get('department') ?? undefined,
        team: searchParams.get('team') ?? undefined,
        status: (statusParam as KpiReportRowStatus | null) ?? undefined,
        scopeLimit,
      },
      sort: { key: sortByParam as KpiMonthlySortKey, direction: sortDirParam },
    });

    return Response.json(report);
  } catch (error) {
    logServerFailure('kpi-reports-mtd', 'GET', error);
    return internalError();
  }
}
