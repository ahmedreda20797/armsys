import { NextRequest, NextResponse } from 'next/server';
import { updateRecord, deleteRecord, getById } from '@/lib/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, approvedBy } = body;

    // If approving or rejecting, set approval fields
    if (status === 'approved' || status === 'rejected') {
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

    // Otherwise, just update the provided fields
    const updated = await updateRecord('hrDeductions', id, body);
    if (!updated) {
      return NextResponse.json({ error: 'HR deduction not found' }, { status: 404 });
    }
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
    const { id } = await params;
    const existing = await getById('hrDeductions', id);
    if (!existing) {
      return NextResponse.json({ error: 'HR deduction not found' }, { status: 404 });
    }
    if (existing.status !== 'pending') {
      return NextResponse.json(
        { error: 'يمكن حذف الخصومات المعلقة فقط' },
        { status: 400 }
      );
    }
    await deleteRecord('hrDeductions', id);
    return NextResponse.json({ message: 'HR deduction deleted successfully' });
  } catch (error) {
    console.error('Delete HR deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}