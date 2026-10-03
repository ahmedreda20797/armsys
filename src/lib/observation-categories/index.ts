// ══════════════════════════════════════════════════════════════
//  Observation Categories — MASTER DATA provider (Quality domain)
//
//  This module is the SINGLE canonical source of the quality
//  observation category vocabulary. It is a Master Data domain:
//  configurable business vocabulary, NOT transactional data and NOT
//  system settings. The Quality engine (observations, approval,
//  scoring, snapshots) remains authoritative for behavior — this
//  module only supplies the vocabulary.
//
//  §MASTER-DATA-MIGRATION — `ensureObservationCategoryMasterData`
//  is the one and only write path for seeding/migrating:
//    • Fresh install        → creates the full current vocabulary.
//    • Pre-master-data data → backfills ONLY missing fields
//                             (nameEn / isActive / sortOrder / impact),
//                             applies the two sanctioned renames
//                             (تأخر متابعة → متابعة, أداء ممتاز → أداء)
//                             ONLY when the record still carries the
//                             exact legacy name, and inserts missing
//                             additional categories.
//    • Idempotent           → a second run performs zero writes.
//    • Additive only        → nothing is ever deactivated, deleted,
//                             or overwritten with a different value.
// ══════════════════════════════════════════════════════════════

import { getAll, createRecord, updateRecord, TTL } from '@/lib/db';
import type { CategoryImpact, ObservationCategory, Priority } from '@/types/quality-kpi';
import { sortCategories } from './presentation';

export { sortCategories };

/** The RTDB collection name for observation categories. */
export const OBSERVATION_CATEGORIES_TABLE = 'observationCategories';

type CategorySeed = Omit<ObservationCategory, 'id' | 'createdAt' | 'updatedAt'> & {
  schemaVersion: 1;
};

function seed(
  key: string,
  name: string,
  nameEn: string,
  sortOrder: number,
  defaultPointValue: number,
  weight: number,
  color: string,
  priority: Priority,
  impact: CategoryImpact,
): CategorySeed {
  return {
    schemaVersion: 1,
    key,
    name,
    nameEn,
    sortOrder,
    impact,
    defaultPointValue,
    weight,
    color,
    priority,
    isActive: true,
    isBonusDefault: impact === 'POSITIVE',
  };
}

/**
 * The canonical bootstrap vocabulary — the 10 pre-existing categories
 * (in their historical order) with Master Data fields attached.
 *
 * On a FRESH install (no history) the two renamed keys are seeded
 * directly with their new canonical labels (متابعة / أداء) — there is
 * no historical record to preserve. On EXISTING installs the rename
 * is applied by the migration ONLY to records still carrying the
 * exact legacy name (see LEGACY_RENAMES).
 */
export const DEFAULT_CATEGORIES: CategorySeed[] = [
  seed('late_followup', 'متابعة', 'Follow-up', 1, 2, 1, 'amber', 'medium', 'NEGATIVE'),
  seed('wrong_information', 'معلومات غير صحيحة', 'Incorrect Information', 2, 2, 3, 'rose', 'high', 'NEGATIVE'),
  seed('missed_customer', 'فقدان عميل', 'Customer Loss', 3, 10, 5, 'red', 'critical', 'NEGATIVE'),
  seed('excellent_performance', 'أداء', 'Performance', 4, 3, 2, 'emerald', 'low', 'POSITIVE'),
  seed('team_assistance', 'مساعدة الفريق', 'Team Support', 5, 2, 1, 'blue', 'low', 'POSITIVE'),
  seed('fast_recovery', 'تعافي سريع', 'Quick Recovery', 6, 5, 3, 'cyan', 'medium', 'POSITIVE'),
  seed('safety_violation', 'مخالفة أمان', 'Safety Violation', 7, 8, 5, 'red', 'critical', 'NEGATIVE'),
  seed('attendance_issue', 'مشكلة حضور', 'Attendance Issue', 8, 3, 2, 'orange', 'medium', 'NEGATIVE'),
  seed('customer_complaint_quality', 'شكوى جودة عميل', 'Customer Quality Complaint', 9, 7, 4, 'rose', 'high', 'NEGATIVE'),
  seed('process_improvement', 'تحسين عملية', 'Process Improvement', 10, 4, 2, 'violet', 'medium', 'POSITIVE'),
];

/**
 * §QNALYS-MASTER-DATA-REQUEST — the NEW categories (ADDITIONS ONLY).
 * Never applied over an existing record; inserted by `key` only when
 * the key is absent. `defaultPointValue` stays 0 — the System Owner
 * configures real values; the system does not invent point values.
 */
export const ADDITIONAL_CATEGORIES: CategorySeed[] = [
  seed('package_preparation_delay', 'تأخير تجهيز الباكدج', 'Package Preparation Delay', 0, 0, 1, 'amber', 'medium', 'NEGATIVE'),
  seed('delayed_customer_response', 'تأخير الرد على العميل', 'Delayed Customer Response', 0, 0, 1, 'orange', 'medium', 'NEGATIVE'),
  seed('deal_neglect', 'إهمال الديلات', 'Deal Neglect', 0, 0, 1, 'rose', 'high', 'NEGATIVE'),
  seed('lack_of_focus', 'عدم التركيز', 'Lack of Focus', 0, 0, 1, 'slate', 'medium', 'NEGATIVE'),
  seed('tasks_alerts_not_completed', 'عدم تنفيذ التاسكات والتنبيهات', 'Tasks and Alerts Not Completed', 0, 0, 1, 'orange', 'high', 'NEGATIVE'),
  seed('no_team_support', 'عدم مساعدة الفريق', 'Failure to Support the Team', 0, 0, 1, 'slate', 'medium', 'NEGATIVE'),
  seed('supplier_handling_errors', 'أخطاء في التعامل مع الموردين', 'Supplier Handling Errors', 0, 0, 1, 'rose', 'high', 'NEGATIVE'),
  seed('ignoring_customer', 'تجاهل العميل', 'Ignoring the Customer', 0, 0, 1, 'red', 'high', 'NEGATIVE'),
];

/**
 * §13 sanctioned renames — applied ONLY when the record's key matches
 * AND its name still equals the exact legacy value (a manually
 * renamed record is never touched). Historical observations keep
 * their frozen `categoryName`; renames affect the Master Data label
 * used by NEW observations.
 */
export const LEGACY_RENAMES: ReadonlyArray<{
  key: string;
  legacyName: string;
  newName: string;
  nameEn: string;
}> = [
  { key: 'late_followup', legacyName: 'تأخر متابعة', newName: 'متابعة', nameEn: 'Follow-up' },
  { key: 'excellent_performance', legacyName: 'أداء ممتاز', newName: 'أداء', nameEn: 'Performance' },
];

/** sortOrder assigned to pre-master-data records whose key is not in the seed list. */
const UNSEEDED_SORT_BASE = 200;

/**
 * Pure: compute the idempotent backfill patch for one record.
 * Returns null when every Master Data field is already present and
 * no sanctioned rename applies — the record is already migrated.
 * NEVER produces a patch that changes an existing non-legacy value.
 */
export function buildMasterDataPatch(
  record: ObservationCategory,
  position: number,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const seedIndex = DEFAULT_CATEGORIES.findIndex((c) => c.key === record.key);

  if (record.nameEn === undefined) {
    const rename = LEGACY_RENAMES.find((r) => r.key === record.key);
    patch.nameEn = rename ? rename.nameEn : DEFAULT_CATEGORIES[seedIndex]?.nameEn;
  }
  if (record.isActive === undefined) patch.isActive = true;
  if (record.sortOrder === undefined) {
    patch.sortOrder = seedIndex >= 0 ? seedIndex + 1 : UNSEEDED_SORT_BASE + position;
  }
  if (record.impact === undefined) {
    patch.impact = (record.isBonusDefault ? 'POSITIVE' : 'NEGATIVE') as CategoryImpact;
  }

  // §13 sanctioned rename — only for the exact legacy label.
  const rename = LEGACY_RENAMES.find(
    (r) => r.key === record.key && record.name === r.legacyName,
  );
  if (rename) {
    patch.name = rename.newName;
    patch.nameEn = rename.nameEn;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Pure: canonical display ordering — sortOrder first, then Arabic
 * name. Selectors and the Master Data table MUST use this instead of
 * array order. (Implementation lives in ./presentation — client-safe.)
 */

/**
 * Ensure the Master Data vocabulary exists and is current.
 * Idempotent — safe to call on every request; a converged collection
 * produces ZERO writes.
 *
 * @remarks
 * Side effects:
 *   - Reads from RTDB (STATIC-cached).
 *   - Writes ONLY missing fields / missing keys / sanctioned renames.
 */
export async function ensureObservationCategoryMasterData(): Promise<void> {
  const existing = await getAll<ObservationCategory>(OBSERVATION_CATEGORIES_TABLE, TTL.STATIC);

  // ── Fresh install: create the full current vocabulary ──
  if (existing.length === 0) {
    // Additions carry sortOrder 0 in the seed table (insert position is
    // computed at creation so they always follow the existing list).
    for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
      await createRecord(OBSERVATION_CATEGORIES_TABLE, DEFAULT_CATEGORIES[i]);
    }
    for (let i = 0; i < ADDITIONAL_CATEGORIES.length; i++) {
      await createRecord(OBSERVATION_CATEGORIES_TABLE, {
        ...ADDITIONAL_CATEGORIES[i],
        sortOrder: DEFAULT_CATEGORIES.length + i + 1,
      });
    }
    return;
  }

  // ── Existing install: additive-only convergence ──
  // Compute patches first, THEN the max sortOrder (a backfilled
  // record's new sortOrder must count, or additions would sort
  // BEFORE backfilled unseeded records).
  const patches: Array<{ id: string; patch: Record<string, unknown> | null }> = existing.map((record, i) => ({
    id: record.id,
    patch: buildMasterDataPatch(record, i),
  }));

  let maxSortOrder = 0;
  for (let i = 0; i < existing.length; i++) {
    const raw = existing[i].sortOrder;
    const patched = patches[i].patch?.sortOrder;
    const effective = typeof raw === 'number'
      ? raw
      : typeof patched === 'number' ? patched : 0;
    if (effective > maxSortOrder) maxSortOrder = effective;
  }

  for (const { id, patch } of patches) {
    if (patch) await updateRecord(OBSERVATION_CATEGORIES_TABLE, id, patch);
  }

  // Insert missing additional categories — by key, never duplicating.
  const knownKeys = new Set(existing.map((c) => c.key));
  for (const addition of ADDITIONAL_CATEGORIES) {
    if (knownKeys.has(addition.key)) continue;
    maxSortOrder += 1;
    await createRecord(OBSERVATION_CATEGORIES_TABLE, { ...addition, sortOrder: maxSortOrder });
  }
}
