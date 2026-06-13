import { NextRequest, NextResponse } from 'next/server';
import { getAll, findWhereContains, sortByDateField, withEmployeeFull, createRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const month = searchParams.get('month') || '';
    const status = searchParams.get('status') || '';

    let records = await getAll('attendance');

    if (search) {
      records = records.filter((r: any) =>
        (r.employeeId && r.employeeId.toLowerCase().includes(search.toLowerCase())) ||
        (r.date && r.date.includes(search)) ||
        (r.checkIn && r.checkIn.includes(search)) ||
        (r.checkOut && r.checkOut.includes(search))
      );
    }

    if (month) {
      records = records.filter((r: any) => r.date && r.date.includes(month));
    }

    if (status) {
      records = records.filter((r: any) => r.status === status);
    }

    records = sortByDateField(records, 'date', 'desc');
    const withEmp = await withEmployeeFull(records as any[]);
    return NextResponse.json(withEmp);
  } catch (error) {
    console.error('Fetch attendance error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify permission: need 'create' on 'attendance'
    const permCheck = await verifyPermission(request, 'attendance', 'create');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = await request.json();
    const { employeeId, date, checkIn, checkOut, status, minutesLate, notes } = body;

    if (!employeeId || !date) {
      return NextResponse.json({ error: 'employeeId and date are required' }, { status: 400 });
    }

    const record = await createRecord('attendance', {
      employeeId, date,
      checkIn: checkIn || null,
      checkOut: checkOut || null,
      status: status || 'present',
      minutesLate: minutesLate || 0,
      notes: notes || null,
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error('Create attendance error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
