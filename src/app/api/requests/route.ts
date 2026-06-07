import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const requests = await db.request.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        employee: {
          select: { id: true, name: true, department: true },
        },
      },
    });
    const mapped = requests.map((r) => ({
      ...r,
      employeeName: r.employee?.name || '',
      employeeDepartment: r.employee?.department || null,
    }));
    return NextResponse.json(mapped);
  } catch (error) {
    console.error('Fetch requests error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { employeeId, type, date, reason, status } = body;

    if (!employeeId || !type || !date) {
      return NextResponse.json({ error: 'Employee ID, type, and date are required' }, { status: 400 });
    }

    const req = await db.request.create({
      data: {
        employeeId,
        type,
        date,
        reason: reason || '',
        status: status || 'pending',
      },
    });

    return NextResponse.json(req, { status: 201 });
  } catch (error) {
    console.error('Create request error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
