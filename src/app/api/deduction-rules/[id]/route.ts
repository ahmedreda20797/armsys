import { NextRequest, NextResponse } from 'next/server';
import { updateRecord, deleteRecord } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';

// ══════════════════════════════════════════════════════════════
//  PUT /api/deduction-rules/[id] — Update deduction rule
// ══════════════════════════════════════════════════════════════
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { key, label, amount, unit } = body;

    const updated = await updateRecord('deductionRules', id, {
      key,
      label,
      amount: typeof amount === 'number' ? amount : 0,
      unit: unit === 'EGP' ? 'EGP' : 'days',
    });

    if (!updated) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[PUT /api/deduction-rules] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ══════════════════════════════════════════════════════════════
//  DELETE /api/deduction-rules/[id] — Delete deduction rule
// ══════════════════════════════════════════════════════════════
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    await deleteRecord('deductionRules', id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/deduction-rules] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
