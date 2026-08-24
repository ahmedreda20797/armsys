import { NextRequest, NextResponse } from 'next/server';
import { getById, updateRecord, deleteRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope } from '@/lib/scope/server';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'update' permission
    const permCheck = await verifyPermission(request, 'travel', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    // ── TARGET RESOURCE + DATA SCOPE (M0.4) ──
    // The trip's STORED employeeId is the authorization target; a
    // body.employeeId reassignment additionally requires the NEW
    // target to be in scope. Out-of-scope → 404 identical to the
    // missing-trip path (anti-enumeration).
    const existing = await getById('travelDeals', id);
    if (!existing) {
      return NextResponse.json({ error: 'الرحلة غير موجودة' }, { status: 404 });
    }
    const viewer = asScopeViewer(permCheck.user!);
    const storedOk = await employeeInScope(viewer, permCheck.user!.permissions, existing.employeeId);
    const reassignTarget = body && typeof body === 'object' && typeof body.employeeId === 'string'
      ? body.employeeId
      : null;
    const targetOk = !reassignTarget || reassignTarget === existing.employeeId
      ? true
      : await employeeInScope(viewer, permCheck.user!.permissions, reassignTarget);
    if (!storedOk || !targetOk) {
      return NextResponse.json({ error: 'الرحلة غير موجودة' }, { status: 404 });
    }

    const trip = await updateRecord('travelDeals', id, body);

    return NextResponse.json(trip);
  } catch (error) {
    console.error('Update travel error:', error);
    return NextResponse.json({ error: 'فشل في تعديل الرحلة' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'delete' permission
    const permCheck = await verifyPermission(_request, 'travel', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;

    // ── TARGET RESOURCE + DATA SCOPE (M0.4) ──
    // Resolve the stored trip's employee BEFORE deleting;
    // out-of-scope → 404 identical to the missing path.
    const existing = await getById('travelDeals', id);
    if (!existing) {
      return NextResponse.json({ error: 'الرحلة غير موجودة' }, { status: 404 });
    }
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      existing.employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'الرحلة غير موجودة' }, { status: 404 });
    }

    await deleteRecord('travelDeals', id);
    return NextResponse.json({ message: 'تم حذف الرحلة بنجاح' });
  } catch (error) {
    console.error('Delete travel error:', error);
    return NextResponse.json({ error: 'فشل في حذف الرحلة' }, { status: 500 });
  }
}
