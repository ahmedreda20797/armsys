import { NextRequest, NextResponse } from 'next/server';
import { getById, updateRecord, deleteRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { isValidLegacyDate } from '@/lib/attendance';
import { asScopeViewer, employeeInScope } from '@/lib/scope/server';

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

    // ── TARGET RESOURCE + DATA SCOPE (M0.4) ──
    // The record's STORED employeeId is the authorization target; if
    // the patch reassigns the record to another employee, that new
    // target must ALSO be in scope (a scoped editor cannot move
    // records onto out-of-scope employees). Out-of-scope → 404 with
    // the same body as a missing record (anti-enumeration).
    const existing = await getById('attendance', id);
    if (!existing) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }
    const viewer = asScopeViewer(permCheck.user!);
    const reassignTarget = body && typeof body === 'object' && typeof body.employeeId === 'string'
      ? body.employeeId
      : null;
    const storedOk = await employeeInScope(viewer, permCheck.user!.permissions, existing.employeeId);
    const targetOk = reassignTarget === null || reassignTarget === existing.employeeId
      ? true
      : await employeeInScope(viewer, permCheck.user!.permissions, reassignTarget);
    if (!storedOk || !targetOk) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

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

    // ── TARGET RESOURCE + DATA SCOPE (M0.4) ──
    // Resolve the record's employee BEFORE deleting. Out-of-scope →
    // 404 identical to the missing-record path.
    const existing = await getById('attendance', id);
    if (!existing) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      existing.employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    await deleteRecord('attendance', id);
    return NextResponse.json({ message: 'Attendance record deleted' });
  } catch (error) {
    console.error('Delete attendance error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
