import { NextRequest, NextResponse } from 'next/server';
import { getById, updateRecord, deleteRecord, deleteWhere } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'update' permission
    const permCheck = await verifyPermission(request, 'employees', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

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
    // Check 'delete' permission
    const permCheck = await verifyPermission(request, 'employees', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;

    // Delete all related records first
    await deleteWhere('attendance', { employeeId: id });
    await deleteWhere('requests', { employeeId: id });
    await deleteWhere('qualityDeductions', { employeeId: id });
    await deleteWhere('biometrics', { employeeId: id });
    await deleteWhere('travelDeals', { employeeId: id });
    await deleteWhere('followUps', { employeeId: id });
    await deleteWhere('hrDeductions', { employeeId: id });
    await deleteWhere('complaints', { employeeId: id });

    // Handle CAPA records — remove employee from relatedEmployeeIds (don't delete CAPA cases)
    const { getAll, updateRecord } = await import('@/lib/db');
    const allCapa = await getAll('capaCases');
    for (const capa of allCapa) {
      const relatedIds: string[] = Array.isArray(capa.relatedEmployeeIds) ? capa.relatedEmployeeIds : [];
      if (relatedIds.includes(id)) {
        const updatedIds = relatedIds.filter((eid: string) => eid !== id);
        await updateRecord('capaCases', capa.id, {
          relatedEmployeeIds: updatedIds,
          employeeId: capa.employeeId === id ? null : capa.employeeId,
          employeeName: capa.employeeId === id ? 'موظف محذوف' : capa.employeeName,
        });
      }
    }

    await deleteRecord('employees', id);

    return NextResponse.json({ message: 'Employee deleted successfully' });
  } catch (error) {
    console.error('Delete employee error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
