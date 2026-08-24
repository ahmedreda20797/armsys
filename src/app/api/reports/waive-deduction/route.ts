import { NextRequest, NextResponse } from 'next/server';
import { createRecord, findWhere, deleteWhere } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope } from '@/lib/scope/server';

// Waive (cancel) a specific deduction for an employee on a specific day
// Stores the waiver in 'waivedDeductions' collection
// The report generation will check this collection and skip waived deductions

export async function POST(request: NextRequest) {
  try {
    // Verify permission: reports page - edit access required for waive
    const permCheck = await verifyPermission(request, 'reports', 'edit');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { employeeId, date, month, deductionType, deductionAmount, reason } = await request.json();

    if (!employeeId || !date || !month) {
      return NextResponse.json({ error: 'employeeId, date, and month are required' }, { status: 400 });
    }

    // ── TARGET-EMPLOYEE SCOPE (M0.4) ──
    // A waiver changes a deduction outcome for a named employee —
    // an employee-linked mutation. The target employee (body) must
    // be inside the caller's employee scope BEFORE anything is
    // written; the deduction business rules are unchanged.
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'صلاحية غير كافية' }, { status: 403 });
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
    // Verify permission: reports page - edit access required for restore
    const permCheck = await verifyPermission(request, 'reports', 'edit');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { employeeId, date, month } = await request.json();

    if (!employeeId || !date || !month) {
      return NextResponse.json({ error: 'employeeId, date, and month are required' }, { status: 400 });
    }

    // ── TARGET-EMPLOYEE SCOPE (M0.4) ──
    // Restoring a waiver mutates that employee's deduction outcome —
    // same employee-scope rule as creating one, checked BEFORE the
    // deleteWhere touches any record.
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'صلاحية غير كافية' }, { status: 403 });
    }

    const count = await deleteWhere('waivedDeductions', { employeeId, date, month });

    return NextResponse.json({ success: true, deleted: count });
  } catch (error) {
    console.error('Restore deduction error:', error);
    return NextResponse.json({ error: 'خطأ داخلي في الخادم' }, { status: 500 });
  }
}
