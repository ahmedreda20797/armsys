import { NextResponse } from 'next/server';
import { getAll, sortByDateField, withEmployee } from '@/lib/db';

export async function GET() {
  try {
    let records = await getAll('biometrics');
    records = sortByDateField(records, 'createdAt', 'desc');
    const withEmp = await withEmployee(records as any[]);
    return NextResponse.json(withEmp);
  } catch (error) {
    console.error('Fetch biometrics error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}