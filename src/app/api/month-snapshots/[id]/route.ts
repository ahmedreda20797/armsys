// ══════════════════════════════════════════════════════════════
//  /api/month-snapshots/[id]
//
//  GET — fetch a single month snapshot in full detail (spec §7).
//
//  • CLOSED month → return the stored frozen immutable snapshot.
//    NO recalculation. NO querying current employee metadata to
//    replace frozen metadata. NO recomputing historical KPI values.
//  • OPEN month   → return a LIVE-calculated preview using the
//    canonical KPI engine. The stored snapshot is NOT overwritten —
//    this response is a transient live representation.
//
//  This route is THIN: it authenticates, validates the month key,
//  then delegates to the month-snapshots service. No scoring logic
//  lives here (spec §2).
//
//  Permission: requireAuth.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/verify-permission';
import {
  unauthorizedError, validationError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { validateMonthKey } from '@/lib/month-utils';
import { getMonthDetail } from '@/lib/month-snapshots';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const { id: monthKey } = await params;

    // Strict YYYY-MM validation (spec §18): rejects 2026-13, 2026-00,
    // malformed strings, and arbitrary input.
    const monthError = validateMonthKey(monthKey);
    if (monthError) return validationError(monthError);

    // Service handles the closed-vs-open branching and delegates to
    // the canonical KPI engine for the open-month live preview.
    const detail = await getMonthDetail(monthKey);
    return Response.json(detail);
  } catch (error) {
    logServerFailure('month-snapshots/[id]', 'GET', error);
    return internalError();
  }
}
