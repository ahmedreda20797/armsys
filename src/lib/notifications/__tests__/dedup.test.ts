// ══════════════════════════════════════════════════════════════
//  Milestone 9 — Notification deduplication (Part D / Part P)
//
//  Verifies the shared predicates used by createSmartNotification
//  (rules-engine) and fireQualityNotification (quality-events):
//    • A repeated event within the window does not create a
//      duplicate (page refresh / polling retry safe)
//    • The same title for a DIFFERENT entity is not a duplicate
//    • Broadcast notifications (null employeeId) with a
//      sourceRecordId are deduplicated — previously bypassed
//    • Outside the window the event is new again
//
//  Run: npx tsx --test src/lib/notifications/__tests__/dedup.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  findDuplicateByEntityKey,
  findDuplicateByTitleOrRecord,
} from '@/lib/notifications/dedup';

const MIN = 60_000;
const NOW = Date.parse('2026-08-22T12:00:00.000Z');

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n-existing',
    title: 'تم إنشاء حالة كابا',
    employeeId: null,
    sourceRecordId: null,
    createdAt: new Date(NOW - 5 * MIN).toISOString(),
    ...overrides,
  };
}

describe('findDuplicateByEntityKey (rules-engine key)', () => {
  it('same title + entity keys within window → duplicate found', () => {
    const existing = [record({ sourceRecordId: 'capa-1' })];
    const dup = findDuplicateByEntityKey(
      existing,
      { title: 'تم إنشاء حالة كابا', sourceRecordId: 'capa-1' },
      NOW,
      60 * MIN
    );
    assert.equal(dup?.id, 'n-existing');
  });

  it('same title, DIFFERENT record → not a duplicate (distinct events)', () => {
    const existing = [record({ sourceRecordId: 'capa-1' })];
    const dup = findDuplicateByEntityKey(
      existing,
      { title: 'تم إنشاء حالة كابا', sourceRecordId: 'capa-2' },
      NOW,
      60 * MIN
    );
    assert.equal(dup, undefined);
  });

  it('broadcast with sourceRecordId (employeeId null) is deduplicated — the previously bypassed case', () => {
    const existing = [record({ employeeId: null, sourceRecordId: 'fu-1' })];
    const dup = findDuplicateByEntityKey(
      existing,
      { title: 'تم إنشاء حالة كابا', employeeId: null, sourceRecordId: 'fu-1' },
      NOW,
      60 * MIN
    );
    assert.equal(dup?.id, 'n-existing');
  });

  it('employeeId-keyed events still dedup (legacy behavior preserved)', () => {
    const existing = [record({ employeeId: 'e-9' })];
    const dup = findDuplicateByEntityKey(
      existing,
      { title: 'تم إنشاء حالة كابا', employeeId: 'e-9' },
      NOW,
      60 * MIN
    );
    assert.equal(dup?.id, 'n-existing');
    // Different employee → new event
    const other = findDuplicateByEntityKey(
      existing,
      { title: 'تم إنشاء حالة كابا', employeeId: 'e-10' },
      NOW,
      60 * MIN
    );
    assert.equal(other, undefined);
  });

  it('outside the window → not a duplicate (new event)', () => {
    const existing = [record({ sourceRecordId: 'capa-1', createdAt: new Date(NOW - 90 * MIN).toISOString() })];
    const dup = findDuplicateByEntityKey(
      existing,
      { title: 'تم إنشاء حالة كابا', sourceRecordId: 'capa-1' },
      NOW,
      60 * MIN
    );
    assert.equal(dup, undefined);
  });
});

describe('findDuplicateByTitleOrRecord (quality-events key)', () => {
  it('entity-bound event: title + sourceRecordId within window → duplicate', () => {
    const existing = [record({ title: 'ملاحظة جودة بانتظار الاعتماد', sourceRecordId: 'obs-1' })];
    const dup = findDuplicateByTitleOrRecord(
      existing,
      { title: 'ملاحظة جودة بانتظار الاعتماد', sourceRecordId: 'obs-1' },
      NOW,
      30 * MIN
    );
    assert.equal(dup?.id, 'n-existing');
  });

  it('entity-less broadcast (month close): title-only fallback deduplicates the retry', () => {
    const existing = [record({ title: 'تم إغلاق شهر الأداء', sourceRecordId: null })];
    const dup = findDuplicateByTitleOrRecord(
      existing,
      { title: 'تم إغلاق شهر الأداء' },
      NOW,
      30 * MIN
    );
    assert.equal(dup?.id, 'n-existing');
  });

  it('different month (different title) is NOT suppressed', () => {
    const existing = [record({ title: 'تم إغلاق شهر الأداء 2026-07' })];
    const dup = findDuplicateByTitleOrRecord(
      existing,
      { title: 'تم إغلاق شهر الأداء 2026-08' },
      NOW,
      30 * MIN
    );
    assert.equal(dup, undefined);
  });
});
