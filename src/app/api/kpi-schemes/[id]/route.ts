// ══════════════════════════════════════════════════════════════
//  /api/kpi-schemes/[id]
//
//  GET — one scheme (kpiDashboard view)
//  PUT — update (kpiSettings update):
//          DRAFT    → full structural edits
//          ACTIVE   → only effectiveTo (window) / retire to ARCHIVED;
//                     structural changes require a new version
//          ARCHIVED → immutable
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  validationError, forbiddenError, unauthorizedError, notFoundError, internalError, logServerFailure,
} from '@/lib/api-error';
import {
  getKpiSchemeById,
  updateKpiScheme,
  KpiFrameworkValidationError,
} from '@/lib/kpi-framework';
import type { KpiScheme } from '@/lib/kpi-framework';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'kpiDashboard', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id } = await params;
    const scheme = await getKpiSchemeById(id);
    if (!scheme) return notFoundError('نظام المؤشرات غير موجود');

    return Response.json(scheme);
  } catch (error) {
    logServerFailure('kpi-schemes/[id]', 'GET', error);
    return internalError();
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const permCheck = await verifyPermission(request, 'kpiSettings', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return validationError('بيانات الطلب غير صحيحة');
    }

    const before = await getKpiSchemeById(id);

    let scheme: KpiScheme;
    try {
      scheme = await updateKpiScheme(
        id,
        {
          name: body.name,
          description: body.description,
          effectiveFrom: body.effectiveFrom,
          effectiveTo: body.effectiveTo,
          isDefault: body.isDefault,
          applicableDepartments: body.applicableDepartments,
          components: body.components,
          status: body.status,
        },
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
      action: 'kpi_scheme_update',
      entityType: 'settings',
      entityId: id,
      monthKey: null,
      before: before ? ({ ...before } as Record<string, unknown>) : null,
      after: { ...scheme } as Record<string, unknown>,
      details: `تعديل نظام مؤشرات أداء: ${scheme.name} (إصدار ${scheme.version})`,
    });

    return Response.json(scheme);
  } catch (error) {
    logServerFailure('kpi-schemes/[id]', 'PUT', error);
    return internalError();
  }
}
