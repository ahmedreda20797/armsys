import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/verify-permission';
import { ensureDeductionRulesSeeded } from '@/lib/attendance';

// ══════════════════════════════════════════════════════════════
//  POST /api/deduction-rules/seed
//  One-time idempotent seed of the canonical deduction rules.
//
//  Replaces the legacy write-on-read syncRulesToCanonical() that ran
//  inside every report generation (Milestone 2 §27). Creates only
//  MISSING canonical rules; existing (admin-customized) rows are
//  never overwritten. Deployments that ran the legacy reports already
//  hold the canonical rows, so this is a no-op for them.
// ══════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { created, existing } = await ensureDeductionRulesSeeded();

    return NextResponse.json({
      success: true,
      created,
      existing,
      message: created > 0
        ? `تم إنشاء ${created} قاعدة خصم أساسية`
        : 'جميع القواعد الأساسية موجودة بالفعل',
    });
  } catch (error) {
    console.error('Seed deduction rules error:', error);
    return NextResponse.json({ error: 'فشل في تهيئة قواعد الخصم' }, { status: 500 });
  }
}
