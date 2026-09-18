// ══════════════════════════════════════════════════════════════
//  /api/rules/stats — REAL automation metrics (§15)
//
//  GET  → counts over the FULL rule set + success rate / last
//         execution ONLY from actual execution data (null → the UI
//         shows "—" / "لم يتم التنفيذ بعد"; never a fabricated 94%).
//  PUT  → the automation master switch (controlPanel-free: gated by
//         the same rulesEngine edit permission the automation page
//         already uses; System Owner bypass lives in verifyPermission).
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  computeAutomationStats, isAutomationEnabled, setAutomationEnabled,
} from '@/lib/automation/stats';
import type { AutomationRule } from '@/types';

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyPermission(request, 'rulesEngine', 'view');
    if (!auth.allowed) {
      return NextResponse.json({ error: auth.error }, { status: 403 });
    }
    const rules = await getAll<AutomationRule>('automationRules');
    const stats = computeAutomationStats(rules);
    const enabled = await isAutomationEnabled();
    return NextResponse.json({ stats, enabled });
  } catch (error) {
    console.error('[GET /api/rules/stats] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await verifyPermission(request, 'rulesEngine', 'edit');
    if (!auth.allowed) {
      return NextResponse.json({ error: auth.error }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'قيمة التفعيل مطلوبة' }, { status: 400 });
    }
    await setAutomationEnabled(body.enabled);
    return NextResponse.json({ success: true, enabled: body.enabled });
  } catch (error) {
    console.error('[PUT /api/rules/stats] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
