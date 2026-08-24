// ══════════════════════════════════════════════════════════════
//  Unified Report Execution Endpoint (Milestone 8)
//
//    POST /api/reports/run
//    body: ReportRunRequest (+ optional format: 'json' | 'excel')
//
//  ONE endpoint for every registered report. The existing bespoke
//  report routes (generate/export/employee-detail/capa*) are the
//  legacy monthly report's own APIs and are NOT duplicated here —
//  architecture reports execute through the registry.
//
//  Enforcement order (backend is the security boundary):
//    1. resolve report from registry (unknown/disabled → 404)
//    2. verifyPermission(pageId, action) — JWT + effective perms
//    3. resolveReportRequest — employee scope modes, department,
//       TimeScope/date-range, allowed filters (strict, spec §21)
//    4. run the report's runner (canonical data consumer only)
//    5. envelope via buildReportRunResponse (declared metrics only)
//    6. excel format additionally requires the 'export' action
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { verifyPermission } from '@/lib/verify-permission';
import { apiError, ErrorCode, internalError, logServerFailure, notFoundError, validationError } from '@/lib/api-error';
import { buildReportExcel } from '@/lib/reports/excel';
import { getRegisteredReport } from '@/lib/reports/registry';
import { resolveReportRequest } from '@/lib/reports/scope';
import { buildReportRunResponse } from '@/lib/reports/response';
import { asScopeViewer, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import type { ReportRunRequest } from '@/lib/reports/types';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as (ReportRunRequest & { format?: string }) | null;
    if (!body || typeof body.reportId !== 'string' || body.reportId.length === 0) {
      return validationError('معرّف التقرير مطلوب');
    }

    // 1. Registry resolution — unknown/disabled reports do not exist.
    const registered = getRegisteredReport(body.reportId);
    if (!registered) {
      return notFoundError('التقرير غير موجود أو غير مُفعّل');
    }
    const definition = registered.definition;

    // 2. Permission enforcement (JWT + effective permissions).
    const action = definition.permission.action ?? 'view';
    const permCheck = await verifyPermission(request, definition.permission.pageId, action);
    if (!permCheck.allowed || !permCheck.user) {
      return apiError(403, ErrorCode.FORBIDDEN, permCheck.error ?? 'صلاحية غير كافية');
    }

    // ── 2b. AUTHORIZED employee scope — BEFORE request resolution (M0.4) ──
    // The report-request employee selection (lib/reports/scope) is a
    // REQUEST-SHAPE mechanism, never an authorization authority.
    // Authorization comes FIRST from the canonical employee scope
    // engine (the 'employees' permission entry). The request may
    // then only NARROW it:
    //     final = AUTHORIZED_SCOPE ∩ REQUESTED_SELECTION
    // An 'all' request from a scoped viewer is rewritten to the
    // authorized set; an explicit single/multiple request must be a
    // subset of the authorized set. A fail-closed viewer with an
    // empty authorized set cannot run employee reports at all.
    const authScope = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user),
      undefined,
      permCheck.user.permissions,
    );
    if (!authScope.isUnrestricted) {
      const authorizedIds = [...authScope.employeeIds];
      if (authorizedIds.length === 0) {
        return apiError(403, ErrorCode.FORBIDDEN, 'صلاحية غير كافية');
      }
      const requestedSingle =
        typeof body.employeeId === 'string' && body.employeeId.length > 0 ? body.employeeId : null;
      const requestedMultiple = Array.isArray(body.employeeIds)
        ? body.employeeIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
      // Mirror the request resolver's precedence: employeeScope
      // 'all' wins, then employeeIds, then employeeId, else 'all'.
      const asksAll = body.employeeScope === 'all' || (!requestedSingle && requestedMultiple.length === 0);
      if (asksAll) {
        body.employeeScope = undefined;
        body.employeeId = undefined;
        body.employeeIds = authorizedIds;
      } else if (requestedSingle) {
        if (!authScope.includes(requestedSingle)) {
          return apiError(403, ErrorCode.FORBIDDEN, 'صلاحية غير كافية');
        }
      } else {
        const intersection = requestedMultiple.filter((id) => authScope.includes(id));
        if (intersection.length === 0) {
          return apiError(403, ErrorCode.FORBIDDEN, 'صلاحية غير كافية');
        }
        body.employeeIds = intersection;
      }
    }

    // 3. Request resolution (scope modes, department, period, filters).
    const resolved = resolveReportRequest(definition, body);
    if (!resolved.ok) {
      return validationError(resolved.error);
    }

    // 4. Execute the registered runner.
    const runnerResult = await registered.run({
      request: body,
      resolved: resolved.value,
      actor: { userId: permCheck.user.id, role: permCheck.user.role },
    });

    // 5. Envelope (summary intersected with declared metrics).
    const response = buildReportRunResponse(definition, body, resolved.value, runnerResult, {
      userId: permCheck.user.id,
      role: permCheck.user.role,
    });

    // 6. Excel export — gated by the page's 'export' action.
    if (body.format === 'excel') {
      if (!definition.exportFormats.includes('excel')) {
        return validationError('تصدير Excel غير متاح لهذا التقرير');
      }
      const exportCheck = await verifyPermission(request, definition.permission.pageId, 'export');
      if (!exportCheck.allowed) {
        return apiError(403, ErrorCode.FORBIDDEN, exportCheck.error ?? 'صلاحية التصدير غير كافية');
      }
      const buffer = await buildReportExcel(definition, response as never);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename=${definition.reportId}_${Date.now()}.xlsx`,
        },
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    logServerFailure('reports-run', 'POST', error);
    return internalError();
  }
}
