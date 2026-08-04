// ══════════════════════════════════════════════════════════════
//  /api/month-snapshots/[id]/close
//
//  POST — close (freeze) a month: generate the immutable snapshot
//  from current observations and persist it.
//
//  IDEMPOTENT: calling close on an already-closed month regenerates
//  the snapshot from current observations (refresh). This is safe
//  because reopen is the only operation that restores editability,
//  and close is always the last word on a month's scores.
//
//  Permission: 'approve' on 'monthClose' (manager/admin only).
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, createRecordWithId, invalidateCache, TTL } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError, validationError, notFoundError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { getKpiSettings } from '@/lib/kpi-settings';
import { computeMonthSnapshot } from '@/lib/metrics/kpiMetrics';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { makeRecordAuditEvent, writeQualityAudit } from '@/lib/audit/server-audit-logger';
import { notifyMonthClosed } from '@/lib/notifications/quality-events';
import { MONTH_SNAPSHOTS_TABLE, getMonthSnapshot } from '@/lib/month-lock';
import type { QualityObservation, MonthSnapshot } from '@/types/quality-kpi';
import type { EmployeeLike } from '@/lib/metrics/kpiMetrics';
import type { Employee } from '@/types';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const permCheck = await verifyPermission(request, 'monthClose', 'approve');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id: monthKey } = await params;

    // Validate month key format.
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      return validationError('صيغة الشهر غير صحيحة (YYYY-MM مطلوبة)');
    }

    const actor = await resolveActor(permCheck.user?.id);
    const now = new Date().toISOString();

    // ── Gather data for snapshot ──
    const settings = await getKpiSettings();
    const allObs = await getAll<QualityObservation>('qualityObservations', TTL.MEDIUM);
    const monthObs = allObs.filter((o) => o.month === monthKey);

    const employees = await getAll<Employee>('employees', TTL.MEDIUM);
    const empMap = new Map<string, EmployeeLike>();
    for (const e of employees) {
      empMap.set(e.id, {
        id: e.id,
        name: e.name,
        department: e.department,
        position: e.position,
      });
    }
    const supervisorMap = new Map<string, string | null>();

    // ── Compute the immutable snapshot (single source: kpiMetrics) ──
    const computed = computeMonthSnapshot(
      monthObs,
      monthKey,
      empMap,
      supervisorMap,
      settings,
    );

    // Preserve reopen history across a re-close (idempotent refresh).
    const previous = await getMonthSnapshot(monthKey);

    const auditEvent = makeRecordAuditEvent({
      action: previous?.status === 'closed' ? 'close_refresh' : 'close',
      actorId: actor.id,
      actorName: actor.name,
      details: previous?.status === 'closed'
        ? 'إعادة توليد لقطة الشهر'
        : `إغلاق شهر ${monthKey}`,
    });

    const snapshot: MonthSnapshot = {
      id: monthKey,
      schemaVersion: 1,
      monthKey,
      status: 'closed',
      closedAt: now,
      closedBy: actor.id,
      closedByName: actor.name,
      reopenCount: previous?.reopenCount ?? 0,
      reopenReason: previous?.reopenReason ?? '',
      auditLog: [...(previous?.auditLog || []), auditEvent],
      generatedAt: now,
      settingsSnapshot: settings,
      employeeScores: computed.employeeScores,
      departmentScores: computed.departmentScores,
      topEmployees: computed.topEmployees,
      bottomEmployees: computed.bottomEmployees,
      categoryTotals: computed.categoryTotals,
      approvalStats: computed.approvalStats,
    };

    // ── Persist (idempotent: createRecordWithId overwrites by monthKey) ──
    await createRecordWithId(MONTH_SNAPSHOTS_TABLE, monthKey, snapshot);
    await invalidateCache(MONTH_SNAPSHOTS_TABLE);

    // ── Audit trail + notification (fire-and-forget) ──
    await writeQualityAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'close_month',
      entityType: 'month',
      entityId: monthKey,
      monthKey,
      after: { monthKey, status: 'closed', closedAt: now } as Record<string, unknown>,
      details: `إغلاق شهر ${monthKey} (${Object.keys(snapshot.employeeScores).length} موظف)`,
    });

    await notifyMonthClosed(monthKey, actor.name);

    return Response.json(snapshot);
  } catch (error) {
    logServerFailure('month-snapshots/[id]/close', 'POST', error);
    return internalError();
  }
}
