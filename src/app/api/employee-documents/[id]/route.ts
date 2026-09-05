// ══════════════════════════════════════════════════════════════
//  /api/employee-documents/[id] — delete a document record (M7 §17)
//
//  Same authorization doctrine as the collection route: employees
//  'update' permission + the TARGET EMPLOYEE's data scope (resolved
//  from the stored record, never from client input).
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { getById, deleteRecord } from '@/lib/db';
import { asScopeViewer, employeeInScope } from '@/lib/scope/server';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const permCheck = await verifyPermission(request, 'employees', 'update');
    if (!permCheck.allowed || !permCheck.user) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const existing = await getById<{ employeeId?: string | null }>('employeeDocuments', id);
    if (!existing) {
      return NextResponse.json({ error: 'المستند غير موجود' }, { status: 404 });
    }

    // Scope resolves from the STORED employee link (fail-closed 404).
    if (existing.employeeId) {
      const inScope = await employeeInScope(
        asScopeViewer(permCheck.user),
        permCheck.user.permissions,
        existing.employeeId,
      );
      if (!inScope) {
        return NextResponse.json({ error: 'المستند غير موجود' }, { status: 404 });
      }
    }

    await deleteRecord('employeeDocuments', id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[employee-documents DELETE]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
