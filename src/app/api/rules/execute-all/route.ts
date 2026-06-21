import { NextRequest, NextResponse } from 'next/server';
import { runAllActiveRules } from '@/lib/rules-engine';
import { requireAuth } from '@/lib/verify-permission';

// ══════════════════════════════════════════════════════════════
//  POST /api/rules/execute-all — Run all active rules (admin only)
// ══════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (auth.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Parse optional body for module filter
    let body: { module?: string } = {};
    try {
      body = await request.json();
    } catch {
      // No body provided — that's fine
    }

    const result = await runAllActiveRules(body.module);

    return NextResponse.json({
      success: result.failed === 0,
      ...result,
    });
  } catch (error) {
    console.error('[POST /api/rules/execute-all] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}