// ══════════════════════════════════════════════════════════════
//  /api/kpi-schemes
//
//  GET  — list KPI schemes (kpiDashboard view — Quality users can
//         SEE the active scheme and component weights, per the
//         existing permission model; nothing is granted beyond it)
//  POST — create a scheme (kpiSettings update). Always created as
//         DRAFT; weight-total validity is enforced at activation.
//
//  Reuses the existing permission architecture — no new
//  authorization system.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  validationError, forbiddenError, unauthorizedError, internalError, logServerFailure,
} from '@/lib/api-error';
import { createKpiScheme, listKpiSchemes, KpiFrameworkValidationError } from '@/lib/kpi-framework';
import type { KpiScheme } from '@/lib/kpi-framework';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';

const SCHEME_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'kpiDashboard', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    let schemes: KpiScheme[] = await listKpiSchemes();

    const status = request.nextUrl.searchParams.get('status');
    if (status) {
      if (!SCHEME_STATUSES.includes(status as (typeof SCHEME_STATUSES)[number])) {
        return validationError('حالة نظام المؤشرات غير مدعومة');
      }
      schemes = schemes.filter((s) => s.status === status);
    }

    return Response.json(schemes);
  } catch (error) {
    logServerFailure('kpi-schemes', 'GET', error);
    return internalError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'kpiSettings', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return validationError('بيانات الطلب غير صحيحة');
    }

    let scheme: KpiScheme;
    try {
      scheme = await createKpiScheme(
        {
          name: body.name,
          description: body.description,
          effectiveFrom: body.effectiveFrom,
          effectiveTo: body.effectiveTo,
          isDefault: body.isDefault,
          applicableDepartments: body.applicableDepartments,
          components: body.components,
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
      action: 'kpi_scheme_create',
      entityType: 'settings',
      entityId: scheme.id,
      monthKey: null,
      before: null,
      after: { ...scheme } as Record<string, unknown>,
      details: `إنشاء نظام مؤشرات أداء: ${scheme.name} (إصدار ${scheme.version})`,
    });

    return Response.json(scheme);
  } catch (error) {
    logServerFailure('kpi-schemes', 'POST', error);
    return internalError();
  }
}
