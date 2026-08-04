// ══════════════════════════════════════════════════════════════
//  /api/quality-observations/[id]/approve
//
//  POST — manager approves a point-deduction observation.
//  Optional point override (manager may change points before approving).
//
//  Permission: 'approve' action on 'observations' (manager/admin only).
//  Quality staff CANNOT approve (enforced by permissions config).
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
import { makeApprovalEvent, appendApprovalEvent, projectLatestStatus } from '@/lib/approvals/approval-history';
import { makeRecordAuditEvent, writeQualityAudit } from '@/lib/audit/server-audit-logger';
import { notifyObservationApproved } from '@/lib/notifications/quality-events';
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

    // Only point-eligible observations can be approved.
    if (!existing.applyPointDeduction) {
      return validationError('هذه الملاحظة غير مفعّل عليها خصم النقاط');
    }

    // Already approved — idempotent return.
    if (existing.approvalStatus === 'approved') {
      return Response.json(existing);
    }

    // Guard: closed month is immutable.
    if (await isMonthClosed(existing.month)) {
      return lockedError(`الشهر ${existing.month} مغلق ولا يمكن اعتماد ملاحظاته`);
    }

    const body = await request.json().catch(() => ({}));
    const notes: string = body.notes || '';
    const overridePoints: number | undefined =
      body.points !== undefined ? Number(body.points) : undefined;

    const actor = await resolveActor(permCheck.user?.id);

    // Build the approval event (append-only — never overwrites history).
    const pointsBefore = existing.points;
    const pointsAfter = overridePoints !== undefined && !Number.isNaN(overridePoints)
      ? overridePoints
      : existing.points;

    const approveEvent = makeApprovalEvent({
      action: 'approve',
      actorId: actor.id,
      actorName: actor.name,
      notes: notes || 'موافقة',
      ...(overridePoints !== undefined ? { pointsBefore, pointsAfter } : {}),
    });

    const newHistory = appendApprovalEvent(existing.approvalHistory || [], approveEvent);
    const newStatus = projectLatestStatus(newHistory);

    // Audit log entry for this approval.
    const auditEvent = makeRecordAuditEvent({
      action: overridePoints !== undefined ? 'override' : 'approve',
      actorId: actor.id,
      actorName: actor.name,
      details: overridePoints !== undefined
        ? `اعتماد مع تجاوز النقاط من ${pointsBefore} إلى ${pointsAfter}`
        : 'اعتماد ملاحظة الجودة',
    });

    const updated = await updateRecord(OBSERVATIONS_TABLE, id, {
      points: pointsAfter,
      approvalStatus: newStatus,
      approvalHistory: newHistory,
      auditLog: [...(existing.auditLog || []), auditEvent],
    });
    if (!updated) return notFoundError('الملاحظة غير موجودة');

    // Audit trail + notification (fire-and-forget).
    await writeQualityAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: overridePoints !== undefined ? 'override' : 'approve',
      entityType: 'observation',
      entityId: id,
      monthKey: existing.month,
      before: { ...existing } as Record<string, unknown>,
      after: { ...updated } as Record<string, unknown>,
      details: `اعتماد ملاحظة جودة للموظف ${existing.employeeName}`,
    });

    await notifyObservationApproved(existing.employeeName, actor.name, id, pointsAfter);

    return Response.json(updated);
  } catch (error) {
    logServerFailure('quality-observations/[id]/approve', 'POST', error);
    return internalError();
  }
}
