// ══════════════════════════════════════════════════════════════
//  /api/kpi-schemes/[id]/activate
//
//  POST — activate a DRAFT scheme (kpiSettings update).
//
//  Enforced server-side by the service:
//    • ACTIVE component weights must total EXACTLY 100
//      (15+15+10+60 ✓ / 20+20+10+60 ✗) — invalid complete schemes
//      can never go live.
//    • No conflicting ACTIVE scheme over the same effective window /
//      resolution level — ambiguity FAILS SAFELY instead of letting
//      resolution pick an arbitrary scheme.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { verifyPermission } from '@/lib/verify-permission';
import {
  validationError, forbiddenError, internalError, logServerFailure,
} from '@/lib/api-error';
import { activateKpiScheme, KpiFrameworkValidationError } from '@/lib/kpi-framework';
import type { KpiScheme } from '@/lib/kpi-framework';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const permCheck = await verifyPermission(request, 'kpiSettings', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id } = await params;

    let scheme: KpiScheme;
    try {
      scheme = await activateKpiScheme(id, { id: permCheck.user?.id || 'system', name: '' });
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
      action: 'kpi_scheme_activate',
      entityType: 'settings',
      entityId: id,
      monthKey: null,
      before: null,
      after: { ...scheme } as Record<string, unknown>,
      details: `تفعيل نظام مؤشرات أداء: ${scheme.name} (إصدار ${scheme.version})`,
    });

    return Response.json(scheme);
  } catch (error) {
    logServerFailure('kpi-schemes/[id]/activate', 'POST', error);
    return internalError();
  }
}
