import { NextRequest, NextResponse } from 'next/server';
import { updateRecord, deleteRecord, getById, createRecord } from '@/lib/db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, reviewedBy } = body;

    if (status !== 'approved' && status !== 'rejected') {
      const updated = await updateRecord('requests', id, body);
      if (!updated) {
        return NextResponse.json({ error: 'Request not found' }, { status: 404 });
      }
      return NextResponse.json(updated);
    }

    // Get the full request to check type
    const req = await getById('requests', id);
    if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

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
    const { id } = await params;
    await deleteRecord('requests', id);
    return NextResponse.json({ message: 'Request deleted' });
  } catch (error) {
    console.error('Delete request error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}