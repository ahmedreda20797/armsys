// ══════════════════════════════════════════════════════════════
//  /api/month-snapshots
//
//  GET — list month snapshots (most recent first).
//
//  Permission: requireAuth. Returns summary fields only — the
//  detailed per-employee scores live on the detail endpoint.
//  This keeps the list payload small even with many months.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, sortByField, TTL } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import { unauthorizedError, internalError, logServerFailure } from '@/lib/api-error';
import { MONTH_SNAPSHOTS_TABLE } from '@/lib/month-lock';
import type { MonthSnapshot } from '@/types/quality-kpi';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // 'open' | 'closed' | undefined

    let snapshots = await getAll<MonthSnapshot>(MONTH_SNAPSHOTS_TABLE, TTL.STATIC);
    if (status) snapshots = snapshots.filter((s) => s.status === status);

    // Most recent month first.
    const sorted = sortByField(snapshots, 'monthKey', 'desc');

    // Summary view — strip the large employeeScores map for the list.
    const summary = sorted.map((s) => ({
      id: s.id,
      monthKey: s.monthKey,
      status: s.status,
      closedAt: s.closedAt,
      closedBy: s.closedBy,
      closedByName: s.closedByName,
      reopenCount: s.reopenCount,
      generatedAt: s.generatedAt,
      employeeCount: Object.keys(s.employeeScores || {}).length,
      departmentCount: Object.keys(s.departmentScores || {}).length,
      approvalStats: s.approvalStats,
    }));

    return Response.json(summary);
  } catch (error) {
    logServerFailure('month-snapshots', 'GET', error);
    return internalError();
  }
}
