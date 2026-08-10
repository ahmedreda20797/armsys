// ══════════════════════════════════════════════════════════════
//  /api/month-snapshots
//
//  GET — list available monthly snapshots (most recent first).
//
//  Milestone 5 (spec §6):
//    • Authentication required (requireAuth).
//    • No manager permission required for read.
//    • Returns REAL Firebase data only — no fake/demo months.
//    • Supports optional ?status=open|closed filtering.
//    • Returns a compact summary (employeeScores stripped) so the
//      list payload stays small; full detail lives on the [month]
//      detail endpoint.
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

    // Real Firebase data only — no generated/demo months.
    let snapshots = await getAll<MonthSnapshot>(MONTH_SNAPSHOTS_TABLE, TTL.STATIC);
    if (status === 'open' || status === 'closed') {
      snapshots = snapshots.filter((s) => s.status === status);
    }

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
      reopenReason: s.reopenReason,
      generatedAt: s.generatedAt,
      employeeCount: Object.keys(s.employeeScores || {}).length,
      departmentCount: Object.keys(s.departmentScores || {}).length,
      approvalStats: s.approvalStats,
      // Number of archived prior close versions (Milestone 5 §12 history).
      historyCount: (s.snapshotHistory?.length ?? 0),
    }));

    return Response.json(summary);
  } catch (error) {
    logServerFailure('month-snapshots', 'GET', error);
    return internalError();
  }
}
