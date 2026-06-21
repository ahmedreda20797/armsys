import { NextRequest, NextResponse } from 'next/server';
import { getAll, TTL } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import type { RuleExecutionLog } from '@/types';

// ══════════════════════════════════════════════════════════════
//  GET /api/rule-logs — Fetch rule execution logs with filtering
// ══════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    const ruleId = searchParams.get('ruleId');
    const result = searchParams.get('result');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let records = await getAll<RuleExecutionLog>('ruleExecutionLogs', TTL.DEFAULT);

    // Server-side filters
    if (ruleId) records = records.filter((r) => r.ruleId === ruleId);
    if (result) records = records.filter((r) => r.result === result);
    if (dateFrom) records = records.filter((r) => r.createdAt >= dateFrom);
    if (dateTo) records = records.filter((r) => r.createdAt <= dateTo + 'T23:59:59.999Z');

    // Sort by createdAt descending (newest first)
    records.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Apply pagination
    const paginated = records.slice(offset, offset + limit);

    return NextResponse.json({
      data: paginated,
      total: records.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[GET /api/rule-logs] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}