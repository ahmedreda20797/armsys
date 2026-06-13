import { NextRequest, NextResponse } from 'next/server';
import { updateRecord, deleteRecord, getById } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, approvedBy } = body;

    // If approving or rejecting, check 'approve' permission
    if (status === 'approved' || status === 'rejected') {
      const permCheck = await verifyPermission(request, 'hrDeductions', 'approve');
      if (!permCheck.allowed) {
        return NextResponse.json({ error: permCheck.error }, { status: 403 });
      }

      const existing = await getById('hrDeductions', id);
      if (!existing) {
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

    const existing = await getById('hrDeductions', id);
    if (!existing) {
      return NextResponse.json({ error: 'HR deduction not found' }, { status: 404 });
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
    // Allow deletion of any deduction (pending, approved, or rejected)
    await deleteRecord('hrDeductions', id);
    return NextResponse.json({ message: 'HR deduction deleted successfully' });
  } catch (error) {
    console.error('Delete HR deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
