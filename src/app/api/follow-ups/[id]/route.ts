import { NextRequest, NextResponse } from 'next/server';
import { getById, updateRecord, deleteRecord } from '@/lib/db';
import { asScopeViewer, employeeInScope } from '@/lib/scope/server';
import { assertSimpleValueIsActive } from '@/lib/master-data/simple-lists';
import {
  assertAttachableEvidenceImages,
  projectLegacyEvidenceFields,
  sanitizeEvidenceItems,
  stampEvidenceItems,
} from '@/lib/evidence-items';
import { commitEvidenceItems, deleteEvidenceObjects, evidenceImageItemPaths } from '@/lib/evidence-storage';
import { FirebaseConfigError } from '@/lib/firebase-server';
import type { EvidenceItem } from '@/types';

const SCORE_MAP: Record<string, number> = { low: 1, medium: 3, high: 5, critical: 10 };

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'followUps', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    // ── TARGET RESOURCE + DATA SCOPE (M0.4) ──
    // The stored follow-up's employeeId is the authorization target;
    // a body.employeeId reassignment additionally requires the NEW
    // target to be in scope. Out-of-scope → 404 identical to the
    // missing-record path (anti-enumeration).
    const existing = await getById('followUps', id);
    if (!existing) {
      return NextResponse.json({ error: 'Follow-up not found' }, { status: 404 });
    }
    const viewer = asScopeViewer(permCheck.user!);
    const storedOk = await employeeInScope(viewer, permCheck.user!.permissions, existing.employeeId);
    const reassignTarget = typeof body?.employeeId === 'string' ? body.employeeId : null;
    const targetOk = !reassignTarget || reassignTarget === existing.employeeId
      ? true
      : await employeeInScope(viewer, permCheck.user!.permissions, reassignTarget);
    if (!storedOk || !targetOk) {
      return NextResponse.json({ error: 'Follow-up not found' }, { status: 404 });
    }

    // ── §MASTER-DATA deactivation guard — a follow-up type
    // deactivated in the Settings Center cannot be (re)selected;
    // unknown/legacy values stay accepted (guard, not a whitelist).
    if (typeof body?.followUpType === 'string') {
      const typeGuard = await assertSimpleValueIsActive('followUpTypes', body.followUpType);
      if (typeGuard) {
        return NextResponse.json({ error: typeGuard }, { status: 400 });
      }
    }

    // Re-calculate score if priority changed
    const updateData: Record<string, any> = {};
    const fields = [
      'employeeId', 'date', 'followUpType', 'subject', 'detailedDescription',
      'positiveNotes', 'negativeNotes', 'rootCause', 'actionTaken',
      'department', 'position', 'responsiblePerson', 'nextFollowUpDate',
      'followUpRequired', 'status', 'attachments', 'evidence',
      'relatedDeductionId', 'relatedCapaId',
    ] as const;

    for (const field of fields) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }

    if (body.priorityLevel !== undefined) {
      updateData.priorityLevel = body.priorityLevel;
      updateData.score = SCORE_MAP[body.priorityLevel] || 3;
    }

    // ── §EVIDENCE-ITEMS — normalized multi-item evidence; the legacy
    // `evidence` string + `attachments` URL list are re-projected from
    // the canonical items (§17).
    let updatedEvidenceItems: EvidenceItem[] | null = null;
    if (body.evidenceItems !== undefined) {
      const parsedEvidence = sanitizeEvidenceItems(body.evidenceItems);
      if (!parsedEvidence.ok) return NextResponse.json({ error: parsedEvidence.error }, { status: 400 });
      const attachError = assertAttachableEvidenceImages(parsedEvidence.items, existing.evidenceItems ?? null);
      if (attachError) return NextResponse.json({ error: attachError }, { status: 400 });
      updatedEvidenceItems = stampEvidenceItems(parsedEvidence.items, new Date().toISOString(), permCheck.user?.id || 'system');
      const legacy = projectLegacyEvidenceFields(updatedEvidenceItems, 'followup');
      updateData.evidenceItems = updatedEvidenceItems;
      updateData.evidence = legacy.evidence;
      updateData.attachments = legacy.attachments;
    }

    let followUp: Record<string, unknown> | null = null;
    if (updatedEvidenceItems) {
      // §21 — promote staged images, persist, then clean removed
      // objects only after a successful write.
      try {
        await commitEvidenceItems(
          'followUps', id, updatedEvidenceItems, existing.evidenceItems ?? null,
          async (items) => {
            followUp = await updateRecord('followUps', id, { ...updateData, evidenceItems: items });
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
      followUp = await updateRecord('followUps', id, updateData);
    }

    return NextResponse.json(followUp);
  } catch (error) {
    console.error('Update follow-up error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'followUps', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;

    // ── TARGET RESOURCE + DATA SCOPE (M0.4) ──
    // Resolve the stored follow-up's employee BEFORE deleting;
    // out-of-scope → 404 identical to the missing path.
    const existing = await getById('followUps', id);
    if (!existing) {
      return NextResponse.json({ error: 'Follow-up not found' }, { status: 404 });
    }
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      existing.employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'Follow-up not found' }, { status: 404 });
    }

    await deleteRecord('followUps', id);

    // §EVIDENCE-ITEMS — the record is gone; its parent-bound image
    // objects (record-scoped paths) go with it. Best-effort.
    void deleteEvidenceObjects(evidenceImageItemPaths(existing.evidenceItems));

    return NextResponse.json({ message: 'Follow-up deleted successfully' });
  } catch (error) {
    console.error('Delete follow-up error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
