import { NextRequest, NextResponse } from 'next/server';
import { getById, updateRecord, deleteRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope } from '@/lib/scope/server';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { makeApprovalEvent, appendApprovalEvent, projectLatestApprovalStatus } from '@/lib/approvals';
import { writeAudit } from '@/lib/audit';
import { isMonthClosed } from '@/lib/month-lock';
import { QUALITY_DEDUCTIONS_TABLE } from '@/lib/quality-deductions/domain';
import { AUDIT_LOG_TABLE } from '../route';
import {
  assertAttachableEvidenceImages,
  projectLegacyEvidenceFields,
  sanitizeEvidenceItems,
  stampEvidenceItems,
} from '@/lib/evidence-items';
import { commitEvidenceItems, deleteEvidenceObjects, evidenceImageItemPaths } from '@/lib/evidence-storage';
import { FirebaseConfigError } from '@/lib/firebase-server';
import type { EvidenceItem } from '@/types';

/** §WORKFLOW — business fields whose change invalidates an approval. */
const AUDITED_FIELDS = [
  'date', 'type', 'description', 'deductionDays', 'deductionAmount',
  'evidence', 'month', 'relatedCapaId',
] as const;

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'update' permission
    const permCheck = await verifyPermission(request, 'quality', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    // ── TARGET RESOURCE + DATA SCOPE (M0.4) ──
    // The stored deduction's employeeId governs (this route cannot
    // reassign it); out-of-scope → 404 identical to the missing
    // record path (anti-enumeration).
    const existing = await getById<any>(QUALITY_DEDUCTIONS_TABLE, id);
    if (!existing) {
      return NextResponse.json({ error: 'Quality deduction not found' }, { status: 404 });
    }
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      existing.employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'Quality deduction not found' }, { status: 404 });
    }

    const { date, type, description, deductionDays, deductionAmount, evidence, month, relatedCapaId } = body;

    // §WORKFLOW — closed month immutability (month of the STORED
    // record governs; moving a record to another closed month is
    // blocked too).
    if (await isMonthClosed(existing.month) || (month && month !== existing.month && await isMonthClosed(month))) {
      return NextResponse.json({ error: 'الشهر مغلق ولا يمكن تعديل خصوماته' }, { status: 423 });
    }

    // §AUDIT — hidden updater metadata, resolved server-side. The
    // archive stamp below reuses the SAME resolved actor identity.
    const actor = await resolveActor(permCheck.user?.id);

    const updates: Record<string, any> = {
      // §ARCHIVE — archive/restore is its own audited operation. It is
      // NOT a business-field edit: it never invalidates the approval, and
      // it is allowed even for closed months (the archived record stops
      // affecting ACTIVE totals going forward while the closed snapshot
      // and historical reports stay intact).
      ...(body.archived === true && {
        archived: true,
        archivedAt: new Date().toISOString(),
        archivedBy: actor.id,
        archivedByName: actor.name,
      }),
      ...(body.archived === false && {
        archived: false, archivedAt: null, archivedBy: null, archivedByName: null,
      }),
      ...(date !== undefined && { date }),
      ...(type !== undefined && { type }),
      ...(description !== undefined && { description }),
      ...(deductionDays !== undefined && { deductionDays: Number(deductionDays) }),
      ...(deductionAmount !== undefined && { deductionAmount: Number(deductionAmount) }),
      ...(evidence !== undefined && { evidence }),
      ...(month !== undefined && { month }),
      ...(relatedCapaId !== undefined && { relatedCapaId }),
    };

    // ── §EVIDENCE-ITEMS — normalized multi-item evidence ──
    // The projected legacy `evidence` lands in `updates` too, so the
    // audited-business-field logic below treats an evidence edit the
    // same way it always has (approval invalidation §WORKFLOW).
    let updatedEvidenceItems: EvidenceItem[] | null = null;
    if (body.evidenceItems !== undefined) {
      const parsedEvidence = sanitizeEvidenceItems(body.evidenceItems);
      if (!parsedEvidence.ok) return NextResponse.json({ error: parsedEvidence.error }, { status: 400 });
      const attachError = assertAttachableEvidenceImages(parsedEvidence.items, existing.evidenceItems ?? null);
      if (attachError) return NextResponse.json({ error: attachError }, { status: 400 });
      updatedEvidenceItems = stampEvidenceItems(parsedEvidence.items, new Date().toISOString(), actor.id);
      updates.evidenceItems = updatedEvidenceItems;
      updates.evidence = projectLegacyEvidenceFields(updatedEvidenceItems, 'nullable-string').evidence as string | null;
    }

    updates.updatedBy = actor.id;
    updates.updatedByName = actor.name;

    // §WORKFLOW — editing a business field on an APPROVED discount
    // invalidates the approval: an editor WITHOUT the approve
    // permission sends it back to PENDING (it stops affecting
    // totals until re-approved). An editor WITH the permission keeps
    // it effective. The approval history stays append-only. The
    // check goes through the canonical verifyPermission gate (which
    // owns the System Owner bypass) — no role strings here.
    const touchesBusinessFields = Object.keys(updates).some((k) =>
      (AUDITED_FIELDS as readonly string[]).includes(k),
    );
    const approveCheck = await verifyPermission(request, 'quality', 'approve');
    const canApprove = approveCheck.allowed;
    if (touchesBusinessFields && !canApprove && existing.approvalStatus === 'approved') {
      const reopenEvent = makeApprovalEvent({
        action: 'reopen',
        actorId: actor.id,
        actorName: actor.name,
        notes: 'تعديل على خصم معتمد — يعود لقيد الاعتماد',
      });
      const history = appendApprovalEvent(existing.approvalHistory || [], reopenEvent);
      const submitEvent = makeApprovalEvent({
        action: 'submit',
        actorId: actor.id,
        actorName: actor.name,
        notes: 'إعادة إرسال بعد التعديل',
      });
      const newHistory = appendApprovalEvent(history, submitEvent);
      updates.approvalStatus = projectLatestApprovalStatus(newHistory);
      updates.approvalHistory = newHistory;
    }

    let qualityDeduction: Record<string, unknown> | null = null;
    if (updatedEvidenceItems) {
      // §21 — staged images promote to final parent-bound paths, the
      // record persists with the promoted items, removed image objects
      // are cleaned up only after a successful write.
      try {
        await commitEvidenceItems(
          QUALITY_DEDUCTIONS_TABLE, id, updatedEvidenceItems, existing.evidenceItems ?? null,
          async (items) => {
            qualityDeduction = await updateRecord(QUALITY_DEDUCTIONS_TABLE, id, { ...updates, evidenceItems: items });
          },
        );
      } catch (error) {
        if (error instanceof FirebaseConfigError) {
          return NextResponse.json({ error: error.message, errorKey: 'FIREBASE_CONFIG' }, { status: 503 });
        }
        console.error('Commit evidence items error:', error);
        return NextResponse.json({ error: 'فشل حفظ أدلة الصورة — حاول مرة أخرى' }, { status: 500 });
      }
    } else {
      qualityDeduction = await updateRecord(QUALITY_DEDUCTIONS_TABLE, id, updates);
    }

    // Fire-and-forget audit trail.
    void writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action: 'update',
      entityType: 'qualityDeduction',
      entityId: id,
      monthKey: existing.month ?? null,
      before: existing as Record<string, unknown>,
      after: qualityDeduction as Record<string, unknown>,
      details: `تعديل خصم جودة${updates.approvalStatus === 'pending' ? ' — أُعيد لقيد الاعتماد' : ''}`,
    });

    return NextResponse.json(qualityDeduction);
  } catch (error) {
    console.error('Update quality deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'delete' permission
    const permCheck = await verifyPermission(request, 'quality', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;

    // ── TARGET RESOURCE + DATA SCOPE (M0.4) ──
    // Resolve the stored deduction's employee BEFORE deleting;
    // out-of-scope → 404 identical to the missing path.
    const existing = await getById<any>(QUALITY_DEDUCTIONS_TABLE, id);
    if (!existing) {
      return NextResponse.json({ error: 'Quality deduction not found' }, { status: 404 });
    }
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      existing.employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'Quality deduction not found' }, { status: 404 });
    }

    // §WORKFLOW — closed month immutability.
    if (await isMonthClosed(existing.month)) {
      return NextResponse.json({ error: 'الشهر مغلق ولا يمكن حذف خصوماته' }, { status: 423 });
    }

    await deleteRecord(QUALITY_DEDUCTIONS_TABLE, id);

    // §EVIDENCE-ITEMS — the record is gone; its parent-bound image
    // objects (record-scoped paths) go with it. Best-effort.
    void deleteEvidenceObjects(evidenceImageItemPaths(existing.evidenceItems));

    // Fire-and-forget audit trail (after removal — snapshot is in `before`).
    const actor = await resolveActor(permCheck.user?.id);
    void writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action: 'delete',
      entityType: 'qualityDeduction',
      entityId: id,
      monthKey: existing.month ?? null,
      before: existing as Record<string, unknown>,
      after: null,
      details: 'حذف خصم جودة',
    });

    return NextResponse.json({ message: 'Quality deduction deleted successfully' });
  } catch (error) {
    console.error('Delete quality deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
