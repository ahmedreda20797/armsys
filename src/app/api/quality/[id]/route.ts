import { NextRequest, NextResponse } from 'next/server';
import { updateRecord, deleteRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'update' permission
    const permCheck = await verifyPermission(request, 'quality', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { date, type, description, deductionDays, deductionAmount, evidence, month, relatedCapaId } = body;

    const qualityDeduction = await updateRecord('qualityDeductions', id, {
      ...(date !== undefined && { date }),
      ...(type !== undefined && { type }),
      ...(description !== undefined && { description }),
      ...(deductionDays !== undefined && { deductionDays: Number(deductionDays) }),
      ...(deductionAmount !== undefined && { deductionAmount: Number(deductionAmount) }),
      ...(evidence !== undefined && { evidence }),
      ...(month !== undefined && { month }),
      ...(relatedCapaId !== undefined && { relatedCapaId }),
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
    // Check 'delete' permission
    const permCheck = await verifyPermission(request, 'quality', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    await deleteRecord('qualityDeductions', id);
    return NextResponse.json({ message: 'Quality deduction deleted successfully' });
  } catch (error) {
    console.error('Delete quality deduction error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
