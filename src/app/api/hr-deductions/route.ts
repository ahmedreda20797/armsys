import { NextRequest, NextResponse } from 'next/server';
import { getAll, createRecord, sortByDateField, withEmployee } from '@/lib/db';
import { verifyPermission, requireAuth } from '@/lib/verify-permission';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';

    let records = await getAll('hrDeductions');

    if (status) {
      records = records.filter((r: any) => r.status === status);
    }

    records = sortByDateField(records, 'createdAt', 'desc');
    const withEmp = await withEmployee(records as any[]);
    return NextResponse.json(withEmp);
  } catch (error) {
    console.error('Fetch HR deductions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify permission: need 'create' on 'hrDeductions'
    const permCheck = await verifyPermission(request, 'hrDeductions', 'create');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = await request.json();
    const { employeeId, type, amount, unit, reason, month, relatedCapaId } = body;

    if (!employeeId || !type || amount === undefined || !unit || !month) {
      return NextResponse.json(
        { error: 'employeeId, type, amount, unit, and month are required' },
        { status: 400 }
      );
    }

    // Validate employee exists and is active
    const { validateEmployeeId } = await import('@/lib/validate-employee');
    const empValidation = await validateEmployeeId(employeeId, true);
    if (!empValidation.valid) {
      return NextResponse.json({ error: empValidation.error }, { status: 400 });
    }

    const record = await createRecord('hrDeductions', {
      employeeId,
      type,
      amount: Number(amount),
      unit,
      reason: reason || '',
      month,
      deductionDate: body.deductionDate || null,
      status: 'pending',
      approvedBy: null,
      approvedAt: null,
      relatedCapaId: relatedCapaId || null,
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error('Create HR deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
