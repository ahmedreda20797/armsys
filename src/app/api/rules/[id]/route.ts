import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { key, label, amount, unit } = body;

    const rule = await db.deductionRule.update({
      where: { id },
      data: {
        ...(key !== undefined && { key }),
        ...(label !== undefined && { label }),
        ...(amount !== undefined && { amount: Number(amount) }),
        ...(unit !== undefined && { unit }),
      },
    });

    return NextResponse.json(rule);
  } catch (error) {
    console.error('Update rule error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await db.deductionRule.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'Deduction rule deleted successfully' });
  } catch (error) {
    console.error('Delete rule error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
