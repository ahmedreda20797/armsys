import { NextRequest, NextResponse } from 'next/server';
import { getById, updateRecord, deleteRecord, deleteWhere } from '@/lib/db';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const updated = await updateRecord('employees', id, body);
    if (!updated) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }
    return NextResponse.json(updated);
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

    // Delete all related records first
    await deleteWhere('attendance', { employeeId: id });
    await deleteWhere('requests', { employeeId: id });
    await deleteWhere('qualityDeductions', { employeeId: id });
    await deleteWhere('biometrics', { employeeId: id });
    await deleteWhere('travelDeals', { employeeId: id });

    await deleteRecord('employees', id);

    return NextResponse.json({ message: 'Employee deleted successfully' });
  } catch (error) {
    console.error('Delete employee error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}