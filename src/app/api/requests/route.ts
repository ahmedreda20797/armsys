import { NextRequest, NextResponse } from 'next/server';
import { getAll, createRecord, sortByDateField, withEmployee } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || '';
    const type = searchParams.get('type') || '';

    let records = await getAll('requests');

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
