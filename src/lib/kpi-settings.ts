// ══════════════════════════════════════════════════════════════
//  KPI Settings — config-driven engine behavior (Improvement #2)
//
//  Reads the singleton kpiSettings document from Firebase RTDB.
//  Seeds the default configuration on first read (idempotent).
//  All KPI behavior flows from this config — future business-rule
//  changes need no code edit.
// ══════════════════════════════════════════════════════════════

import { getById, createRecordWithId, updateRecord, TTL } from '@/lib/db';
import type { KpiSettings, TrendCalculation } from '@/types/quality-kpi';

export const KPI_SETTINGS_ID = 'singleton';
export const KPI_SETTINGS_TABLE = 'kpiSettings';

/** The default configuration applied on first read. */
export const DEFAULT_KPI_SETTINGS: Omit<KpiSettings, 'id' | 'createdAt' | 'updatedAt'> = {
  schemaVersion: 1,
  defaultScore: 100,
  minimumScore: 0,
  allowBonus: true,
  maximumBonus: 20,
  approvalRequired: true,
  leaderboardEnabled: true,
  closeMonthLock: true,
  trendCalculation: 'rollingAverage' satisfies TrendCalculation,
};

/**
 * Get the current KPI settings. Seeds defaults on first read.
 * Uses TTL-cached getById for efficient repeated calls.
 */
export async function getKpiSettings(): Promise<KpiSettings> {
  const existing = await getById<KpiSettings>(KPI_SETTINGS_TABLE, KPI_SETTINGS_ID);
  if (existing) return existing;

  // First-time seed (idempotent — getById is cached, so concurrent
  // requests might both reach here; createRecordWithId is safe to
  // call twice with the same id because it overwrites).
  const now = new Date().toISOString();
  const settings: KpiSettings = {
    id: KPI_SETTINGS_ID,
    ...DEFAULT_KPI_SETTINGS,
    updatedAt: now,
  } as KpiSettings;
  await createRecordWithId(KPI_SETTINGS_TABLE, KPI_SETTINGS_ID, settings);
  return settings;
}

/**
 * Update KPI settings with a partial update. Only provided fields
 * are changed. Returns the updated document.
 *
 * @param partial - Fields to update.
 * @param actorId - Who made the change (for audit).
 * @param actorName - Who made the change (for audit).
 */
export async function updateKpiSettings(
  partial: Partial<Omit<KpiSettings, 'id' | 'schemaVersion'>>,
  actorId: string,
  actorName: string,
): Promise<KpiSettings> {
  const updated = await updateRecord(KPI_SETTINGS_TABLE, KPI_SETTINGS_ID, partial);
  if (!updated) {
    throw new Error('Failed to update KPI settings');
  }
  return updated as unknown as KpiSettings;
}
