import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // YYYY-MM format

    let whereClause: Record<string, unknown> = {};

    if (month) {
      whereClause = { month };
    }

    const qualityDeductions = await db.qualityDeduction.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        employee: {
          select: { id: true, name: true, department: true },
        },
      },
    });

    return NextResponse.json(qualityDeductions);
  } catch (error) {
    console.error('Fetch quality deductions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { employeeId, date, type, description, deductionDays, deductionAmount, evidence, month } = body;

    if (!employeeId || !date || !type || !month) {
      return NextResponse.json({ error: 'Employee ID, date, type, and month are required' }, { status: 400 });
    }

    const qualityDeduction = await db.qualityDeduction.create({
      data: {
        employeeId,
        date,
        type,
        description: description || '',
        deductionDays: deductionDays || 0,
        deductionAmount: deductionAmount || 0,
        evidence: evidence || null,
        month,
      },
    });

    return NextResponse.json(qualityDeduction, { status: 201 });
  } catch (error) {
    console.error('Create quality deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
