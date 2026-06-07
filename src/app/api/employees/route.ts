import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const employees = await db.employee.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            attendance: true,
            requests: true,
            qualityDeductions: true,
          },
        },
      },
    });
    return NextResponse.json(employees);
  } catch (error) {
    console.error('Fetch employees error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, name, department, position, shiftStart, shiftEnd, hireDate, mobile, createdById } = body;

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const employee = await db.employee.create({
      data: {
        code: code || null,
        name,
        department: department || null,
        position: position || null,
        shiftStart: shiftStart || null,
        shiftEnd: shiftEnd || null,
        hireDate: hireDate || null,
        mobile: mobile || null,
        createdById: createdById || null,
      },
    });

    return NextResponse.json(employee, { status: 201 });
  } catch (error) {
    console.error('Create employee error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
