import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { code, name, department, position, shiftStart, shiftEnd, hireDate, mobile } = body;

    const employee = await db.employee.update({
      where: { id },
      data: {
        ...(code !== undefined && { code: code || null }),
        ...(name !== undefined && { name }),
        ...(department !== undefined && { department: department || null }),
        ...(position !== undefined && { position: position || null }),
        ...(shiftStart !== undefined && { shiftStart: shiftStart || null }),
        ...(shiftEnd !== undefined && { shiftEnd: shiftEnd || null }),
        ...(hireDate !== undefined && { hireDate: hireDate || null }),
        ...(mobile !== undefined && { mobile: mobile || null }),
      },
    });

    return NextResponse.json(employee);
  } catch (error) {
    console.error('Update employee error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Delete related records first
    await db.attendance.deleteMany({ where: { employeeId: id } });
    await db.request.deleteMany({ where: { employeeId: id } });
    await db.qualityDeduction.deleteMany({ where: { employeeId: id } });
    await db.biometric.deleteMany({ where: { employeeId: id } });

    await db.employee.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'Employee deleted successfully' });
  } catch (error) {
    console.error('Delete employee error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
