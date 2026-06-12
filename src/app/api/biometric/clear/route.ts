import { NextResponse } from 'next/server';
import { findWhereContains, deleteByIds } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { month } = body;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'صيغة الشهر غير صحيحة. استخدم YYYY-MM' }, { status: 400 });
    }

    const [year, mon] = month.split('-');
    const datePattern = `/${mon.padStart(2, '0')}/${year}`;
    const records = await findWhereContains('biometrics', 'date', datePattern);

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