import { NextRequest, NextResponse } from 'next/server';
import { getAll, createRecord, TTL } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import type { DeductionRule } from '@/types';

// ══════════════════════════════════════════════════════════════
//  GET /api/deduction-rules — Fetch all deduction rules
//
//  M0.2: gated by the existing 'rules' (قواعد الخصم) view
//  permission — the same key PageRouter checks and the same key the
//  POST gate uses for the 'create' action. Admin bypass unchanged.
// ══════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permCheck = await verifyPermission(request, 'rules', 'view');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
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
    // M0.1: deduction rule definitions drive payroll-adjacent formulas —
    // creation is gated by the 'rules' (قواعد الخصم) page's 'create' action.
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const permCheck = await verifyPermission(request, 'rules', 'create');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

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
