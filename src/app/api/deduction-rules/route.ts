import { NextRequest, NextResponse } from 'next/server';
import { getAll, createRecord, TTL } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import type { DeductionRule } from '@/types';

// ══════════════════════════════════════════════════════════════
//  GET /api/deduction-rules — Fetch all deduction rules
// ══════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const records = await getAll<DeductionRule>('deductionRules', TTL.LONG);

    // Sort by key alphabetically
    records.sort((a, b) => a.key.localeCompare(b.key));

    return NextResponse.json({
      data: records,
      total: records.length,
      limit: 100,
      offset: 0,
    });
  } catch (error) {
    console.error('[GET /api/deduction-rules] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ══════════════════════════════════════════════════════════════
//  POST /api/deduction-rules — Create new deduction rule
// ══════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, label, amount, unit } = body;

    if (!key || !label) {
      return NextResponse.json(
        { error: 'key and label are required' },
        { status: 400 }
      );
    }

    const rule = await createRecord<DeductionRule>('deductionRules', {
      key,
      label,
      amount: typeof amount === 'number' ? amount : 0,
      unit: unit === 'EGP' ? 'EGP' : 'days',
    });

    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    console.error('[POST /api/deduction-rules] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
