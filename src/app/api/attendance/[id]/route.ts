import { NextRequest, NextResponse } from 'next/server';
import { updateRecord, deleteRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { isValidLegacyDate } from '@/lib/attendance';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'update' permission
    const permCheck = await verifyPermission(request, 'attendance', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    // Date-boundary validation (Milestone 2 §22): a date change must
    // be a well-formed DD/MM/YYYY calendar date.
    if (body.date !== undefined && !isValidLegacyDate(body.date)) {
      return NextResponse.json({ error: 'صيغة التاريخ غير صحيحة (DD/MM/YYYY مطلوبة)' }, { status: 400 });
    }

    const updated = await updateRecord('attendance', id, body);
    if (!updated) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Update attendance error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'delete' permission
    const permCheck = await verifyPermission(request, 'attendance', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    await deleteRecord('attendance', id);
    return NextResponse.json({ message: 'Attendance record deleted' });
  } catch (error) {
    console.error('Delete attendance error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
