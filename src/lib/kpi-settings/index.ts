// ══════════════════════════════════════════════════════════════
//  KPI Settings — config-driven engine behavior
//
//  Reads the singleton KPI settings document from the database.
//  Seeds default configuration on first read (idempotent).
//  All KPI behavior flows from this config — future business-rule
//  changes need no code edit.
//
//  Includes module-level caching with a configurable TTL so that
//  repeated reads within the same server process are cheap.
//
//  NOTE: This module IS coupled to Quality's KpiSettings type by
//  design — it is the Quality configuration provider. Its PATTERN
//  (singleton settings, cache+TTL, idempotent seed) is the reusable
//  template for future modules' own settings providers.
// ══════════════════════════════════════════════════════════════

import { getById, createRecordWithId, updateRecord } from '@/lib/db';
import type { KpiSettings, TrendCalculation } from '@/types/quality-kpi';

/** Stable document ID for the singleton KPI settings record. */
export const KPI_SETTINGS_ID = 'singleton';

/** The RTDB collection name for KPI settings. */
export const KPI_SETTINGS_TABLE = 'kpiSettings';

/** Cache TTL in milliseconds for the settings singleton (15 seconds). */
const SETTINGS_TTL_MS = 15_000;

/**
 * Module-level cache for the settings singleton. Invalidated on
 * {@link updateKpiSettings}.
 */
let cachedSettings: KpiSettings | null = null;
let cachedAt = 0;

/**
 * The default configuration applied on first read. All KPI behavior
 * flows from these values — they can be overridden via the admin UI.
 */
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
 * Uses module-level caching with a configurable TTL for efficient
 * repeated calls.
 *
 * @returns The current {@link KpiSettings} document.
 *
 * @remarks
 * Side effects:
 *   - Reads from RTDB on cache miss or TTL expiry.
 *   - Writes a seed document on first read (idempotent — safe for
 *     concurrent requests).
 *   - Cache is invalidated by {@link updateKpiSettings}.
 */
export async function getKpiSettings(): Promise<KpiSettings> {
  const now = Date.now();

  // Return cached if fresh.
  if (cachedSettings && (now - cachedAt) < SETTINGS_TTL_MS) {
    return cachedSettings;
  }

  const existing = await getById<KpiSettings>(KPI_SETTINGS_TABLE, KPI_SETTINGS_ID);
  if (existing) {
    cachedSettings = existing;
    cachedAt = now;
    return existing;
  }

  // First-time seed (idempotent — concurrent requests might both reach
  // here; createRecordWithId is safe to call twice with the same id
  // because it overwrites).
  const settings: KpiSettings = {
    id: KPI_SETTINGS_ID,
    ...DEFAULT_KPI_SETTINGS,
    updatedAt: new Date().toISOString(),
  } as KpiSettings;
  const created = await createRecordWithId(KPI_SETTINGS_TABLE, KPI_SETTINGS_ID, settings);
  cachedSettings = created as unknown as KpiSettings;
  cachedAt = now;
  return cachedSettings;
}

/**
 * Update KPI settings with a partial update. Only provided fields
 * are changed. Invalidates the module-level cache. Returns the
 * updated document.
 *
 * @param partial   - Fields to update.
 * @param actorId   - Who made the change (for audit — not stored here).
 * @param actorName - Who made the change (for audit — not stored here).
 * @returns The updated {@link KpiSettings} document.
 *
 * @remarks
 * Side effects:
 *   - Writes to RTDB.
 *   - Invalidates the module-level cache immediately.
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
  // Invalidate cache immediately.
  cachedSettings = updated as unknown as KpiSettings;
  cachedAt = Date.now();
  return cachedSettings;
}
