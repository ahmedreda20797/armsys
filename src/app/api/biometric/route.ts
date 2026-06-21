import { NextRequest, NextResponse } from 'next/server';
import { getAll, sortByDateField, withEmployee } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let records = await getAll('biometrics');
    records = sortByDateField(records, 'createdAt', 'desc');
    const withEmp = await withEmployee(records as any[]);
    return NextResponse.json(withEmp);
  } catch (error) {
    console.error('Fetch biometrics error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}