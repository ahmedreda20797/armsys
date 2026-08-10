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
  validationError, forbiddenError, unauthorizedError, internalError, logServerFailure,
} from '@/lib/api-error';
import { getKpiSettings, updateKpiSettings } from '@/lib/kpi-settings';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';
import type { KpiSettings, TrendCalculation } from '@/types/quality-kpi';

/** The set of supported trend-calculation modes. */
const TREND_CALCULATIONS: readonly TrendCalculation[] = [
  'rollingAverage', 'movingScore', 'simpleAverage',
];

/** True when value is a finite number (rejects NaN, Infinity, non-numbers). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

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

    // ── Parse and validate each allowed field ──
    const patch: Partial<KpiSettings> = {};

    // Boolean fields must be actual booleans.
    for (const f of ['allowBonus', 'approvalRequired', 'leaderboardEnabled', 'closeMonthLock'] as const) {
      if (body[f] !== undefined) {
        if (typeof body[f] !== 'boolean') {
          return validationError(`الحقل ${f} يجب أن يكون قيمة منطقية (true/false)`);
        }
        (patch as Record<string, unknown>)[f] = body[f];
      }
    }

    // Numeric fields must be finite and non-negative.
    const numericFields = ['defaultScore', 'minimumScore', 'maximumBonus'] as const;
    const numericValues: Record<string, number> = {};
    for (const f of numericFields) {
      if (body[f] !== undefined) {
        if (!isFiniteNumber(body[f])) {
          return validationError(`الحقل ${f} يجب أن يكون رقماً صالحاً`);
        }
        if ((body[f] as number) < 0) {
          return validationError(`الحقل ${f} يجب أن يكون موجباً أو صفراً`);
        }
        numericValues[f] = body[f] as number;
        (patch as Record<string, unknown>)[f] = body[f] as number;
      }
    }

    // trendCalculation must be one of the supported enum values.
    if (body.trendCalculation !== undefined) {
      if (!TREND_CALCULATIONS.includes(body.trendCalculation as TrendCalculation)) {
        return validationError('طريقة حساب الاتجاه غير مدعومة');
      }
      (patch as Record<string, unknown>).trendCalculation = body.trendCalculation as TrendCalculation;
    }

    // Cross-field rule: minimumScore cannot exceed defaultScore.
    // Evaluate against the incoming value if provided, else the current setting.
    const before = await getKpiSettings();
    const effectiveDefault = numericValues.defaultScore ?? before.defaultScore;
    const effectiveMinimum = numericValues.minimumScore ?? before.minimumScore;
    if (effectiveMinimum > effectiveDefault) {
      return validationError('الحد الأدنى للنقاط لا يمكن أن يتجاوز النقاط الافتراضية');
    }

    const updated = await updateKpiSettings(patch, permCheck.user?.id || 'system', '');

    const actor = await resolveActor(permCheck.user?.id);
    await writeAudit({
      collection: AUDIT_LOG_TABLE,
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
