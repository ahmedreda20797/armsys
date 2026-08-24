import { NextRequest, NextResponse } from 'next/server';
import { getAll, createRecord, sortByDateField, withEmployee } from '@/lib/db';
import { verifyPermission, requireAuth } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope, authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';
    const type = searchParams.get('type') || '';

    let records = await getAll('requests');

    // ── READ SCOPE (M0.5) ──
    // Requests are a separate business domain but every row is
    // employee-linked through its STORED employeeId — the persisted
    // record is the authorization relationship, and the scope runs
    // before the status/type filters (they can only narrow).
    const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
    records = filterRowsByEmployeeScope(records as Array<{ employeeId?: string | null }>, scopeCtx);

    if (status) records = records.filter((r: any) => r.status === status);
    if (type) records = records.filter((r: any) => r.type === type);

    records = sortByDateField(records, 'createdAt', 'desc');
    const withEmp = await withEmployee(records as any[]);
    return NextResponse.json(withEmp);
  } catch (error) {
    console.error('Fetch requests error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify permission: need 'create' on 'requests'
    const permCheck = await verifyPermission(request, 'requests', 'create');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = await request.json();
    const { employeeId, type, date, reason, status } = body;

    if (!employeeId || !type || !date) {
      return NextResponse.json({ error: 'employeeId, type, and date are required' }, { status: 400 });
    }

    // ── TARGET-EMPLOYEE SCOPE (M0.4) ──
    // Requests live in the Requests domain but are employee-linked:
    // the TARGET employee (body.employeeId) must be inside the
    // caller's employee scope. Checked BEFORE existence validation
    // and BEFORE the create; the scope comes from the authenticated
    // identity, never from the body.
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'صلاحية غير كافية' }, { status: 403 });
    }

    // Validate employee exists and is active
    const { validateEmployeeId } = await import('@/lib/validate-employee');
    const empValidation = await validateEmployeeId(employeeId, true);
    if (!empValidation.valid) {
      return NextResponse.json({ error: empValidation.error }, { status: 400 });
    }

    const record = await createRecord('requests', {
      employeeId, type, date,
      reason: reason || null,
      status: status || 'pending',
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error('Create request error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
