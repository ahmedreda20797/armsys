import { NextRequest, NextResponse } from 'next/server';
import { getById, updateRecord, deleteRecord } from '@/lib/db';
import type { VerifyResult } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope } from '@/lib/scope/server';

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

    const complaint = await updateRecord('complaints', id, {
      ...(customerName !== undefined && { customerName }),
      ...(customerContact !== undefined && { customerContact }),
      ...(dealId !== undefined && { dealId }),
      ...(employeeId !== undefined && { employeeId }),
      ...(complaintType !== undefined && { complaintType }),
      ...(description !== undefined && { description }),
      ...(severity !== undefined && { severity }),
      ...(status !== undefined && { status }),
      ...(resolution !== undefined && { resolution }),
      ...(responsiblePerson !== undefined && { responsiblePerson }),
      ...(compensationProvided !== undefined && { compensationProvided }),
      ...(resolvedAt !== undefined && { resolvedAt }),
      ...(relatedCapaIds !== undefined && { relatedCapaIds }),
    });

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
    return NextResponse.json({ message: 'Complaint deleted successfully' });
  } catch (error) {
    console.error('Delete complaint error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
