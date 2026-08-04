// ══════════════════════════════════════════════════════════════
//  /api/kpi-settings
//
//  GET — fetch the singleton KPI settings (requireAuth)
//  PUT — update KPI settings (manager edit)
//
//  The engine reads its behavior from this config — no hardcoded
//  values anywhere in the KPI pipeline.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError, unauthorizedError, internalError, logServerFailure,
} from '@/lib/api-error';
import { getKpiSettings, updateKpiSettings } from '@/lib/kpi-settings';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeQualityAudit } from '@/lib/audit/server-audit-logger';
import type { KpiSettings, TrendCalculation } from '@/types/quality-kpi';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const settings = await getKpiSettings();
    return Response.json(settings);
  } catch (error) {
    logServerFailure('kpi-settings', 'GET', error);
    return internalError();
  }
}

export async function PUT(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'kpiSettings', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const body = await request.json();
    const allowedFields: Array<keyof KpiSettings> = [
      'defaultScore', 'minimumScore', 'allowBonus', 'maximumBonus',
      'approvalRequired', 'leaderboardEnabled', 'closeMonthLock', 'trendCalculation',
    ];
    const patch: Partial<KpiSettings> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        // Type-safe assignment per field kind.
        const value = body[field];
        if (field === 'allowBonus' || field === 'approvalRequired' || field === 'leaderboardEnabled' || field === 'closeMonthLock') {
          (patch as Record<string, unknown>)[field] = Boolean(value);
        } else if (field === 'defaultScore' || field === 'minimumScore' || field === 'maximumBonus') {
          (patch as Record<string, unknown>)[field] = Number(value);
        } else if (field === 'trendCalculation') {
          (patch as Record<string, unknown>)[field] = value as TrendCalculation;
        }
      }
    }

    const before = await getKpiSettings();
    const updated = await updateKpiSettings(patch, permCheck.user?.id || 'system', '');

    const actor = await resolveActor(permCheck.user?.id);
    await writeQualityAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'update',
      entityType: 'settings',
      entityId: 'singleton',
      monthKey: null,
      before: { ...before } as Record<string, unknown>,
      after: { ...updated } as Record<string, unknown>,
      details: 'تعديل إعدادات مؤشرات الأداء',
    });

    return Response.json(updated);
  } catch (error) {
    logServerFailure('kpi-settings', 'PUT', error);
    return internalError();
  }
}
