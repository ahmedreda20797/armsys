import { NextRequest, NextResponse } from 'next/server';
import { getById, updateRecord, deleteRecord } from '@/lib/db';
import { asScopeViewer, employeeInScope } from '@/lib/scope/server';

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

    // Re-calculate score if priority changed
    const updateData: Record<string, any> = {};
    const fields = [
      'employeeId', 'date', 'followUpType', 'subject', 'detailedDescription',
      'positiveNotes', 'negativeNotes', 'rootCause', 'actionTaken',
      'department', 'position', 'responsiblePerson', 'nextFollowUpDate',
      'followUpRequired', 'status', 'attachments', 'relatedDeductionId', 'relatedCapaId',
    ] as const;

    for (const field of fields) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }

    if (body.priorityLevel !== undefined) {
      updateData.priorityLevel = body.priorityLevel;
      updateData.score = SCORE_MAP[body.priorityLevel] || 3;
    }

    const followUp = await updateRecord('followUps', id, updateData);

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
    return NextResponse.json({ message: 'Follow-up deleted successfully' });
  } catch (error) {
    console.error('Delete follow-up error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
