// ══════════════════════════════════════════════════════════════
//  GET /api/reports/hr-performance — HR Monthly Employee Performance
//
//  The FIRST audience-specific report: HR receives the employee's
//  final performance result + organizational context ONLY. The
//  canonical monthly KPI pipeline is consumed verbatim — no second
//  engine, no recomputation, no fabricated values:
//
//    requireAuth → 'reports' view permission → audience guard
//    → AUTHORIZED employee scope (M0.5, server-resolved)
//    → buildMonthlyKpiReport (canonical) → HR projection → JSON
//
//  The HR projection structurally excludes technical fields
//  (observation counts, deduction/bonus points, component math,
//  evidence) — they are never copied, so they never reach an HR
//  client, independent of any UI hiding.
//
//  Query parameters (same vocabulary as /api/kpi-reports/monthly):
//    month        (required, YYYY-MM)
//    department / team / employeeQuery / status / includeArchived
//    sortBy       employeeName|department|team|score|status
//    sortDir      asc|desc
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
import {
  resolveReportAudience,
  buildHrPerformanceReport,
} from '@/lib/report-audience';

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

    // ── Permission: the existing reporting page (HR preset grants
    //    'reports' edit → view; unconfigured roles fail closed).
    const permCheck = await verifyPermission(request, 'reports', 'view');
    if (!permCheck.allowed || !permCheck.user) {
      return forbiddenError(permCheck.error);
    }

    // ── Audience guard (server-side, from the SAME effective map):
    //    TECHNICAL / TEAM_LEADER / HR audiences may all consume the
    //    HR view (it is the sanitized subset); the projection is
    //    identical regardless of who asks. The guard exists so the
    //    audience model is resolved and auditable here too.
    const audience = resolveReportAudience({
      role: permCheck.user.role,
      permissions: permCheck.user.permissions,
    });

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

    // ── Authorized employee scope (M0.5) — resolved server-side from
    //    the caller's identity; client-supplied scope is never trusted.
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user),
      undefined,
      permCheck.user.permissions,
    );
    const scopeLimit = scopeCtx.isUnrestricted ? null : [...scopeCtx.employeeIds];

    // ── CANONICAL monthly report (existing engine-only assembly) ──
    const monthly = await buildMonthlyKpiReport({
      monthKey: month!,
      reportKind: 'MONTHLY',
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

    // ── HR projection: sanitized by shape (no technical fields exist
    //    on the view model at all) ──
    const report = buildHrPerformanceReport(monthly);
    return Response.json({ ...report, resolvedAudience: audience });
  } catch (error) {
    logServerFailure('reports-hr-performance', 'GET', error);
    return internalError();
  }
}
