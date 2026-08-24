import { NextRequest, NextResponse } from 'next/server';
import { findWhereContains, deleteByIds } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { asScopeViewer, resolveEmployeeScopeFromDb } from '@/lib/scope/server';

export async function POST(request: NextRequest) {
  try {
    // Verify permission: need 'delete' on 'biometric'
    const permCheck = await verifyPermission(request, 'biometric', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = await request.json();
    const { month } = body;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'صيغة الشهر غير صحيحة. استخدم YYYY-MM' }, { status: 400 });
    }

    const [year, mon] = month.split('-');
    const datePattern = `/${mon.padStart(2, '0')}/${year}`;
    let records = await findWhereContains('biometrics', 'date', datePattern);

    // ── BULK WRITE-SCOPE (M0.4) ──
    // The clear is a bulk delete over MANY employees' records. A
    // scoped viewer may clear ONLY the records of employees inside
    // their employee scope — records of out-of-scope employees are
    // left untouched (intersection, never expansion). Unrestricted
    // viewers (admin/HR) keep the previous whole-month behavior.
    const scopeContext = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user!),
      undefined,
      permCheck.user!.permissions,
    );
    if (!scopeContext.isUnrestricted) {
      records = records.filter((r) => scopeContext.includes(r.employeeId));
    }

    const ids = records.map((r) => r.id);

    if (ids.length > 0) {
      await deleteByIds('biometrics', ids);
    }

    return NextResponse.json({ success: true, deleted: ids.length });
  } catch (error) {
    console.error('Clear month error:', error);
    return NextResponse.json({ error: 'فشل في مسح بيانات الشهر' }, { status: 500 });
  }
}
