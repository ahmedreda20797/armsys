import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const records = await db.biometric.findMany({
      orderBy: { date: 'desc' },
      include: { employee: { select: { name: true } } },
      take: 500,
    });

    const recordsWithNames = records.map((r) => ({
      ...r,
      employeeName: r.employee.name,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json(recordsWithNames);
  } catch (error) {
    console.error('Fetch biometrics error:', error);
    return NextResponse.json({ error: 'Failed to fetch biometrics' }, { status: 500 });
  }
}
