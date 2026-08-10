// ══════════════════════════════════════════════════════════════
//  /api/quality-observations/[id]/reject
//
//  POST — manager rejects a point-deduction observation.
//  A rejected observation remains in history but has no KPI impact.
//
//  Permission: 'approve' action on 'observations' (manager/admin only).
//  Blocked if the month is closed (historical immutability).
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getById, updateRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError, notFoundError, lockedError, validationError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { isMonthClosed } from '@/lib/month-lock';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { makeApprovalEvent, appendApprovalEvent, projectLatestApprovalStatus } from '@/lib/approvals';
import { makeAuditEvent, writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';
import { notifyObservationRejected } from '@/lib/notifications/quality-events';
import type { QualityObservation } from '@/types/quality-kpi';
import { OBSERVATIONS_TABLE } from '../../route';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const permCheck = await verifyPermission(request, 'observations', 'approve');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id } = await params;
    const existing = await getById<QualityObservation>(OBSERVATIONS_TABLE, id);
    if (!existing) return notFoundError('الملاحظة غير موجودة');

    if (!existing.applyPointDeduction) {
      return validationError('هذه الملاحظة غير مفعّل عليها خصم النقاط');
    }

    // Already rejected — idempotent return.
    if (existing.approvalStatus === 'rejected') {
      return Response.json(existing);
    }

    // Guard: closed month is immutable.
    if (await isMonthClosed(existing.month)) {
      return lockedError(`الشهر ${existing.month} مغلق ولا يمكن رفض ملاحظاته`);
    }

    const body = await request.json().catch(() => ({}));
    const reason: string = body.reason || '';
    if (!reason) {
      return validationError('سبب الرفض مطلوب');
    }

    const actor = await resolveActor(permCheck.user?.id);

    const rejectEvent = makeApprovalEvent({
      action: 'reject',
      actorId: actor.id,
      actorName: actor.name,
      notes: reason,
    });

    const newHistory = appendApprovalEvent(existing.approvalHistory || [], rejectEvent);
    const newStatus = projectLatestApprovalStatus(newHistory);

    const auditEvent = makeAuditEvent({
      action: 'reject',
      actorId: actor.id,
      actorName: actor.name,
      details: `رفض ملاحظة الجودة: ${reason}`,
    });

    const updated = await updateRecord(OBSERVATIONS_TABLE, id, {
      approvalStatus: newStatus,
      approvalHistory: newHistory,
      auditLog: [...(existing.auditLog || []), auditEvent],
    });
    if (!updated) return notFoundError('الملاحظة غير موجودة');

    await writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action: 'reject',
      entityType: 'observation',
      entityId: id,
      monthKey: existing.month,
      before: { ...existing } as Record<string, unknown>,
      after: { ...updated } as Record<string, unknown>,
      reason,
      details: `رفض ملاحظة جودة للموظف ${existing.employeeName}`,
    });

    await notifyObservationRejected(existing.employeeName, actor.name, reason, id);

    return Response.json(updated);
  } catch (error) {
    logServerFailure('quality-observations/[id]/reject', 'POST', error);
    return internalError();
  }
}
