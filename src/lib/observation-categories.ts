// ══════════════════════════════════════════════════════════════
//  Observation Categories — seed + management (Improvement #3)
//
//  Default categories with both defaultPointValue AND weight.
//  Points drive the current score formula; weight is stored for
//  future analytics.
//
//  Seeds are idempotent — checked on first read and only created
//  if the collection is empty.
// ══════════════════════════════════════════════════════════════

import { getAll, createRecord, TTL } from '@/lib/db';
import type { ObservationCategory, Severity, Priority } from '@/types/quality-kpi';

export const OBSERVATION_CATEGORIES_TABLE = 'observationCategories';

/** Default categories to seed on first read. */
export const DEFAULT_CATEGORIES: Omit<ObservationCategory, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    schemaVersion: 1,
    key: 'late_followup',
    name: 'تأخر متابعة',
    defaultPointValue: 2,
    weight: 1,
    color: 'amber',
    priority: 'medium' as Priority,
    isBonusDefault: false,
  },
  {
    schemaVersion: 1,
    key: 'wrong_information',
    name: 'معلومات غير صحيحة',
    defaultPointValue: 2,
    weight: 3,
    color: 'rose',
    priority: 'high' as Priority,
    isBonusDefault: false,
  },
  {
    schemaVersion: 1,
    key: 'missed_customer',
    name: 'فقدان عميل',
    defaultPointValue: 10,
    weight: 5,
    color: 'red',
    priority: 'critical' as Priority,
    isBonusDefault: false,
  },
  {
    schemaVersion: 1,
    key: 'excellent_performance',
    name: 'أداء ممتاز',
    defaultPointValue: 3,
    weight: 2,
    color: 'emerald',
    priority: 'low' as Priority,
    isBonusDefault: true,
  },
  {
    schemaVersion: 1,
    key: 'team_assistance',
    name: 'مساعدة الفريق',
    defaultPointValue: 2,
    weight: 1,
    color: 'blue',
    priority: 'low' as Priority,
    isBonusDefault: true,
  },
  {
    schemaVersion: 1,
    key: 'fast_recovery',
    name: 'تعافي سريع',
    defaultPointValue: 5,
    weight: 3,
    color: 'cyan',
    priority: 'medium' as Priority,
    isBonusDefault: true,
  },
  {
    schemaVersion: 1,
    key: 'safety_violation',
    name: 'مخالفة أمان',
    defaultPointValue: 8,
    weight: 5,
    color: 'red',
    priority: 'critical' as Priority,
    isBonusDefault: false,
  },
  {
    schemaVersion: 1,
    key: 'attendance_issue',
    name: 'مشكلة حضور',
    defaultPointValue: 3,
    weight: 2,
    color: 'orange',
    priority: 'medium' as Priority,
    isBonusDefault: false,
  },
  {
    schemaVersion: 1,
    key: 'customer_complaint_quality',
    name: 'شكوى جودة عميل',
    defaultPointValue: 7,
    weight: 4,
    color: 'rose',
    priority: 'high' as Priority,
    isBonusDefault: false,
  },
  {
    schemaVersion: 1,
    key: 'process_improvement',
    name: 'تحسين عملية',
    defaultPointValue: 4,
    weight: 2,
    color: 'violet',
    priority: 'medium' as Priority,
    isBonusDefault: true,
  },
];

/**
 * Seed the default categories if the collection is empty.
 * Idempotent — safe to call on every request.
 */
export async function seedCategoriesIfEmpty(): Promise<void> {
  const existing = await getAll<ObservationCategory>(OBSERVATION_CATEGORIES_TABLE, TTL.STATIC);
  if (existing.length > 0) return;

  for (const cat of DEFAULT_CATEGORIES) {
    await createRecord(OBSERVATION_CATEGORIES_TABLE, cat);
  }
}
