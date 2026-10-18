import { NextRequest, NextResponse } from 'next/server';
import { normalizeComplaintStatus } from '@/lib/complaints/complaint-status';
import { getById, updateRecord, deleteRecord } from '@/lib/db';
import type { VerifyResult } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope } from '@/lib/scope/server';
import { assertSimpleValueIsActive } from '@/lib/master-data/simple-lists';
import {
  assertAttachableEvidenceImages,
  sanitizeEvidenceItems,
  stampEvidenceItems,
} from '@/lib/evidence-items';
import { commitEvidenceItems, deleteEvidenceObjects, evidenceImageItemPaths } from '@/lib/evidence-storage';
import { FirebaseConfigError } from '@/lib/firebase-server';
import type { EvidenceItem } from '@/types';

/** Scope guard for an OPTIONALLY employee-linked record (M0.4):
 *  a stored or incoming employee link must sit inside the caller's
 *  employee scope; unlinked records pass on permission alone. */
async function complaintInScope(
  permCheck: VerifyResult,
  storedEmployeeId: string | null | undefined,
  incomingEmployeeId: unknown,
): Promise<boolean> {
  const viewer = asScopeViewer(permCheck.user!);
  if (storedEmployeeId) {
    if (!(await employeeInScope(viewer, permCheck.user!.permissions, storedEmployeeId))) return false;
  }
  if (typeof incomingEmployeeId === 'string' && incomingEmployeeId && incomingEmployeeId !== storedEmployeeId) {
    if (!(await employeeInScope(viewer, permCheck.user!.permissions, incomingEmployeeId))) return false;
  }
  return true;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'complaints', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const {
      customerName,
      customerContact,
      dealId,
      employeeId,
      complaintType,
      description,
      severity,
      status,
      resolution,
      responsiblePerson,
      compensationProvided,
      resolvedAt,
      relatedCapaIds,
      evidenceItems: incomingEvidenceItems,
    } = body;

    // ── TARGET RESOURCE + DATA SCOPE (M0.4) ──
    // The stored link governs; a body.employeeId reassignment (or
    // new link) must ALSO be in scope. Out-of-scope → 404 identical
    // to the missing path (anti-enumeration).
    const existing = await getById('complaints', id);
    if (!existing) {
      return NextResponse.json({ error: 'Complaint not found' }, { status: 404 });
    }
    const inScope = await complaintInScope(permCheck, existing.employeeId, employeeId);
    if (!inScope) {
      return NextResponse.json({ error: 'Complaint not found' }, { status: 404 });
    }

    // ── §MASTER-DATA deactivation guard — a complaint type
    // deactivated in the Settings Center cannot be (re)selected;
    // unknown/legacy values stay accepted (guard, not a whitelist).
    if (typeof complaintType === 'string') {
      const typeGuard = await assertSimpleValueIsActive('complaintTypes', complaintType);
      if (typeGuard) {
        return NextResponse.json({ error: typeGuard }, { status: 400 });
      }
    }

    // §COMPLAINT-STATUS — canonical vocabulary on write (legacy alias
    // 'investigating' maps to under_investigation; unknown → 400).
    let normalizedStatus: string | undefined;
    if (status !== undefined) {
      const normalized = normalizeComplaintStatus(status);
      if (!normalized) {
        return NextResponse.json({ error: 'حالة الشكوى غير صالحة' }, { status: 400 });
      }
      normalizedStatus = normalized;
    }

    let updatedEvidenceItems: EvidenceItem[] | null = null;
    if (incomingEvidenceItems !== undefined) {
      const parsedEvidence = sanitizeEvidenceItems(incomingEvidenceItems);
      if (!parsedEvidence.ok) return NextResponse.json({ error: parsedEvidence.error }, { status: 400 });
      const attachError = assertAttachableEvidenceImages(parsedEvidence.items, existing.evidenceItems ?? null);
      if (attachError) return NextResponse.json({ error: attachError }, { status: 400 });
      updatedEvidenceItems = stampEvidenceItems(
        parsedEvidence.items, new Date().toISOString(), permCheck.user?.id || 'system',
      );
    }

    const patch = {
      ...(customerName !== undefined && { customerName }),
      ...(customerContact !== undefined && { customerContact }),
      ...(dealId !== undefined && { dealId }),
      ...(employeeId !== undefined && { employeeId }),
      ...(complaintType !== undefined && { complaintType }),
      ...(description !== undefined && { description }),
      ...(severity !== undefined && { severity }),
      ...(status !== undefined && { status: normalizedStatus }),
      ...(resolution !== undefined && { resolution }),
      ...(responsiblePerson !== undefined && { responsiblePerson }),
      ...(compensationProvided !== undefined && { compensationProvided }),
      ...(resolvedAt !== undefined && { resolvedAt }),
      ...(relatedCapaIds !== undefined && { relatedCapaIds }),
    };

    let complaint: Record<string, unknown> | null = null;
    if (updatedEvidenceItems) {
      // §21 — promote staged images, persist, then clean removed
      // objects only after a successful write.
      try {
        await commitEvidenceItems(
          'complaints', id, updatedEvidenceItems, existing.evidenceItems ?? null,
          async (items) => {
            complaint = await updateRecord('complaints', id, { ...patch, evidenceItems: items });
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
      complaint = await updateRecord('complaints', id, patch);
    }

    return NextResponse.json(complaint);
  } catch (error) {
    console.error('Update complaint error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'complaints', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;

    // ── TARGET RESOURCE + DATA SCOPE (M0.4) ──
    // Resolve the stored link BEFORE deleting; out-of-scope → 404
    // identical to the missing path.
    const existing = await getById('complaints', id);
    if (!existing) {
      return NextResponse.json({ error: 'Complaint not found' }, { status: 404 });
    }
    const inScope = await complaintInScope(permCheck, existing.employeeId, null);
    if (!inScope) {
      return NextResponse.json({ error: 'Complaint not found' }, { status: 404 });
    }

    await deleteRecord('complaints', id);

    // §EVIDENCE-ITEMS — the record is gone; its parent-bound image
    // objects (record-scoped paths) go with it. Best-effort.
    void deleteEvidenceObjects(evidenceImageItemPaths(existing.evidenceItems));

    return NextResponse.json({ message: 'Complaint deleted successfully' });
  } catch (error) {
    console.error('Delete complaint error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
