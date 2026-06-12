import { NextRequest, NextResponse } from 'next/server';
import { createRecord, findWhere, deleteWhere } from '@/lib/db';

// Waive (cancel) a specific deduction for an employee on a specific day
// Stores the waiver in 'waivedDeductions' collection
// The report generation will check this collection and skip waived deductions

export async function POST(request: NextRequest) {
  try {
    const { employeeId, date, month, deductionType, deductionAmount, reason } = await request.json();

    if (!employeeId || !date || !month) {
      return NextResponse.json({ error: 'employeeId, date, and month are required' }, { status: 400 });
    }

    // Check if already waived for same type
    const existing = await findWhere('waivedDeductions', { employeeId, date, month, deductionType: deductionType || 'all' });
    if (existing.length > 0) {
      return NextResponse.json({ error: 'هذا الخصم تم إلغاؤه بالفعل' }, { status: 400 });
    }

    // Also store specific type for the waiver
    const record = await createRecord('waivedDeductions', {
      employeeId,
      date,
      month,
      deductionType: deductionType || 'all',
      deductionAmount: deductionAmount || 0,
      reason: reason || '',
      waivedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, record });
  } catch (error) {
    console.error('Waive deduction error:', error);
    return NextResponse.json({ error: 'خطأ داخلي في الخادم' }, { status: 500 });
  }
}

// Delete a waived deduction (restore the original deduction)
export async function DELETE(request: NextRequest) {
  try {
    const { employeeId, date, month } = await request.json();

    if (!employeeId || !date || !month) {
      return NextResponse.json({ error: 'employeeId, date, and month are required' }, { status: 400 });
    }

    const count = await deleteWhere('waivedDeductions', { employeeId, date, month });

    return NextResponse.json({ success: true, deleted: count });
  } catch (error) {
    console.error('Restore deduction error:', error);
    return NextResponse.json({ error: 'خطأ داخلي في الخادم' }, { status: 500 });
  }
}
