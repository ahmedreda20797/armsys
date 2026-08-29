// ══════════════════════════════════════════════════════════════
//  /api/kpi-framework/employee-scheme
//
//  PUT { employeeId, schemeId | null } — set / clear an employee's
//  KPI scheme override (kpiSettings update + existing employee
//  scope). Component owners' future write-apis will follow the same
//  pattern; nothing is granted to Quality users here.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { verifyPermission } from '@/lib/verify-permission';
import {
  validationError, forbiddenError, notFoundError, internalError, logServerFailure,
} from '@/lib/api-error';
import { setKpiSchemeOverride, KpiFrameworkValidationError } from '@/lib/kpi-framework';
import type { KpiSchemeOverride } from '@/lib/kpi-framework';
import { validateEmployeeId } from '@/lib/validate-employee';
import { employeeInScope, asScopeViewer } from '@/lib/scope/server';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';

export async function PUT(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'kpiSettings', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return validationError('بيانات الطلب غير صحيحة');
    }

    const employeeId = typeof body.employeeId === 'string' ? body.employeeId.trim() : '';
    if (!employeeId) return validationError('معرّف الموظف مطلوب');

    const schemeId =
      typeof body.schemeId === 'string' && body.schemeId.trim() ? body.schemeId.trim() : null;

    // Reuse the existing employee validation helper.
    const employeeCheck = await validateEmployeeId(employeeId, true);
    if (!employeeCheck.valid) return notFoundError('الموظف غير موجود');

    // Existing employee scope — no new authorization system.
    const inScope = await employeeInScope(asScopeViewer(permCheck.user!), permCheck.user!.permissions, employeeId);
    if (!inScope) return notFoundError('الموظف غير موجود');

    let override: KpiSchemeOverride | null;
    try {
      override = await setKpiSchemeOverride(
        employeeId,
        schemeId,
        { id: permCheck.user?.id || 'system', name: '' },
      );
    } catch (error) {
      if (error instanceof KpiFrameworkValidationError) {
        return validationError(error.message);
      }
      throw error;
    }

    const actor = await resolveActor(permCheck.user?.id);
    await writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action: override ? 'kpi_scheme_override_set' : 'kpi_scheme_override_clear',
      entityType: 'settings',
      entityId: employeeId,
      monthKey: null,
      before: null,
      after: override ? ({ ...override } as Record<string, unknown>) : null,
      details: override
        ? `تحديد نظام مؤشرات خاص للموظف ${employeeId}: ${override.schemeId}`
        : `إلغاء نظام المؤشرات الخاص للموظف ${employeeId}`,
    });

    return Response.json({ employeeId, override });
  } catch (error) {
    logServerFailure('kpi-framework/employee-scheme', 'PUT', error);
    return internalError();
  }
}
