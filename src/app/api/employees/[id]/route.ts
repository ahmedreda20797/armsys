import { NextRequest, NextResponse } from 'next/server';
import { getById, getAll, updateRecord, deleteRecord, deleteWhere } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  asScopeViewer,
  employeeInScope,
} from '@/lib/scope/server';

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

    // ── TARGET RESOURCE + DATA SCOPE (M0.4 write-scope) ──
    // Resolve the employee BEFORE mutating. Permission answers
    // "may you update employees"; the scope answers "THIS employee?".
    // An out-of-scope id resolves as NOT FOUND — identical body to
    // the missing-employee path (anti-enumeration, same doctrine as
    // the M0.3 employee-360 guard).
    const existing = await getById('employees', id);
    if (!existing) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      id,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }

    // ── ORGANIZATIONAL ASSIGNMENT SEPARATION (M0.4) ──
    // orgNodeId feeds the scope engine itself: letting a generic
    // employee edit MOVE an employee between org nodes would let a
    // scoped editor redraw authorization boundaries. Organizational
    // reassignment is a SEPARATE privileged operation with its own
    // route (/api/organization/employees/move), page permission
    // ('organization' — admin-only by stock preset), audit trail and
    // manager notifications. A no-op assignment (same value) is
    // ignored; any CHANGE via this route is refused.
    if (body && typeof body === 'object' && 'orgNodeId' in body) {
      if ((body.orgNodeId ?? null) !== (existing.orgNodeId ?? null)) {
        return NextResponse.json(
          { error: 'تغيير الإسناد التنظيمي يتم من صفحة الهيكل التنظيمي فقط' },
          { status: 403 },
        );
      }
      delete body.orgNodeId;
    }

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

    // ── TARGET RESOURCE + DATA SCOPE (M0.4 write-scope) ──
    // Deletion of an employee cascades into every linked table —
    // the scope check MUST run before any of it. Out-of-scope id →
    // 404 identical to the missing-employee path.
    const existing = await getById('employees', id);
    if (!existing) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      id,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }

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
