import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const rules = await db.deductionRule.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(rules);
  } catch (error) {
    console.error('Fetch rules error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, label, amount, unit } = body;

    if (!key || !label || amount == null) {
      return NextResponse.json({ error: 'Key, label, and amount are required' }, { status: 400 });
    }

    const rule = await db.deductionRule.create({
      data: {
        key,
        label,
        amount: Number(amount),
        unit: unit || 'EGP',
      },
    });

    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    console.error('Create rule error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
