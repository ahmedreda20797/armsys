import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // YYYY-MM format

    let whereClause: Record<string, unknown> = {};

    if (month) {
      const [year, mon] = month.split('-');
      const datePattern = `/${mon.padStart(2, '0')}/${year}`;
      whereClause = { date: { contains: datePattern } };
    }

    const attendance = await db.attendance.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        employee: {
          select: { id: true, name: true, department: true, shiftStart: true },
        },
      },
    });

    return NextResponse.json(attendance);
  } catch (error) {
    console.error('Fetch attendance error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { employeeId, date, status, checkIn, checkOut, minutesLate, notes, approvedRequestId } = body;

    if (!employeeId || !date) {
      return NextResponse.json({ error: 'Employee ID and date are required' }, { status: 400 });
    }

    const attendance = await db.attendance.create({
      data: {
        employeeId,
        date,
        status: status || 'present',
        checkIn: checkIn || null,
        checkOut: checkOut || null,
        minutesLate: minutesLate || 0,
        notes: notes || null,
        approvedRequestId: approvedRequestId || null,
      },
    });

    return NextResponse.json(attendance, { status: 201 });
  } catch (error) {
    console.error('Create attendance error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
