// ══════════════════════════════════════════════════════════════
//  /api/month-snapshots
//
//  GET — list available months for the Month Close page
//  (most recent first).
//
//  Milestone 5 (spec §6):
//    • Authentication required (requireAuth).
//    • M0.2: viewing snapshot data additionally requires the existing
//      'kpiDashboard' page permission (view) — snapshots ARE the KPI
//      history the dashboard renders. No new permission key; admin
//      bypass unchanged.
//    • Returns REAL Firebase data only — no fake/demo months.
//    • Supports optional ?status=open|closed filtering.
//    • Returns a compact summary (employeeScores stripped) so the
//      list payload stays small; full detail lives on the [month]
//      detail endpoint.
//
//  HOTFIX — month DISCOVERY/AVAILABILITY (spec §1/§5):
//    • Stored MonthSnapshot documents are created ONLY by the explicit
//      close action, so active months (e.g. the current month with
//      observations recorded Aug 1–20) never appeared. Discovery now
//      ALSO surfaces months that have real Quality KPI activity in
//      `qualityObservations` (the canonical source the engine and the
//      MTD path already filter by) but no snapshot document yet.
//    • Discovered months are status 'open' with real derived counts —
//      NEVER finalized, never fabricated for empty months, never
//      duplicated against a stored document (the stored doc wins).
//    • Close/reopen/freeze behavior is UNCHANGED: closing still goes
//      through POST /[month]/close → closeMonth() → frozen snapshot
//      with scheme/version + history preservation.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, sortByField, TTL } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { unauthorizedError, forbiddenError, internalError, logServerFailure } from '@/lib/api-error';
import { MONTH_SNAPSHOTS_TABLE } from '@/lib/month-lock';
import { buildDiscoveredMonthRows } from '@/lib/month-snapshots/discovery';
import type { MonthSnapshot, QualityObservation } from '@/types/quality-kpi';

/** Compact list row — stored snapshot OR discovered active month. */
interface MonthSummaryRow {
  id: string;
  monthKey: string;
  status: 'open' | 'closed';
  closedAt: string | null;
  closedBy: string | null;
  closedByName: string | null;
  reopenCount: number;
  reopenReason?: string;
  generatedAt: string | null;
  employeeCount: number;
  departmentCount: number;
  approvalStats: MonthSnapshot['approvalStats'] | null;
  historyCount: number;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    // M0.2: snapshot reads share the KPI dashboard's view gate.
    const permCheck = await verifyPermission(request, 'kpiDashboard', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // 'open' | 'closed' | undefined

    // Real Firebase data only — no generated/demo months.
    const snapshots = await getAll<MonthSnapshot>(MONTH_SNAPSHOTS_TABLE, TTL.STATIC);

    // Stored documents (closed OR reopened-open) — the authority for
    // any month that already has one. Summary view strips the large
    // employeeScores map; full detail lives on the [month] endpoint.
    const snapshotRows: MonthSummaryRow[] = snapshots.map((s) => ({
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

    // ── Month discovery (hotfix) ──────────────────────────────────
    // Months with real Quality KPI activity but no snapshot document.
    // One cached read of the SAME collection the canonical engine
    // consumes (computeFreshMonthSnapshot uses TTL.MEDIUM too).
    // The pure builder enforces: strict month-key validation, one row
    // per month, no duplication against stored docs, open-only status,
    // real derived counts (no fabricated zeros, no empty months).
    const observations = await getAll<QualityObservation>('qualityObservations', TTL.MEDIUM);
    const existingMonths = new Set(snapshots.map((s) => s.monthKey));
    const discoveredRows = buildDiscoveredMonthRows(observations, existingMonths);

    // Merge, then apply the optional status filter, then sort.
    let merged: MonthSummaryRow[] = [...snapshotRows, ...discoveredRows];
    if (status === 'open' || status === 'closed') {
      merged = merged.filter((s) => s.status === status);
    }

    // Most recent month first.
    const sorted = sortByField(merged, 'monthKey', 'desc');

    return Response.json(sorted);
  } catch (error) {
    logServerFailure('month-snapshots', 'GET', error);
    return internalError();
  }
}
