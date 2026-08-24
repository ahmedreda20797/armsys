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
//  Permission (M0.2): authentication + 'kpiDashboard' view — the same
//  gate as the snapshot LIST endpoint (snapshot detail IS dashboard
//  data). Admin bypass unchanged.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  unauthorizedError, forbiddenError, validationError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { validateMonthKey } from '@/lib/month-utils';
import { getMonthDetail } from '@/lib/month-snapshots';
import { scopeMonthSnapshotToEmployees } from '@/lib/kpi-dashboard';
import { authScopeViewer, resolveEmployeeScopeFromDb } from '@/lib/scope/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    // M0.2: snapshot detail shares the KPI dashboard's view gate.
    const permCheck = await verifyPermission(request, 'kpiDashboard', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id: monthKey } = await params;

    // Strict YYYY-MM validation (spec §18): rejects 2026-13, 2026-00,
    // malformed strings, and arbitrary input.
    const monthError = validateMonthKey(monthKey);
    if (monthError) return validationError(monthError);

    // Service handles the closed-vs-open branching and delegates to
    // the canonical KPI engine for the open-month live preview.
    const detail = await getMonthDetail(monthKey);

    // M0.5 read scope: snapshot detail is employee-linked dashboard
    // data. A scoped viewer receives the SAME frozen/live values for
    // authorized employees only — employeeScores restricted, every
    // employee-derived aggregate (department scores, category totals,
    // approval stats) rebuilt from authorized entries, leaderboards
    // filtered, archived history versions restricted identically. No
    // KPI value is recomputed; unrestricted viewers get the snapshot
    // byte-for-byte as before.
    if (detail) {
      const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
      if (!scopeCtx.isUnrestricted) {
        return Response.json(scopeMonthSnapshotToEmployees(detail, scopeCtx.employeeIds));
      }
    }

    return Response.json(detail);
  } catch (error) {
    logServerFailure('month-snapshots/[id]', 'GET', error);
    return internalError();
  }
}
