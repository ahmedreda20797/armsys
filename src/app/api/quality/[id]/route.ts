import { NextRequest, NextResponse } from 'next/server';
import { updateRecord, deleteRecord } from '@/lib/db';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { date, type, description, deductionDays, deductionAmount, evidence, month } = body;

    const qualityDeduction = await updateRecord('qualityDeductions', id, {
      ...(date !== undefined && { date }),
      ...(type !== undefined && { type }),
      ...(description !== undefined && { description }),
      ...(deductionDays !== undefined && { deductionDays: Number(deductionDays) }),
      ...(deductionAmount !== undefined && { deductionAmount: Number(deductionAmount) }),
      ...(evidence !== undefined && { evidence }),
      ...(month !== undefined && { month }),
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
    await deleteRecord('qualityDeductions', id);
    return NextResponse.json({ message: 'Quality deduction deleted successfully' });
  } catch (error) {
    console.error('Delete quality deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}