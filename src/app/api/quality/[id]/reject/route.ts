// ══════════════════════════════════════════════════════════════
//  /api/quality/[id]/reject
//
//  §WORKFLOW — POST: an authorized approver rejects a PENDING
//  quality discount. Rejected discounts NEVER affect reports,
//  totals, payroll or employee records.
//
//  Permission: 'reject' action on 'quality' — with the legacy
//  'approve' grant accepted as an equivalent authority so existing
//  approver permission maps keep working (verifyAnyAction). Blocked
//  when the month is closed.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getById, updateRecord } from '@/lib/db';
import { verifyAnyAction } from '@/lib/verify-permission';
import {
  forbiddenError, notFoundError, lockedError, validationError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { isMonthClosed } from '@/lib/month-lock';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { asScopeViewer, employeeInScope } from '@/lib/scope/server';
import { dispatchAutomationEvent } from '@/lib/automation/event-bridge';
import { makeApprovalEvent, appendApprovalEvent, projectLatestApprovalStatus } from '@/lib/approvals';
import { writeAudit } from '@/lib/audit';
import { notifyQualityDiscountDecided } from '@/lib/notifications/quality-approval-events';
import { QUALITY_DEDUCTIONS_TABLE } from '@/lib/quality-deductions/domain';
import { AUDIT_LOG_TABLE } from '../../route';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const permCheck = await verifyAnyAction(request, 'quality', ['reject', 'approve']);
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id } = await params;
    const existing = await getById<any>(QUALITY_DEDUCTIONS_TABLE, id);
    if (!existing) return notFoundError('الخصم غير موجود');

    // Already rejected — idempotent return.
    if (existing.approvalStatus === 'rejected') {
      return Response.json(existing);
    }

    // Guard: closed month is immutable.
    if (await isMonthClosed(existing.month)) {
      return lockedError(`الشهر ${existing.month} مغلق ولا يمكن رفض خصوماته`);
    }

    // ── DATA SCOPE (M0.4) ── same 404 semantics as approve.
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      existing.employeeId,
    );
    if (!inScope) return notFoundError('الخصم غير موجود');

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

    const updated = await updateRecord(QUALITY_DEDUCTIONS_TABLE, id, {
      approvalStatus: newStatus,
      approvalHistory: newHistory,
    });
    if (!updated) return notFoundError('الخصم غير موجود');

    // Fire-and-forget audit trail + automation event.
    void writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action: 'reject',
      entityType: 'qualityDeduction',
      entityId: id,
      monthKey: existing.month ?? null,
      before: { ...existing } as Record<string, unknown>,
      after: { ...updated } as Record<string, unknown>,
      reason,
      details: `رفض خصم جودة — السبب: ${reason}`,
    });
    void dispatchAutomationEvent('status_changed', 'quality', {
      employeeId: existing.employeeId,
      status: newStatus,
      category: existing.type,
      sourceRecordId: id,
      extra: { month: existing.month, previousStatus: existing.approvalStatus ?? 'pending', reason },
    });

    // §APPROVAL-NOTIFY — directed outcome notification for the creator.
    void notifyQualityDiscountDecided({
      recordId: id,
      decision: 'rejected',
      employeeId: existing.employeeId,
      actorId: actor.id,
      actorName: actor.name,
      creatorUserId: existing.createdById ?? existing.createdByUserId ?? null,
      reason,
    });

    return Response.json(updated);
  } catch (error) {
    logServerFailure('quality/[id]/reject', 'POST', error);
    return internalError();
  }
}
