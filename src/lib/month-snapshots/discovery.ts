// ══════════════════════════════════════════════════════════════
//  Month Close — month DISCOVERY / AVAILABILITY (pure)
//
//  HOTFIX: the Month Close page previously listed ONLY stored
//  snapshot documents. A MonthSnapshot document is created
//  exclusively by `closeMonth()`, so a month with real Quality KPI
//  activity (e.g. the CURRENT month, mid-stream) never appeared —
//  and could not even be closed from the UI, because the UI renders
//  only months returned by GET /api/month-snapshots.
//
//  Concept separation (binding — hotfix spec §3):
//    A. DISCOVERY  — a month becomes VISIBLE because valid Quality
//       KPI activity exists for it (observations). Status: 'open'.
//    B. FINALIZATION — a month becomes 'closed' ONLY through the
//       explicit authorized Month Close action (unchanged).
//
//  Canonical activity source (spec §5): the month key on the
//  Quality observation record (`qualityObservations.month`, the same
//  field `computeFreshMonthSnapshot` filters by and the MTD path
//  consumes). This is NOT a second month-tracking system: discovery
//  reuses the exact field the engine already treats as truth.
//
//  Guarantees:
//    • An activity month appears EXACTLY ONCE (dedup by month key).
//    • A month with a stored snapshot doc is NEVER synthesized —
//      the stored document (closed OR reopened-open) wins verbatim.
//    • NO calendar fabrication: a month exists here only if at
//      least one observation carries its key (no empty months, no
//      fake zeros, no empty snapshots for empty calendar months).
//    • NO finalization: synthesized rows are always status 'open'
//      with null close metadata. Closing stays a manual, authorized
//      action that goes through the unchanged closeMonth() path
//      (freeze + scheme/version preservation + history archive).
//    • Missing data is never converted to zero: counts are derived
//      from REAL observation records; approval stats use the
//      engine's own shared aggregation (computeApprovalStats).
//    • Employee-lifecycle safe: discovery is employee-agnostic, so
//      historical months of later-archived employees remain
//      discoverable, and no post-archive zero activity is created.
// ══════════════════════════════════════════════════════════════

import { isValidMonthKey } from '@/lib/month-utils';
import { computeApprovalStats } from '@/lib/metrics/kpiMetrics';
import type { ObservationLike } from '@/lib/metrics/kpiMetrics';

/** Minimal observation shape discovery needs (subset of the DB record). */
export interface DiscoveryObservation {
  month: string;
  employeeId: string;
  department: string;
  applyPointDeduction: boolean;
  approvalStatus: ObservationLike['approvalStatus'];
}

/**
 * Summary row for a DISCOVERED (active, not-yet-closed) month.
 * Mirrors the compact snapshot summary shape returned by
 * GET /api/month-snapshots so the existing Month Close UI renders it
 * with zero UI changes: status 'open' → existing "مفتوح" badge +
 * preview + close actions behave exactly like a stored open month.
 */
export interface DiscoveredMonthSummary {
  id: string;
  monthKey: string;
  status: 'open';
  closedAt: null;
  closedBy: null;
  closedByName: null;
  reopenCount: 0;
  reopenReason: '';
  generatedAt: null;
  employeeCount: number;
  departmentCount: number;
  approvalStats: ReturnType<typeof computeApprovalStats>;
  historyCount: 0;
}

/**
 * Build discovery rows for months that have real Quality KPI activity
 * but no stored snapshot document yet.
 *
 * @param observations           - Quality observation records (any
 *                                 supersets of DiscoveryObservation).
 * @param existingSnapshotMonths - Month keys that already have a stored
 *                                 MonthSnapshot document (any status).
 *                                 Those months are NEVER synthesized.
 * @returns Discovered open-month summaries, most recent month first.
 */
export function buildDiscoveredMonthRows(
  observations: DiscoveryObservation[],
  existingSnapshotMonths: ReadonlySet<string>,
): DiscoveredMonthSummary[] {
  // Group observations by their STRICT month key. Invalid / junk keys
  // ('abc', '2026-13', ISO datetimes) are rejected by the same
  // validator the snapshot pipeline uses — they can never surface.
  const byMonth = new Map<string, DiscoveryObservation[]>();
  for (const obs of observations) {
    if (!obs || !isValidMonthKey(obs.month)) continue;
    const list = byMonth.get(obs.month);
    if (list) list.push(obs);
    else byMonth.set(obs.month, [obs]);
  }

  const rows: DiscoveredMonthSummary[] = [];
  for (const [monthKey, monthObs] of byMonth) {
    // A stored snapshot document (closed, or reopened-open) is the
    // authority for that month — discovery never duplicates it.
    if (existingSnapshotMonths.has(monthKey)) continue;

    rows.push({
      id: monthKey,
      monthKey,
      status: 'open',
      // FINALIZATION fields stay empty: discovery ≠ close. The month
      // becomes FINALIZED only via the explicit close action.
      closedAt: null,
      closedBy: null,
      closedByName: null,
      reopenCount: 0,
      reopenReason: '',
      generatedAt: null,
      // REAL activity counts from the month's actual observations
      // (distinct subjects) — not fabricated, not defaulted.
      employeeCount: new Set(
        monthObs.map((o) => o.employeeId).filter((id) => typeof id === 'string' && id.length > 0),
      ).size,
      departmentCount: new Set(
        monthObs.map((o) => o.department).filter((d) => typeof d === 'string' && d.length > 0),
      ).size,
      // Engine's own aggregation — identical pending/approved/rejected
      // semantics the close gate (pendingCount) relies on.
      approvalStats: computeApprovalStats(monthObs),
      historyCount: 0,
    });
  }

  // Most recent activity month first (consistent with the snapshot list).
  return rows.sort((a, b) => (a.monthKey < b.monthKey ? 1 : a.monthKey > b.monthKey ? -1 : 0));
}
