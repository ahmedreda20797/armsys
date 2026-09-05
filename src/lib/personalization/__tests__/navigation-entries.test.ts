// ══════════════════════════════════════════════════════════════
//  Personal Workspace — Favorites/Pins reconciliation tests (M7)
//
//  Run: npx tsx --test src/lib/personalization/__tests__/navigation-entries.test.ts
//
//  Covers §22/§23/§31/§32:
//    1  Toggle add (front, de-duped) and remove (idempotent pair)
//    2  Permission reconciliation hides revoked routes (kept stored)
//    3  Invalid shapes never survive reconciliation
//    4  Record entries require a targetId
//    5  Descriptor equality ignores label/context
//    6  Sanitizer whitelist: malformed payloads are dropped; arrays
//       capped; navigationContext param-limited (no storage bloat)
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  navigationEntriesEqual,
  reconcileNavigationEntries,
  sanitizeUserPreferencesInput,
  toggleNavigationEntry,
  type FavoriteEntry,
} from '@/lib/personalization';

const NOW = '2026-09-05T12:00:00.000Z';
let counter = 0;
const nextId = () => `id-${++counter}`;

function entry(partial: Partial<FavoriteEntry>): FavoriteEntry {
  return {
    id: nextId(),
    targetType: 'record',
    targetId: 'r1',
    route: 'complaints',
    label: 'سجل',
    addedAt: NOW,
    ...partial,
  };
}

describe('Personal Workspace — Favorites/Pins (Milestone 7)', () => {
  it('1. toggle adds to FRONT, second toggle removes (no duplicates)', () => {
    const d = { targetType: 'record' as const, targetId: 'c1', route: 'complaints', label: 'شكوى' };
    const added = toggleNavigationEntry<FavoriteEntry>([], d, nextId, NOW, navigationEntriesEqual);
    assert.equal(added.length, 1);
    assert.equal(added[0].label, 'شكوى');

    const removed = toggleNavigationEntry<FavoriteEntry>(added, d, nextId, NOW, navigationEntriesEqual);
    assert.equal(removed.length, 0);
  });

  it('2. reconcile HIDES entries whose route is no longer visible (kept stored)', () => {
    const stored = [
      entry({ route: 'complaints', targetId: 'c1' }),
      entry({ route: 'revokedPage', targetId: 'x1' }),
      entry({ route: 'capa', targetType: 'page' }),
    ];
    const visible = reconcileNavigationEntries(stored, (route) => route !== 'revokedPage');
    assert.equal(visible.length, 2);
    assert.ok(visible.every((e) => e.route !== 'revokedPage'));
    assert.equal(stored.length, 3); // storage untouched
  });

  it('3. invalid entries (unknown route shape / bad targetType) never surface', () => {
    const stored = [
      entry({}),
      // route present but null-ish targetType smuggled in via cast
      { ...entry({}), targetType: 'weird' } as unknown as FavoriteEntry,
      entry({ targetType: 'page', route: 'capa' }),
    ];
    const visible = reconcileNavigationEntries(stored, () => true);
    assert.equal(visible.length, 2); // 'weird' dropped, the two valid entries stay
    assert.ok(visible.every((e) => e.targetType === 'page' || e.targetType === 'record'));
  });

  it('4. record entries WITHOUT targetId are filtered out', () => {
    const stored = [entry({ targetId: undefined })] as FavoriteEntry[];
    assert.equal(reconcileNavigationEntries(stored, () => true).length, 0);
  });

  it('5. equality ignores label/navigationContext (route+type+id identity)', () => {
    const a = entry({ label: 'قديم', navigationContext: { a: '1' } });
    const b = entry({ label: 'جديد' });
    assert.ok(navigationEntriesEqual(a, b));
    assert.ok(!navigationEntriesEqual(a, entry({ targetId: 'r2' })));
  });

  it('6. sanitizer: whitelist-only, size-capped, context params limited', () => {
    const payload = {
      favorites: [
        entry({ route: 'capa', targetType: 'page' }),
        { bogus: true }, // dropped
        entry({ route: 'complaints', targetId: 'c9' }),
      ],
      pins: [entry({ route: 'employees', targetId: 'e1' })],
      // unknown top-level keys must be dropped by the sanitizer
      hacker: 'nope',
    };
    const sanitized = sanitizeUserPreferencesInput(payload);
    assert.ok(sanitized);
    assert.equal(sanitized.favorites?.length, 2);
    assert.equal(sanitized.pins?.length, 1);
    assert.equal((sanitized as Record<string, unknown>).hacker, undefined);

    // navigationContext oversized values are stripped
    const withBigCtx = sanitizeUserPreferencesInput({
      pins: [{ ...entry({ route: 'capa', targetType: 'page' }), navigationContext: { ok: 'v', bad: 'x'.repeat(500) } }],
    });
    assert.ok(withBigCtx);
    assert.deepEqual(Object.keys(withBigCtx.pins![0].navigationContext ?? {}), ['ok']);
  });
});
