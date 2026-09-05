// ══════════════════════════════════════════════════════════════
//  GET /api/reports/management — Cross-domain Management Report
//  (Milestone 7, Phase A)
//
//  Thin route: authenticate → authorize (kpiReports view) → resolve
//  the caller's employee scope ONCE → scope-filter every operational
//  domain at the retrieval boundary → delegate to the pure builder.
//
//  QUALITY block: the existing engine summary (buildKpiManagement-
//  Summary) built with the SAME scope — consumed verbatim, never
//  recomputed here.
//
//  Query parameters: month (required, YYYY-MM)
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
import {
  asScopeViewer,
  filterRowsByEmployeeScope,
  resolveEmployeeScopeFromDb,
} from '@/lib/scope/server';
import {
  assembleManagementReport,
  defaultManagementReportLoaders,
  type ManagementDomainSource,
} from '@/lib/management-reporting';

type Row = Record<string, unknown>;

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

    // ── Authorized employee scope (resolved ONCE, applied to all) ──
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user),
      undefined,
      permCheck.user.permissions,
    );
    const scopeLimit = scopeCtx.isUnrestricted ? null : [...scopeCtx.employeeIds];

    const loaders = defaultManagementReportLoaders;
    const [complaints, capaCases, followUps, hrDeductions] = await Promise.all([
      loaders.loadComplaints(),
      loaders.loadCapaCases(),
      loaders.loadFollowUps(),
      loaders.loadHrDeductions(),
    ]);

    // Scope filtering at the retrieval boundary — same doctrine as
    // every list route. CAPA rows carry the secondary relatedEmployeeIds
    // link; complaints are optionally linked (organizational rows pass
    // on permission alone); follow-ups/HR deductions are employee-
    // mandatory (fail closed on a missing link).
    const scoped = {
      complaints: filterRowsByEmployeeScope(complaints as Row[], scopeCtx, { optionalLink: true }),
      capaCases: filterRowsByEmployeeScope(capaCases as Row[], scopeCtx, {
        optionalLink: true,
        relatedEmployeeIdsField: 'relatedEmployeeIds',
      }),
      followUps: filterRowsByEmployeeScope(followUps as Row[], scopeCtx),
      hrDeductions: filterRowsByEmployeeScope(hrDeductions as Row[], scopeCtx),
    } satisfies Record<ManagementDomainSource, Row[]>;

    const report = await assembleManagementReport({
      monthKey: month!,
      scopeLimit,
      loaders,
      scopedRows: scoped,
      generatedAt: new Date().toISOString(),
    });

    return Response.json(report);
  } catch (error) {
    logServerFailure('reports-management', 'GET', error);
    return internalError();
  }
}
