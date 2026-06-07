import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { month } = body;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'Invalid month format. Use YYYY-MM' }, { status: 400 });
    }

    // Find all biometric records for this month
    const records = await db.biometric.findMany({
      where: {
        date: { contains: `/${month.split('-')[1]}/${month.split('-')[0]}` },
      },
      select: { id: true },
    });

    const ids = records.map((r) => r.id);

    if (ids.length > 0) {
      await db.biometric.deleteMany({
        where: { id: { in: ids } },
      });
    }

    return NextResponse.json({ success: true, deleted: ids.length });
  } catch (error) {
    console.error('Clear month error:', error);
    return NextResponse.json({ error: 'Failed to clear month data' }, { status: 500 });
  }
}
