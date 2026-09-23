// ══════════════════════════════════════════════════════════════
//  GET /api/reports/hr-performance/decision — HR Decision-Support
//  Team/Department Report (audience-aware, richer HR projection)
//
//  Extends the HR reporting surface (which shows the FINAL KPI
//  result only) with the DECISION-SUPPORT view: deterministic
//  statuses (STABLE … MANAGEMENT_REVIEW) WITH the structured factors
//  that explain them, over the CANONICAL performance-intelligence
//  dataset — no second KPI engine, no recomputation.
//
//  SAFETY: decision support, never an automatic employment-decision
//  engine. The status vocabulary and the recommended action carry
//  no termination semantics.
//
//  PIPELINE (the same authorization chain as /api/reports/hr-performance):
//    requireAuth → 'reports' view permission → audience resolved
//    → AUTHORIZED employee scope (M0.5, server-resolved)
//    → per-employee canonical dataset → decision projection
//    → team/department aggregate → JSON
//
//  Query parameters:
//    month            (required, YYYY-MM)
//    department / team / employeeQuery     (presentation filters)
//    decisionStatus   STABLE|IMPROVING|NEEDS_COACHING|
//                     PERFORMANCE_IMPROVEMENT_REVIEW|MANAGEMENT_REVIEW
//    includeArchived  'true' to include archived-but-current employees
//    sortBy           status|employeeName|kpiScore   (default status)
//    sortDir          asc|desc
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
import { asScopeViewer, resolveEmployeeScopeFromDb, filterEmployeesInScope } from '@/lib/scope/server';
import { getAll } from '@/lib/db';
import { normalizeEmployeeStatus } from '@/lib/organization/employee-status';
import {
  resolveReportAudience,
} from '@/lib/report-audience';
import {
  getHrTeamDecisionReport,
  HR_DECISION_STATUS_ORDER,
} from '@/lib/hr-decision';
import type { HrDecisionStatus } from '@/lib/hr-decision';

const VALID_DECISION_STATUSES: ReadonlySet<string> = new Set([
  'STABLE', 'IMPROVING', 'NEEDS_COACHING',
  'PERFORMANCE_IMPROVEMENT_REVIEW', 'MANAGEMENT_REVIEW',
]);

const VALID_SORT_KEYS: ReadonlySet<string> = new Set(['status', 'employeeName', 'kpiScore']);

/** Canonical employee slice the route reads (stable fields only). */
interface RouteEmployee {
  id: string;
  name: string;
  code: string | null;
  department: string | null;
  status: unknown;
}

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

    // ── Audience resolved (auditable — the projection is identical
    //    for every admitted caller; the data is HR-safe by shape).
    const audience = resolveReportAudience({
      role: permCheck.user.role,
      permissions: permCheck.user.permissions,
    });

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const monthError = validateMonthKey(month);
    if (monthError) return validationError(monthError);

    const decisionStatus = searchParams.get('decisionStatus');
    if (decisionStatus && !VALID_DECISION_STATUSES.has(decisionStatus)) {
      return validationError('قيمة حالة القرار غير صالحة');
    }
    const sortByParam = searchParams.get('sortBy') ?? 'status';
    if (!VALID_SORT_KEYS.has(sortByParam)) {
      return validationError('مفتاح الترتيب غير صالح');
    }
    const sortDirParam = searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc';
    const includeArchived = searchParams.get('includeArchived') === 'true';

    const departmentFilter = searchParams.get('department') ?? undefined;
    const teamFilter = searchParams.get('team') ?? undefined;
    const query = (searchParams.get('employeeQuery') ?? '').trim().toLowerCase();

    // ── Authorized employee scope (M0.5) — resolved server-side; the
    //    client never widens it. Unrestricted callers see the current
    //    roster; scoped callers intersect with their authorized ids.
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user),
      undefined,
      permCheck.user.permissions,
    );

    const allEmployees = await getAll<Record<string, unknown>>('employees');
    let candidates: RouteEmployee[] = allEmployees
      .filter((e): e is Record<string, unknown> & { id: string } => typeof e?.id === 'string')
      .map((e) => ({
        id: e.id,
        name: String(e.name ?? ''),
        code: typeof e.code === 'string' && e.code.length > 0 ? e.code : null,
        department: typeof e.department === 'string' ? e.department : null,
        status: e.status,
      }));

    candidates = filterEmployeesInScope(candidates, scopeCtx);

    // Lifecycle parity with the monthly report: archived rows appear
    // only on explicit opt-in (the dataset still enforces eligibility).
    candidates = candidates.filter((e) => {
      const status = normalizeEmployeeStatus(e.status);
      if (status === 'archived') return includeArchived;
      return true;
    });

    // Cheap pre-filters on the employee record (team needs the org
    // tree, so it filters on the BUILT rows below).
    if (departmentFilter) {
      candidates = candidates.filter((e) => e.department === departmentFilter);
    }
    if (query) {
      candidates = candidates.filter(
        (e) => e.name.toLowerCase().includes(query) || (e.code ?? '').toLowerCase().includes(query),
      );
    }

    // ── Decision reports over the authorized population ──
    const teamReport = await getHrTeamDecisionReport({
      monthKey: month!,
      employeeIds: candidates.map((e) => e.id),
    });

    // Post-build filters (team + decision status) + deterministic sort.
    let rows = teamReport.rows.filter((r) => (teamFilter ? r.team === teamFilter : true));
    if (decisionStatus) {
      rows = rows.filter((r) => r.status === decisionStatus);
    }
    const dir = sortDirParam === 'desc' ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      switch (sortByParam) {
        case 'employeeName':
          return dir * a.employeeName.localeCompare(b.employeeName, 'ar');
        case 'kpiScore': {
          const av = a.kpiScore ?? -1;
          const bv = b.kpiScore ?? -1;
          if (av !== bv) return dir * (av - bv);
          return a.employeeName.localeCompare(b.employeeName, 'ar');
        }
        case 'status':
        default: {
          const d = HR_DECISION_STATUS_ORDER[a.status as HrDecisionStatus]
            - HR_DECISION_STATUS_ORDER[b.status as HrDecisionStatus];
          if (d !== 0) return dir * d;
          return a.employeeName.localeCompare(b.employeeName, 'ar');
        }
      }
    });

    return Response.json({
      ...teamReport,
      rows,
      resolvedAudience: audience,
    });
  } catch (error) {
    logServerFailure('reports-hr-decision', 'GET', error);
    return internalError();
  }
}
