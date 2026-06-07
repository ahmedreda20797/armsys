import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, checkIn, checkOut, minutesLate, notes, approvedRequestId } = body;

    const attendance = await db.attendance.update({
      where: { id },
      data: {
        ...(status !== undefined && { status }),
        ...(checkIn !== undefined && { checkIn: checkIn || null }),
        ...(checkOut !== undefined && { checkOut: checkOut || null }),
        ...(minutesLate !== undefined && { minutesLate: Number(minutesLate) }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(approvedRequestId !== undefined && { approvedRequestId: approvedRequestId || null }),
      },
    });

    return NextResponse.json(attendance);
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
    const { id } = await params;

    await db.attendance.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'Attendance record deleted successfully' });
  } catch (error) {
    console.error('Delete attendance error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
