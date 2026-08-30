// ══════════════════════════════════════════════════════════════
//  GET /api/kpi-reports/monthly — Monthly Quality KPI Report (Phase 2)
//
//  Thin route (project convention): authenticate → authorize →
//  resolve the AUTHORIZED employee scope → delegate to the
//  kpi-reporting service → JSON.
//
//  Query parameters:
//    month        (required, YYYY-MM)
//    employeeQuery / department / team / status / minScore / maxScore
//    sortBy       employeeName|department|team|score|status
//    sortDir      asc|desc
//
//  Scope doctrine (M0.5): the authorized employee set (the
//  'employees' permission entry) narrows the report BEFORE any
//  presentation filter — a query parameter can only narrow it.
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

    const minScoreRaw = searchParams.get('minScore');
    const maxScoreRaw = searchParams.get('maxScore');
    const minScore = minScoreRaw === null ? undefined : Number(minScoreRaw);
    const maxScore = maxScoreRaw === null ? undefined : Number(maxScoreRaw);
    if ((minScore !== undefined && !Number.isFinite(minScore)) ||
        (maxScore !== undefined && !Number.isFinite(maxScore))) {
      return validationError('نطاق الدرجات غير صالح');
    }

    // ── Authorized employee scope (M0.5) — resolved server-side ──
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user),
      undefined,
      permCheck.user.permissions,
    );
    const scopeLimit = scopeCtx.isUnrestricted ? null : [...scopeCtx.employeeIds];

    const report = await buildMonthlyKpiReport({
      monthKey: month!,
      reportKind: 'MONTHLY',
      filters: {
        employeeQuery: searchParams.get('employeeQuery') ?? undefined,
        department: searchParams.get('department') ?? undefined,
        team: searchParams.get('team') ?? undefined,
        status: (statusParam as KpiReportRowStatus | null) ?? undefined,
        minScore,
        maxScore,
        scopeLimit,
      },
      sort: { key: sortByParam as KpiMonthlySortKey, direction: sortDirParam },
    });

    return Response.json(report);
  } catch (error) {
    logServerFailure('kpi-reports-monthly', 'GET', error);
    return internalError();
  }
}
