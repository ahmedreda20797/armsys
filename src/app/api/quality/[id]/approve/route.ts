// ══════════════════════════════════════════════════════════════
//  /api/quality/[id]/approve
//
//  §WORKFLOW — POST: an authorized approver approves a PENDING
//  quality discount. Only then does the discount affect reports,
//  totals, payroll and employee records.
//
//  Permission: 'approve' action on 'quality' (manager/admin — the
//  authority is PERMISSION-based, never a hardcoded email; grant the
//  action to any future Quality Manager from the control panel).
//  Blocked when the month is closed (historical immutability).
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
    const permCheck = await verifyPermission(request, 'quality', 'approve');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id } = await params;
    const existing = await getById<any>(QUALITY_DEDUCTIONS_TABLE, id);
    if (!existing) return notFoundError('الخصم غير موجود');

    // Already approved — idempotent return.
    if (existing.approvalStatus === 'approved') {
      return Response.json(existing);
    }
    if (existing.approvalStatus === 'rejected') {
      return validationError('لا يمكن اعتماد خصم مرفوض — أنشئ خصماً جديداً');
    }

    // Guard: closed month is immutable.
    if (await isMonthClosed(existing.month)) {
      return lockedError(`الشهر ${existing.month} مغلق ولا يمكن اعتماد خصوماته`);
    }

    // ── DATA SCOPE (M0.4) ── approval is a mutation on the stored
    // employee's record; out-of-scope → identical 404 (anti-enumeration).
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      existing.employeeId,
    );
    if (!inScope) return notFoundError('الخصم غير موجود');

    const body = await request.json().catch(() => ({}));
    const notes: string = body.notes || '';

    const actor = await resolveActor(permCheck.user?.id);

    const approveEvent = makeApprovalEvent({
      action: 'approve',
      actorId: actor.id,
      actorName: actor.name,
      notes: notes || 'اعتماد الخصم',
    });
    const newHistory = appendApprovalEvent(existing.approvalHistory || [], approveEvent);
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
      action: 'approve',
      entityType: 'qualityDeduction',
      entityId: id,
      monthKey: existing.month ?? null,
      before: { ...existing } as Record<string, unknown>,
      after: { ...updated } as Record<string, unknown>,
      details: `اعتماد خصم جودة (${existing.deductionDays || 0} يوم)`,
    });
    void dispatchAutomationEvent('status_changed', 'quality', {
      employeeId: existing.employeeId,
      status: newStatus,
      category: existing.type,
      sourceRecordId: id,
      extra: { month: existing.month, previousStatus: existing.approvalStatus ?? 'pending' },
    });

    // §APPROVAL-NOTIFY — the creator learns the outcome without
    // polling the page (directed, permission-visibility-gated).
    void notifyQualityDiscountDecided({
      recordId: id,
      decision: 'approved',
      employeeId: existing.employeeId,
      actorId: actor.id,
      actorName: actor.name,
      creatorUserId: existing.createdById ?? existing.createdByUserId ?? null,
    });

    return Response.json(updated);
  } catch (error) {
    logServerFailure('quality/[id]/approve', 'POST', error);
    return internalError();
  }
}
