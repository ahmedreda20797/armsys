// ══════════════════════════════════════════════════════════════
//  Report Continuity Layer — Phase 6.3 (PURE contracts + storage)
//
//  A generated report is a WORK PRODUCT: leaving the page and coming
//  back must show the SAME generated output (§13/§16) — never a
//  silent regeneration, never a blank page.
//
//  SNAPSHOT CONTRACT (§14) — minimal, per report kind:
//    reportId / reportType / subject / period / filters /
//    generatedAt / generatedBy / stateVersion / dataVersion / data
//
//  PERSISTENCE LEVEL (§15): ReportsPage's generated report is level
//  B (restorable generated report) — persisted CLIENT-SIDE under the
//  authenticated user's scope (page-state 'local' storage). NO new
//  Firebase model, NO server write (§48): filters and report views
//  are not business data.
//
//  IMMUTABILITY (§16): restoring shows the snapshot VERBATIM with an
//  explicit "تمت الاستعادة" status + generatedAt (§20). A fresh
//  result always requires the page's explicit Generate action, which
//  atomically REPLACES the snapshot (§18 current-report semantics).
//
//  STALE SAFETY (§19): the snapshot carries generatedAt + period +
//  dataVersion; the UI surfaces all three so an old report is never
//  presented as live current data.
// ══════════════════════════════════════════════════════════════

import {
  readPageState,
  removePageState,
  writePageState,
} from '@/lib/page-state/persistence';

/** The single report snapshot a page keeps (§18 — Current Report). */
export interface ReportSnapshot<TData> {
  /** Unique id of THIS generation run (regeneration mints a new id). */
  reportId: string;
  /** Registered report kind, e.g. 'monthly-attendance-report'. */
  reportType: string;
  /** Subject scope when the report targets one subject. */
  subject: { employeeId?: string; department?: string } | null;
  /** The period the report was generated FOR (YYYY-MM). */
  period: string;
  /** The filter context the report was generated FROM (§17). */
  filters: Record<string, string | number | boolean | null>;
  /** ISO instant of generation. */
  generatedAt: string;
  /** The authenticated user who generated it. */
  generatedBy: string;
  /** Snapshot schema version (§7) — bump to orphan old snapshots. */
  stateVersion: number;
  /** Version stamp of the producing logic/engine when applicable. */
  dataVersion?: string;
  /** The generated payload itself (verbatim — never recomputed). */
  data: TData;
}

/** Restore status surfaced by the UI (§20). */
export type ReportRestoreStatus = 'generated' | 'restored';

export interface RestoredReport<TData> {
  snapshot: ReportSnapshot<TData>;
  status: ReportRestoreStatus;
}

/** Pure: does a snapshot match the requested period + filters (§17)? */
export function snapshotMatchesContext(
  snapshot: ReportSnapshot<unknown> | null,
  period: string,
  filters: Record<string, string | number | boolean | null>,
): boolean {
  if (!snapshot) return false;
  if (snapshot.period !== period) return false;
  const a = snapshot.filters ?? {};
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(filters).length) return false;
  for (const key of aKeys) {
    if (a[key] !== filters[key]) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
//  Storage binding — ONE report slot per (user, page).
//  Uses the shared page-state envelope (versioned, user-scoped,
//  fail-safe) with 'local' storage per the §5 doctrine.
// ─────────────────────────────────────────────────────────────

export interface ReportSlotInput {
  userId: string;
  /** The PageRouter page key that owns the report. */
  page: string;
  /** Snapshot schema version. */
  version: number;
}

export function saveReportSnapshot<TData>(
  input: ReportSlotInput,
  snapshot: ReportSnapshot<TData>,
): void {
  writePageState({ userId: input.userId, page: input.page, version: input.version, storage: 'local' }, snapshot);
}

export function loadReportSnapshot<TData>(
  input: ReportSlotInput,
): RestoredReport<TData> | null {
  const envelope = readPageState<ReportSnapshot<TData>>({
    userId: input.userId,
    page: input.page,
    version: input.version,
    storage: 'local',
  });
  if (!envelope) return null;
  const snap = envelope.state;
  if (!snap || typeof snap !== 'object') return null;
  if (typeof snap.reportId !== 'string' || typeof snap.generatedAt !== 'string') return null;
  if (snap.stateVersion !== input.version) return null;
  return { snapshot: snap, status: 'restored' };
}

export function clearReportSnapshot(input: ReportSlotInput): void {
  removePageState({ userId: input.userId, page: input.page, version: input.version, storage: 'local' });
}
