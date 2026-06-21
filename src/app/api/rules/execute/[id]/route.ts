import { NextRequest, NextResponse } from 'next/server';
import { getById } from '@/lib/db';
import { runRule } from '@/lib/rules-engine';
import { requireAuth } from '@/lib/verify-permission';
import type { AutomationRule } from '@/types';

// ══════════════════════════════════════════════════════════════
//  POST /api/rules/execute/[id] — Manually trigger a single rule
// ══════════════════════════════════════════════════════════════
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const rule = await getById<AutomationRule>('automationRules', id);

    if (!rule) {
      return NextResponse.json(
        { error: 'Automation rule not found' },
        { status: 404 }
      );
    }

    if (rule.status !== 'active') {
      return NextResponse.json(
        { error: `Rule is not active (current status: ${rule.status})` },
        { status: 400 }
      );
    }

    // Parse optional body for context
    let body: Record<string, any> = {};
    try {
      body = await request.json();
    } catch {
      // No body provided — that's fine
    }

    const context: Record<string, any> = {
      triggeredBy: 'manual_api',
      sourceModule: body.sourceModule || rule.module,
      sourceRecordId: body.sourceRecordId || undefined,
      employeeId: body.employeeId || undefined,
      employeeName: body.employeeName || undefined,
    };

    const log = await runRule(rule, context);

    return NextResponse.json({
      success: log.result === 'success',
      log,
    });
  } catch (error) {
    console.error('[POST /api/rules/execute/:id] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}