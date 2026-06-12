import { NextRequest, NextResponse } from 'next/server';
import { getAll, createRecord, updateRecord, findFirst, sortByField } from '@/lib/db';

// ══════════════════════════════════════════════════════════════
// Canonical rule definitions — amounts MUST match these values
// Late deduction tiers:
//   ≤15 min → no deduction (grace period)
//   16-30 min → quarter day (0.25)
//   31-60 min → half day (0.5)
//   61+ min → full day (1.0)
// Absent → full day (1.0)
// Single fingerprint (check-in or check-out only) → half day (0.5)
// ══════════════════════════════════════════════════════════════
const CANONICAL_RULES: Record<string, { label: string; amount: number; unit: string }> = {
  late15:              { label: 'تأخير من 16 إلى 30 دقيقة', amount: 0.25, unit: 'days' },
  late30:              { label: 'تأخير من 31 إلى 60 دقيقة', amount: 0.5,  unit: 'days' },
  late60:              { label: 'تأخير 61 دقيقة فأكثر',     amount: 1,    unit: 'days' },
  absence:             { label: 'غياب',                       amount: 1,    unit: 'days' },
  singleFingerprint:   { label: 'بصمة واحدة فقط (دخول أو خروج بدون الأخرى)', amount: 0.5, unit: 'days' },
};

/** Auto-sync rule amounts to canonical values. Creates missing rules, updates wrong amounts. */
async function syncRulesToCanonical(): Promise<number> {
  let synced = 0;
  for (const [key, canonical] of Object.entries(CANONICAL_RULES)) {
    const existing = await findFirst('deductionRules', { key });
    if (!existing) {
      await createRecord('deductionRules', { key, ...canonical });
      synced++;
    } else if (existing.amount !== canonical.amount || existing.label !== canonical.label) {
      await updateRecord('deductionRules', existing.id, {
        amount: canonical.amount,
        label: canonical.label,
        unit: canonical.unit,
      });
      synced++;
    }
  }
  return synced;
}

export async function GET() {
  try {
    // Always sync rules to canonical values before returning
    await syncRulesToCanonical();

    let rules = await getAll('deductionRules');
    rules = sortByField(rules, 'amount', 'desc');
    return NextResponse.json(rules);
  } catch (error) {
    console.error('Fetch rules error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, label, amount, unit, description } = body;

    if (!key || !label || amount === undefined) {
      return NextResponse.json({ error: 'key, label, and amount are required' }, { status: 400 });
    }

    const rule = await createRecord('deductionRules', {
      key, label, amount, unit: unit || 'EGP', description: description || null,
    });

    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    console.error('Create rule error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
