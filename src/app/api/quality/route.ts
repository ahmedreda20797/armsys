import { NextRequest, NextResponse } from 'next/server';
import { getAll, findWhere, createRecord, sortByDateField, withEmployeeFull } from '@/lib/db';
import { verifyPermission, requireAuth } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope, authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // YYYY-MM format

    let records = month
      ? await findWhere('qualityDeductions', { month })
      : await getAll('qualityDeductions');

    // ── READ SCOPE (M0.5) ──
    // Quality deductions are employee-linked; scope runs at the
    // retrieval boundary (after the month fetch, before sort and
    // enrichment). Scoring/points/deduction business values are
    // untouched — this changes WHICH rows are visible, never their
    // computation.
    const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
    records = filterRowsByEmployeeScope(records as Array<{ employeeId?: string | null }>, scopeCtx);

    records = sortByDateField(records, 'createdAt', 'desc');
    const recordsWithEmployee = await withEmployeeFull(records as any[]);

    return NextResponse.json(recordsWithEmployee);
  } catch (error) {
    console.error('Fetch quality deductions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify permission: need 'create' on 'quality'
    const permCheck = await verifyPermission(request, 'quality', 'create');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = await request.json();
    const { employeeId, date, type, description, deductionDays, deductionAmount, evidence, month, relatedCapaId } = body;

    if (!employeeId || !date || !type || !month) {
      return NextResponse.json({ error: 'Employee ID, date, type, and month are required' }, { status: 400 });
    }

    // ── TARGET-EMPLOYEE SCOPE (M0.4) ──
    // Quality deductions are employee-linked records; the deduction
    // BUSINESS RULES are untouched — this is authorization only.
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

    const qualityDeduction = await createRecord('qualityDeductions', {
      employeeId,
      date,
      type,
      description: description || '',
      deductionDays: deductionDays || 0,
      deductionAmount: deductionAmount || 0,
      evidence: evidence || null,
      month,
      relatedCapaId: relatedCapaId || null,
    });

    return NextResponse.json(qualityDeduction, { status: 201 });
  } catch (error) {
    console.error('Create quality deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
