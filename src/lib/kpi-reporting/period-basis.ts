// ══════════════════════════════════════════════════════════════
//  KPI Reporting Layer — Period & value-basis helpers (Phase 2)
//
//  Pure calendar/basis semantics. NO scores, NO weights, NO db.
//
//  Value-basis rule (spec §7/§8 — binding):
//    • CLOSED month                     → FINALIZED (frozen values)
//    • OPEN month === current calendar  → MTD (live through "now")
//    • OPEN month < current (never closed) → LIVE ("NOT FINALIZED")
//    • OPEN month > current             → LIVE
//
//  Month/day keys reuse the established project conventions:
//  strict YYYY-MM (lib/month-utils) and YYYY-MM-DD day keys.
// ══════════════════════════════════════════════════════════════

import type { KpiValueBasis } from './types';

/** Local-calendar month key (YYYY-MM) of a Date. */
export function monthKeyOf(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Local-calendar day key (YYYY-MM-DD) of a Date. */
export function dayKeyOf(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  return `${monthKeyOf(date)}-${day}`;
}

/**
 * Resolve the value basis for one month given its snapshot status
 * and "now". `snapshotStatus === null` means no snapshot document
 * exists yet (the month is effectively open — nothing was frozen).
 */
export function resolveValueBasis(
  monthKey: string,
  snapshotStatus: 'open' | 'closed' | null,
  now: Date,
): KpiValueBasis {
  if (snapshotStatus === 'closed') return 'FINALIZED';
  const current = monthKeyOf(now);
  if (monthKey === current) return 'MTD';
  return 'LIVE';
}

/** The month key immediately before `monthKey` (pure YYYY-MM arithmetic). */
export function previousMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const date = new Date(y, m - 2, 1); // month-1, 0-based → m-2
  return monthKeyOf(date);
}

/**
 * Ascending calendar window of `count` month keys ENDING at
 * `endMonthKey`. Used for trend displays (spec §16) — months with
 * no valid result are reported as UNAVAILABLE, never zero-filled.
 */
export function trendWindow(endMonthKey: string, count: number): string[] {
  const n = Math.max(1, Math.min(36, Math.trunc(count)));
  const [y, m] = endMonthKey.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = new Date(y, m - 1 - i, 1);
    out.push(monthKeyOf(date));
  }
  return out;
}

/**
 * Arabic explanation for every explicit (non-value) engine outcome.
 * Reporting never fabricates numbers for these states — the message
 * is the deliverable (spec §12).
 */
export const KPI_OUTCOME_MESSAGES: Readonly<Record<string, string>> = {
  EMPLOYEE_NOT_FOUND: 'الموظف غير موجود',
  NOT_ELIGIBLE_PERIOD: 'الموظف لم يكن مُستخدمًا خلال هذه الفترة — لا توجد نتيجة KPI (لا تُختلق أصفار)',
  NO_SCHEME: 'لا يوجد مخطط KPI سارٍ لهذا الموظف في هذه الفترة',
  AMBIGUOUS: 'توجد مخططات KPI متعددة متطابقة لهذا الموظف في هذه الفترة — يلزم المراجعة',
  OVERRIDE_NOT_RESOLVABLE: 'المخطط المعتمد لهذا الموظف غير قابل للتطبيق في هذه الفترة',
};
