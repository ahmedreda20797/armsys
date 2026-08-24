import { NextRequest, NextResponse } from 'next/server';
import { getAll, sortByDateField, withEmployee } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import { authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let records = await getAll('biometrics');

    // ── READ SCOPE (M0.5) ──
    // Biometric rows describe EMPLOYEES (data records), never the
    // authenticated operator: visibility follows the row's stored
    // employeeId against the caller's employee scope. Enforced
    // server-side before enrichment — the browser never receives
    // out-of-scope biometric data.
    const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
    records = filterRowsByEmployeeScope(records as Array<{ employeeId?: string | null }>, scopeCtx);

    records = sortByDateField(records, 'createdAt', 'desc');
    const withEmp = await withEmployee(records as any[]);
    return NextResponse.json(withEmp);
  } catch (error) {
    console.error('Fetch biometrics error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}