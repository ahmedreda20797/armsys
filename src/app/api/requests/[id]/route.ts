import { NextRequest, NextResponse } from 'next/server';
import { updateRecord, deleteRecord, getById, createRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope } from '@/lib/scope/server';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, reviewedBy } = body;

    // ── TARGET RESOURCE (M0.4) ──
    // Approve/reject AND plain updates mutate an employee-linked
    // record: the STORED request's employeeId is the authoritative
    // authorization target. A client-supplied employeeId in the body
    // can never retarget authorization — the persisted resource is
    // the source of truth. Out-of-scope → 404 identical to the
    // missing-request path (anti-enumeration).
    const req = await getById('requests', id);
    if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

    if (status !== 'approved' && status !== 'rejected') {
      // Regular update — check 'update' permission
      const permCheck = await verifyPermission(request, 'requests', 'update');
      if (!permCheck.allowed) {
        return NextResponse.json({ error: permCheck.error }, { status: 403 });
      }

      // ── DATA SCOPE (M0.4) ── — the stored employee governs; if the
      // patch reassigns the request to another employee, that target
      // must also be in scope.
      const viewer = asScopeViewer(permCheck.user!);
      const storedOk = await employeeInScope(viewer, permCheck.user!.permissions, req.employeeId);
      const reassignTarget = typeof body?.employeeId === 'string' ? body.employeeId : null;
      const targetOk = !reassignTarget || reassignTarget === req.employeeId
        ? true
        : await employeeInScope(viewer, permCheck.user!.permissions, reassignTarget);
      if (!storedOk || !targetOk) {
        return NextResponse.json({ error: 'Request not found' }, { status: 404 });
      }

      const updated = await updateRecord('requests', id, body);
      if (!updated) {
        return NextResponse.json({ error: 'Request not found' }, { status: 404 });
      }
      return NextResponse.json(updated);
    }

    // Approve/Reject — check 'approve' permission
    const permCheck = await verifyPermission(request, 'requests', 'approve');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    // ── DATA SCOPE (M0.4) ──
    // Approval is a mutation: a reviewer may only decide requests
    // whose STORED employee is inside their employee scope. Denied
    // out-of-scope with the same 404 as a missing request.
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      req.employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Update request status with reviewer info
    const updated = await updateRecord('requests', id, {
      status,
      reviewedBy: reviewedBy || null,
      reviewedAt: new Date().toISOString(),
    });

    // Apply absence deduction logic
    if (req.type === 'excuse') {
      const deductionDays = status === 'approved' ? 1 : 2;
      const notes = status === 'approved'
        ? `خصم غياب - تم القبول: ${deductionDays} يوم`
        : `خصم غياب - تم الرفض: ${deductionDays} أيام`;

      await createRecord('attendance', {
        employeeId: req.employeeId,
        date: req.date,
        status: 'absent',
        approvedRequestId: id,
        minutesLate: 0,
        notes,
        checkIn: null,
        checkOut: null,
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Update request error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return PATCH(request, params as any);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'delete' permission
    const permCheck = await verifyPermission(request, 'requests', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;

    // ── TARGET RESOURCE + DATA SCOPE (M0.4) ──
    // Resolve the stored request's employee BEFORE deleting;
    // out-of-scope → 404 identical to the missing path.
    const req = await getById('requests', id);
    if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      req.employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    await deleteRecord('requests', id);
    return NextResponse.json({ message: 'Request deleted' });
  } catch (error) {
    console.error('Delete request error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
