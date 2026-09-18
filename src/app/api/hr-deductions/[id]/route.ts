import { NextRequest, NextResponse } from 'next/server';
import { updateRecord, deleteRecord, getById } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope } from '@/lib/scope/server';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, approvedBy } = body;

    // ── TARGET RESOURCE (M0.4) ──
    // The stored deduction's employeeId is the authoritative
    // authorization target for BOTH approval and plain updates;
    // out-of-scope → 404 identical to the missing-record path.
    const existing = await getById('hrDeductions', id);
    if (!existing) {
      return NextResponse.json({ error: 'HR deduction not found' }, { status: 404 });
    }

    // If approving or rejecting, check 'approve' permission
    if (status === 'approved' || status === 'rejected') {
      const permCheck = await verifyPermission(request, 'hrDeductions', 'approve');
      if (!permCheck.allowed) {
        return NextResponse.json({ error: permCheck.error }, { status: 403 });
      }

      // ── DATA SCOPE (M0.4) ── approval is a mutation: only
      // deductions whose stored employee is in scope may be decided.
      const inScope = await employeeInScope(
        asScopeViewer(permCheck.user!),
        permCheck.user!.permissions,
        existing.employeeId,
      );
      if (!inScope) {
        return NextResponse.json({ error: 'HR deduction not found' }, { status: 404 });
      }

      const updated = await updateRecord('hrDeductions', id, {
        status,
        approvedBy: approvedBy || null,
        approvedAt: new Date().toISOString(),
      });

      return NextResponse.json(updated);
    }

    // Otherwise, check 'update' permission
    const permCheck = await verifyPermission(request, 'hrDeductions', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    // ── DATA SCOPE (M0.4) ── stored employee governs; a body
    // reassignment target must also be in scope.
    const viewer = asScopeViewer(permCheck.user!);
    const storedOk = await employeeInScope(viewer, permCheck.user!.permissions, existing.employeeId);
    const reassignTarget = typeof body?.employeeId === 'string' ? body.employeeId : null;
    const targetOk = !reassignTarget || reassignTarget === existing.employeeId
      ? true
      : await employeeInScope(viewer, permCheck.user!.permissions, reassignTarget);
    if (!storedOk || !targetOk) {
      return NextResponse.json({ error: 'HR deduction not found' }, { status: 404 });
    }

    // §ARCHIVE — archive/restore is its own audited operation: the
    // archived record stops counting toward ACTIVE totals (canonical
    // isEffectiveHrDeduction gate) while remaining fully auditable.
    if (body.archived !== undefined) {
      const { resolveActor } = await import('@/lib/auth/actor-resolver');
      const archiveActor = await resolveActor(permCheck.user?.id);
      const archiveUpdates: Record<string, unknown> = body.archived === true
        ? {
            archived: true,
            archivedAt: new Date().toISOString(),
            archivedBy: archiveActor.id,
            archivedByName: archiveActor.name,
          }
        : { archived: false, archivedAt: null, archivedBy: null, archivedByName: null };
      const updatedArchived = await updateRecord('hrDeductions', id, archiveUpdates);
      return NextResponse.json(updatedArchived);
    }

    const updated = await updateRecord('hrDeductions', id, body);
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Update HR deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'delete' permission
    const permCheck = await verifyPermission(request, 'hrDeductions', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const existing = await getById('hrDeductions', id);
    if (!existing) {
      return NextResponse.json({ error: 'HR deduction not found' }, { status: 404 });
    }

    // ── DATA SCOPE (M0.4) ── resolve the stored employee BEFORE
    // deleting; out-of-scope → 404 identical to the missing path.
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      existing.employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'HR deduction not found' }, { status: 404 });
    }

    // Allow deletion of any deduction (pending, approved, or rejected)
    await deleteRecord('hrDeductions', id);
    return NextResponse.json({ message: 'HR deduction deleted successfully' });
  } catch (error) {
    console.error('Delete HR deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
