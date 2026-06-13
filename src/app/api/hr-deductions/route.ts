import { NextRequest, NextResponse } from 'next/server';
import { getAll, createRecord, sortByDateField, withEmployee } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
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
    const body = await request.json();
    const { employeeId, type, amount, unit, reason, month } = body;

    if (!employeeId || !type || amount === undefined || !unit || !month) {
      return NextResponse.json(
        { error: 'employeeId, type, amount, unit, and month are required' },
        { status: 400 }
      );
    }

    const record = await createRecord('hrDeductions', {
      employeeId,
      type,
      amount: Number(amount),
      unit,
      reason: reason || '',
      month,
      status: 'pending',
      approvedBy: null,
      approvedAt: null,
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error('Create HR deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}