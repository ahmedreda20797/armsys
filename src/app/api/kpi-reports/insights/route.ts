// ══════════════════════════════════════════════════════════════
//  GET /api/kpi-reports/insights — Operational Insights Workspace
//  (KPI Reports 2.0)
//
//  Thin route (project convention): authenticate → authorize →
//  resolve the AUTHORIZED employee scope → delegate to the
//  kpi-reporting insights builder → JSON. The builder COMPOSES the
//  canonical engines (monthly report · observation analysis ·
//  repeated-issue detection · org graph) — it never recomputes one.
//
//  Query parameters:
//    month           (required, YYYY-MM)
//    employees       optional comma-separated employee ids (narrowing)
//    orgNodes        optional comma-separated team/department node ids
//                    (canonical Organization Tree — subtree resolution)
//    includeArchived 'true' to include archived-yet-eligible employees
//
//  Scope doctrine (M0.5): the authorized employee set (the
//  'employees' permission entry) narrows the report BEFORE any
//  selection — a query parameter can only narrow it, never widen.
//
//  Audience doctrine: technical detail leaves the server for
//  TECHNICAL audiences only — HR / TEAM_LEADER callers are directed
//  to their own audience reports (/api/reports/hr-performance*),
//  enforced HERE, not hidden in a frontend.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth, verifyPermission, authorize } from '@/lib/verify-permission';
import {
  forbiddenError,
  internalError,
  logServerFailure,
  unauthorizedError,
  validationError,
} from '@/lib/api-error';
import { validateMonthKey } from '@/lib/month-utils';
import { asScopeViewer, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { buildKpiInsightsReport } from '@/lib/kpi-reporting';
import { technicalReportAudienceGuard } from '@/lib/report-audience/server-guard';

const MAX_SELECTION_IDS = 100;

/** Comma-separated query param → trimmed unique id list (bounded). */
function parseIdList(raw: string | null): string[] {
  if (!raw) return [];
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length <= 128);
  return [...new Set(ids)].slice(0, MAX_SELECTION_IDS);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'kpiReports', 'view');
    if (!permCheck.allowed || !permCheck.user) {
      return forbiddenError(permCheck.error);
    }

    // ── Report-audience guard (Qnalys audience model): technical
    //    detail leaves the server for TECHNICAL audiences only. HR /
    //    TEAM_LEADER callers are directed to their own audience
    //    report (/api/reports/hr-performance) — enforced HERE.
    const audienceRejection = technicalReportAudienceGuard(permCheck.user);
    if (audienceRejection) return audienceRejection;

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const monthError = validateMonthKey(month);
    if (monthError) return validationError(monthError);

    const employeeIds = parseIdList(searchParams.get('employees'));
    const orgNodeIds = parseIdList(searchParams.get('orgNodes'));
    const includeArchived = searchParams.get('includeArchived') === 'true';

    // ── Authorized employee scope (M0.5) — resolved server-side ──
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user),
      undefined,
      permCheck.user.permissions,
    );
    const scopeLimit = scopeCtx.isUnrestricted ? null : [...scopeCtx.employeeIds];

    const report = await buildKpiInsightsReport({
      monthKey: month!,
      scopeLimit,
      selection: {
        employeeIds,
        orgNodeIds,
      },
      filters: { includeArchived },
    });

    // ── Field-level authorization surface: the HR-deductions source
    //    is reported as RESTRICTED (not absent) for callers whose
    //    effective permissions deny the hrDeductions page — the data
    //    behind it is never serialized either way.
    const hrDecision = authorize(auth, { page: 'hrDeductions' });
    if (!hrDecision.allowed) {
      const entry = report.dataQuality.find((d) => d.source === 'hrDeductions');
      if (entry) entry.status = 'restricted';
    }

    return Response.json(report);
  } catch (error) {
    logServerFailure('kpi-reports-insights', 'GET', error);
    return internalError();
  }
}
