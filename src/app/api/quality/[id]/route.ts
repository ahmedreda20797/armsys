import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { date, type, description, deductionDays, deductionAmount, evidence, month } = body;

    const qualityDeduction = await db.qualityDeduction.update({
      where: { id },
      data: {
        ...(date !== undefined && { date }),
        ...(type !== undefined && { type }),
        ...(description !== undefined && { description }),
        ...(deductionDays !== undefined && { deductionDays: Number(deductionDays) }),
        ...(deductionAmount !== undefined && { deductionAmount: Number(deductionAmount) }),
        ...(evidence !== undefined && { evidence }),
        ...(month !== undefined && { month }),
      },
    });

    return NextResponse.json(qualityDeduction);
  } catch (error) {
    console.error('Update quality deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await db.qualityDeduction.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'Quality deduction deleted successfully' });
  } catch (error) {
    console.error('Delete quality deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
