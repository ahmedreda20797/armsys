// ══════════════════════════════════════════════════════════════
//  Month-lock check — used by edit/approve/delete guards
//
//  When closeMonthLock is enabled in KPI settings, observations in a
//  CLOSED month cannot be edited, approved, rejected, or deleted.
//  This preserves historical snapshot immutability.
// ══════════════════════════════════════════════════════════════

import { getById } from '@/lib/db';
import { getKpiSettings } from '@/lib/kpi-settings';
import type { MonthSnapshot } from '@/types/quality-kpi';

export const MONTH_SNAPSHOTS_TABLE = 'monthSnapshots';

/**
 * Check whether a month is currently closed (locked).
 *
 * A month is "closed" when its snapshot document exists with
 * status === 'closed'. The KPI settings closeMonthLock flag gates
 * whether this lock is ENFORCED (a setting allows admins to disable
 * locking without code changes).
 *
 * @param monthKey - "2026-08" format.
 * @returns true if the month is closed AND locking is enabled.
 */
export async function isMonthClosed(monthKey: string): Promise<boolean> {
  const settings = await getKpiSettings();
  if (!settings.closeMonthLock) return false; // locking disabled by config

  const snapshot = await getById<MonthSnapshot>(MONTH_SNAPSHOTS_TABLE, monthKey);
  return snapshot?.status === 'closed';
}

/**
 * Get the month snapshot document (if it exists).
 */
export async function getMonthSnapshot(monthKey: string): Promise<MonthSnapshot | null> {
  return getById<MonthSnapshot>(MONTH_SNAPSHOTS_TABLE, monthKey);
}
