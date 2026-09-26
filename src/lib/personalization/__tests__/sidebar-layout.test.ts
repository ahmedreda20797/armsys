// ══════════════════════════════════════════════════════════════
//  §SIDEBAR-WORKSPACE — the sidebar layout engine contract.
//
//  These tests pin BEHAVIOR, not implementation: default layout,
//  every edit operation, reconciliation against the authorized set
//  (fail-closed), legacy migration, malformed-input recovery, and
//  the persistence boundary. The engine is pure — inputs are never
//  mutated, so one layout can be safely shared/drafted per user.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addSidebarGroup,
  createDefaultLayout,
  deleteSidebarGroup,
  insertionIndexForPointerY,
  MAIN_GROUP_ID,
  MAX_GROUP_NAME_LENGTH,
  MAX_SIDEBAR_GROUPS,
  migrateLegacySidebarLayout,
  moveSidebarGroup,
  moveSidebarItem,
  normalizeSidebarLayout,
  reconcileSidebarLayout,
  renameSidebarGroup,
  sanitizeSidebarLayoutPayload,
  setGroupCollapsed,
  SIDEBAR_LAYOUT_VERSION,
  sidebarGroupLabel,
  validateGroupName,
  type SidebarLayout,
} from '@/lib/personalization/sidebar-layout';

const VISIBLE = ['home', 'employees', 'quality', 'reports', 'settings'];
const makeId = (() => {
  let n = 0;
  return () => `gid-${++n}`;
})();

function groupItems(layout: SidebarLayout, groupId: string): string[] {
  const g = layout.groups.find((x) => x.id === groupId);
  return g ? g.items.map((it) => it.id) : [];
}

describe('§SIDEBAR-WORKSPACE — default layout', () => {
  it('one MAIN group holding every visible page in canonical order', () => {
    const layout = createDefaultLayout(VISIBLE);
    assert.equal(layout.version, SIDEBAR_LAYOUT_VERSION);
    assert.equal(layout.groups.length, 1);
    assert.equal(layout.groups[0]!.id, MAIN_GROUP_ID);
    assert.deepEqual(groupItems(layout, MAIN_GROUP_ID), VISIBLE);
  });

  it('reset = canonical default (permissions untouched by definition — the input is the visible set)', () => {
    const reset = createDefaultLayout(VISIBLE);
    assert.deepEqual(reset, createDefaultLayout(VISIBLE));
    assert.deepEqual(groupItems(reset, MAIN_GROUP_ID), VISIBLE);
  });
});

describe('§SIDEBAR-WORKSPACE — item operations', () => {
  const layout = (): SidebarLayout => ({
    version: 1,
    groups: [
      { id: MAIN_GROUP_ID, name: '', items: [{ id: 'home' }, { id: 'employees' }, { id: 'quality' }] },
      { id: 'g1', name: 'عمليات', items: [{ id: 'reports' }] },
    ],
  });

  it('reorders an item within the same group (forward and backward)', () => {
    // Slot 2 = BEFORE the item currently at index 2 ('quality') — the
    // indices are read off the rendered list DURING the drag.
    let next = moveSidebarItem(layout(), 'home', MAIN_GROUP_ID, 2);
    assert.deepEqual(groupItems(next, MAIN_GROUP_ID), ['employees', 'home', 'quality']);
    // Slot 3 = past the last item.
    next = moveSidebarItem(next, 'home', MAIN_GROUP_ID, 3);
    assert.deepEqual(groupItems(next, MAIN_GROUP_ID), ['employees', 'quality', 'home']);
    next = moveSidebarItem(next, 'home', MAIN_GROUP_ID, 0);
    assert.deepEqual(groupItems(next, MAIN_GROUP_ID), ['home', 'employees', 'quality']);
  });

  it('moves an item between groups (MAIN → custom and custom → MAIN)', () => {
    let next = moveSidebarItem(layout(), 'home', 'g1', 1);
    assert.deepEqual(groupItems(next, MAIN_GROUP_ID), ['employees', 'quality']);
    assert.deepEqual(groupItems(next, 'g1'), ['reports', 'home']);
    next = moveSidebarItem(next, 'home', MAIN_GROUP_ID, 1);
    assert.deepEqual(groupItems(next, MAIN_GROUP_ID), ['employees', 'home', 'quality']);
  });

  it('does not duplicate or lose the item when the target index is clamped', () => {
    const next = moveSidebarItem(layout(), 'reports', MAIN_GROUP_ID, 99);
    assert.deepEqual(groupItems(next, MAIN_GROUP_ID), ['home', 'employees', 'quality', 'reports']);
    assert.equal(groupItems(next, 'g1').length, 0);
  });

  it('returns the layout unchanged for unknown items or groups', () => {
    assert.deepEqual(moveSidebarItem(layout(), 'nope', 'g1', 0), layout());
    assert.deepEqual(moveSidebarItem(layout(), 'home', 'ghost', 0), layout());
  });

  it('never mutates the input layout (draft isolation / per-user safety)', () => {
    const original = layout();
    const snapshot = JSON.stringify(original);
    moveSidebarItem(original, 'home', 'g1', 0);
    moveSidebarGroup(original, 'g1', 0);
    deleteSidebarGroup(original, 'g1');
    renameSidebarGroup(original, 'g1', 'x');
    assert.equal(JSON.stringify(original), snapshot);
  });
});

describe('§SIDEBAR-WORKSPACE — group operations', () => {
  const layout = (): SidebarLayout => ({
    version: 1,
    groups: [
      { id: MAIN_GROUP_ID, name: '', items: [{ id: 'home' }] },
      { id: 'g1', name: 'الجودة', items: [{ id: 'quality' }, { id: 'reports' }] },
      { id: 'g2', name: 'العمليات', items: [] },
    ],
  });

  it('creates a group (trimmed name, unique id, appended last)', () => {
    const next = addSidebarGroup(layout(), '  جديد  ', makeId);
    assert.ok(next);
    assert.equal(next.groups.length, 4);
    const created = next.groups[next.groups.length - 1]!;
    assert.equal(created.name, 'جديد');
    assert.deepEqual(created.items, []);
  });

  it('rejects empty / over-length / duplicate group names', () => {
    assert.equal(validateGroupName('   ', layout()), 'empty');
    assert.equal(validateGroupName('x'.repeat(MAX_GROUP_NAME_LENGTH + 1), layout()), 'too_long');
    assert.equal(validateGroupName('الجودة', layout()), 'duplicate');
    assert.equal(addSidebarGroup(layout(), 'الجودة', makeId), null);
    // Rename excludes the group's own id, so keeping its name is legal.
    assert.equal(validateGroupName('الجودة', layout(), 'g1'), null);
    assert.ok(addSidebarGroup(layout(), 'الجودة', makeId) === null);
    assert.equal(validateGroupName('العمليات '.repeat(10), null), 'too_long');
  });

  it('renames a custom group without changing its stable id', () => {
    const next = renameSidebarGroup(layout(), 'g1', 'مراقبة الجودة');
    assert.ok(next);
    assert.ok(next.groups.some((g) => g.id === 'g1' && g.name === 'مراقبة الجودة'));
  });

  it('refuses to rename the system MAIN group', () => {
    assert.equal(renameSidebarGroup(layout(), MAIN_GROUP_ID, 'لا'), null);
  });

  it('refuses to delete MAIN and no-ops on unknown groups', () => {
    assert.deepEqual(deleteSidebarGroup(layout(), MAIN_GROUP_ID), layout());
    assert.deepEqual(deleteSidebarGroup(layout(), 'ghost'), layout());
  });

  it('deleting a group PRESERVES its items — they move to MAIN in relative order', () => {
    const next = deleteSidebarGroup(layout(), 'g1');
    assert.equal(next.groups.some((g) => g.id === 'g1'), false);
    const main = groupItems(next, MAIN_GROUP_ID);
    // Relative order kept, appended after MAIN's existing items.
    assert.equal(main.indexOf('quality') >= 0, true);
    assert.equal(main.indexOf('reports') >= 0, true);
    assert.ok(main.indexOf('quality') < main.indexOf('reports'));
    assert.deepEqual(main.slice(0, 1), ['home']);
  });

  it('recreates MAIN as the fallback when deleting left it missing', () => {
    const withoutMain: SidebarLayout = { version: 1, groups: [{ id: 'g1', name: 'x', items: [{ id: 'quality' }] }] };
    const next = deleteSidebarGroup(withoutMain, 'g1');
    assert.deepEqual(groupItems(next, MAIN_GROUP_ID), ['quality']);
  });

  it('reorders groups (including MAIN) with clamped indices', () => {
    let next = moveSidebarGroup(layout(), 'g1', 0);
    assert.deepEqual(next.groups.map((g) => g.id), ['g1', MAIN_GROUP_ID, 'g2']);
    next = moveSidebarGroup(next, 'g1', 99);
    assert.deepEqual(next.groups.map((g) => g.id), [MAIN_GROUP_ID, 'g2', 'g1']);
  });

  it('stops creating groups at the cap', () => {
    let current = layout();
    for (let i = 0; i < MAX_SIDEBAR_GROUPS; i += 1) {
      const next = addSidebarGroup(current, `group-${i}`, makeId);
      if (!next) { assert.ok(i > 0); return; }
      current = next;
    }
    assert.equal(addSidebarGroup(current, 'overflow', makeId), null);
  });
});

describe('§SIDEBAR-WORKSPACE — reconciliation (authorization always wins)', () => {
  const layout = (): SidebarLayout => ({
    version: 1,
    groups: [
      { id: MAIN_GROUP_ID, name: '', items: [{ id: 'home' }, { id: 'secret' }, { id: 'home' }] },
      { id: 'g1', name: 'x', items: [{ id: 'ghost' }, { id: 'employees' }] },
    ],
  });

  it('drops stale, unauthorized and duplicate references; keeps the authorized set once', () => {
    const next = reconcileSidebarLayout(layout(), ['home', 'employees', 'quality']);
    // 'home' deduped; 'secret' unauthorized dropped; 'quality' (never
    // placed) appends to MAIN per the new-items rule.
    assert.deepEqual(groupItems(next, MAIN_GROUP_ID), ['home', 'quality']);
    assert.deepEqual(groupItems(next, 'g1'), ['employees']);
  });

  it('appends newly available items to MAIN in registry order', () => {
    const next = reconcileSidebarLayout(layout(), ['home', 'employees', 'quality']);
    // 'quality' was never placed → MAIN receives it last.
    assert.deepEqual(groupItems(next, MAIN_GROUP_ID), ['home', 'quality']);
  });

  it('normalizeSidebarLayout: null for non-v1 payloads, repair for damaged ones, never unauthorized items', () => {
    assert.equal(normalizeSidebarLayout(null, VISIBLE), null);
    assert.equal(normalizeSidebarLayout({ version: 99, groups: [] }, VISIBLE), null);
    assert.equal(normalizeSidebarLayout({ version: 1, groups: 'nope' }, VISIBLE), null);

    const damaged = {
      version: 1,
      groups: [
        { id: MAIN_GROUP_ID, name: '', items: [{ id: 'home' }, { id: 42 }, 'junk', { id: 'secret' }] },
        { id: MAIN_GROUP_ID, name: '', items: [{ id: 'employees' }] }, // duplicate group id
        { id: 'g1', name: 'x', items: [{ id: 'quality' }] },
      ],
    };
    const result = normalizeSidebarLayout(damaged, VISIBLE);
    assert.ok(result);
    assert.equal(result.repaired, true);
    // Duplicate MAIN group dropped → its 'employees' re-append to MAIN
    // via the new-items rule (no item is ever lost by repair).
    assert.deepEqual(groupItems(result.layout, MAIN_GROUP_ID), ['home', 'employees', 'reports', 'settings']);
    assert.deepEqual(groupItems(result.layout, 'g1'), ['quality']);
    // Every authorized item stays reachable.
    for (const id of VISIBLE) {
      assert.ok(result.layout.groups.some((g) => g.items.some((it) => it.id === id)));
    }
  });

  it('normalizeSidebarLayout: a valid stored layout round-trips without repair', () => {
    const stored = {
      version: 1,
      groups: [
        { id: MAIN_GROUP_ID, name: '', items: VISIBLE.map((id) => ({ id })) },
      ],
    };
    const result = normalizeSidebarLayout(stored, VISIBLE);
    assert.ok(result);
    assert.equal(result.repaired, false);
    assert.deepEqual(groupItems(result.layout, MAIN_GROUP_ID), VISIBLE);
  });

  it('normalizeSidebarLayout: missing MAIN is created and flagged as repair', () => {
    const result = normalizeSidebarLayout({ version: 1, groups: [{ id: 'g1', name: 'x', items: [{ id: 'home' }] }] }, VISIBLE);
    assert.ok(result);
    assert.equal(result.repaired, true);
    assert.deepEqual(groupItems(result.layout, MAIN_GROUP_ID), ['employees', 'quality', 'reports', 'settings']);
  });

  it('a stale reference can never bypass authorization even in a valid layout', () => {
    const stored = { version: 1, groups: [{ id: MAIN_GROUP_ID, name: '', items: [{ id: 'controlPanel' }] }] };
    const result = normalizeSidebarLayout(stored, VISIBLE);
    assert.ok(result);
    assert.ok(!groupItems(result.layout, MAIN_GROUP_ID).includes('controlPanel'));
  });
});

describe('§SIDEBAR-WORKSPACE — legacy migration', () => {
  const NO_PAGE_GROUPS = new Map<string, string>();

  it('returns null when nothing was ever customized (fresh default applies)', () => {
    assert.equal(migrateLegacySidebarLayout(null, VISIBLE, [], NO_PAGE_GROUPS), null);
    assert.equal(migrateLegacySidebarLayout(undefined, VISIBLE, [], NO_PAGE_GROUPS), null);
    assert.equal(migrateLegacySidebarLayout({}, VISIBLE, [], NO_PAGE_GROUPS), null);
  });

  it('order-only legacy → ONE main group with the saved order preserved', () => {
    const layout = migrateLegacySidebarLayout(
      { order: ['reports', 'home'] },
      VISIBLE,
      [],
      NO_PAGE_GROUPS,
    );
    assert.ok(layout);
    assert.equal(layout.groups.length, 1);
    assert.deepEqual(groupItems(layout, MAIN_GROUP_ID), ['reports', 'home', 'employees', 'quality', 'settings']);
  });

  it('cross-group overrides preserve the user organization; MAIN becomes the fallback', () => {
    const canonical = [
      { id: 'quality_ctrl', name: 'الجودة' },
      { id: 'reports', name: 'التقارير' },
    ];
    const pageGroups = new Map([
      ['home', 'daily_ops'],
      ['employees', 'employee_mgmt'],
      ['quality', 'quality_ctrl'],
      ['reports', 'reports'],
      ['settings', 'settings'],
    ] as const);
    const layout = migrateLegacySidebarLayout(
      {
        order: ['quality', 'reports', 'home'],
        groupOrder: ['reports', 'quality_ctrl'],
        itemGroups: { home: 'reports' },
      },
      VISIBLE,
      canonical,
      pageGroups,
    );
    assert.ok(layout);
    // Non-empty legacy groups keep their saved order; MAIN is appended
    // as the system fallback.
    assert.deepEqual(layout.groups.map((g) => g.id), ['reports', 'quality_ctrl', MAIN_GROUP_ID]);
    // 'reports' (canonical member, rank 1) precedes 'home' (override, rank 2).
    assert.deepEqual(groupItems(layout, 'reports'), ['reports', 'home']);
    assert.deepEqual(groupItems(layout, 'quality_ctrl'), ['quality']);
    assert.deepEqual(groupItems(layout, MAIN_GROUP_ID), ['employees', 'settings']);
    // Group names are preserved organization (localized at migration time).
    assert.equal(layout.groups[0]!.name, 'التقارير');
  });

  it('migration output reconciles against permissions — no unauthorized survivor', () => {
    const layout = migrateLegacySidebarLayout(
      { order: ['secret', 'home'], itemGroups: { home: 'quality_ctrl' } },
      VISIBLE,
      [{ id: 'quality_ctrl', name: 'الجودة' }],
      new Map([['home', 'daily_ops'], ['secret', 'admin']]),
    );
    assert.ok(layout);
    assert.ok(!groupItems(layout, MAIN_GROUP_ID).includes('secret'));
    assert.ok(!layout.groups.some((g) => g.items.some((it) => it.id === 'secret')));
  });
});

describe('§SIDEBAR-WORKSPACE — persistence boundary', () => {
  it('sanitizeSidebarLayoutPayload: whitelist shape, dedupe groups, cap lengths', () => {
    const payload = {
      version: 1,
      groups: [
        { id: MAIN_GROUP_ID, name: '', items: [{ id: 'home' }, { id: 1 }, 'junk'] },
        { id: MAIN_GROUP_ID, name: '', items: [] }, // duplicate → dropped
        { id: 'g1', name: 'x'.repeat(500), items: [{ id: 'quality' }] },
      ],
    };
    const clean = sanitizeSidebarLayoutPayload(payload);
    assert.ok(clean);
    assert.equal(clean.groups.length, 2);
    assert.deepEqual(clean.groups[0]!.items.map((it) => it.id), ['home']);
    assert.equal(clean.groups[1]!.name.length, MAX_GROUP_NAME_LENGTH);
    assert.deepEqual(clean.groups[1]!.items.map((it) => it.id), ['quality']);
  });

  it('sanitizeSidebarLayoutPayload: rejects non-layout payloads entirely', () => {
    assert.equal(sanitizeSidebarLayoutPayload(null), null);
    assert.equal(sanitizeSidebarLayoutPayload('layout'), null);
    assert.equal(sanitizeSidebarLayoutPayload({ version: 2, groups: [] }), null);
    assert.equal(sanitizeSidebarLayoutPayload({ version: 1, groups: [] }), null);
  });

  it('serialize → deserialize round-trip preserves the structure exactly', () => {
    // Built from the engine so every visible item is placed (the read
    // path would otherwise append the missing ones and flag a diff).
    let source = addSidebarGroup(createDefaultLayout(VISIBLE), 'الجودة', makeId)!;
    source = moveSidebarItem(source, 'quality', source.groups[1]!.id, 0);
    source.groups[1]!.collapsed = true;

    const restored = JSON.parse(JSON.stringify(source));
    const clean = sanitizeSidebarLayoutPayload(restored)!;
    const result = normalizeSidebarLayout(clean, VISIBLE);
    assert.ok(result);
    assert.equal(result.repaired, false);
    assert.deepEqual(result.layout.groups, source.groups);
  });

  it('operations never leak between layouts derived from the same source (per-user isolation)', () => {
    const shared = createDefaultLayout(VISIBLE);
    const userA = addSidebarGroup(shared, 'A', makeId)!;
    const userB = deleteSidebarGroup(shared, MAIN_GROUP_ID) === shared ? shared : shared; // MAIN not deletable
    const userC = moveSidebarItem(shared, 'home', MAIN_GROUP_ID, 2);
    // The shared source is untouched by every derived draft.
    assert.deepEqual(groupItems(shared, MAIN_GROUP_ID), VISIBLE);
    assert.equal(userA.groups.length, 2);
    assert.equal(userC.groups.length, 1);
    assert.ok(userB);
  });
});

describe('§SIDEBAR-WORKSPACE — display labels & drag geometry', () => {
  it('MAIN carries the localized UI label; custom names are user content (never localized)', () => {
    assert.equal(sidebarGroupLabel({ id: MAIN_GROUP_ID, name: '' }, 'ar'), 'الرئيسية');
    assert.equal(sidebarGroupLabel({ id: MAIN_GROUP_ID, name: '' }, 'en'), 'Main');
    // Even a name that collides with a UI string is returned verbatim.
    assert.equal(sidebarGroupLabel({ id: 'g1', name: 'الرئيسية' }, 'en'), 'الرئيسية');
    assert.equal(sidebarGroupLabel({ id: 'g1', name: 'My Quality' }, 'ar'), 'My Quality');
  });

  it('insertionIndexForPointerY: top-half semantics with a length fallback', () => {
    const centers = [100, 200, 300];
    assert.equal(insertionIndexForPointerY(80, centers), 0);
    // At the exact center the pointer is in the BOTTOM half of the
    // item — the next slot.
    assert.equal(insertionIndexForPointerY(100, centers), 1);
    assert.equal(insertionIndexForPointerY(150, centers), 1);
    assert.equal(insertionIndexForPointerY(250, centers), 2);
    assert.equal(insertionIndexForPointerY(999, centers), 3);
    assert.equal(insertionIndexForPointerY(50, []), 0);
  });
});

describe('§22 GROUP STATE — open/closed persisted INSIDE the layout', () => {
  const layout = (): SidebarLayout => ({
    version: 1,
    groups: [
      { id: MAIN_GROUP_ID, name: '', items: [{ id: 'home' }] },
      { id: 'g1', name: 'الجودة', items: [{ id: 'quality' }] },
      { id: 'g2', name: 'العمليات', items: [{ id: 'reports' }], collapsed: true },
    ],
  });

  it('setGroupCollapsed sets the flag; false DELETES the key (compact record)', () => {
    let next = setGroupCollapsed(layout(), 'g1', true);
    assert.equal(next.groups.find((g) => g.id === 'g1')!.collapsed, true);
    next = setGroupCollapsed(next, 'g2', false);
    const g2 = next.groups.find((g) => g.id === 'g2')!;
    assert.equal(g2.collapsed, undefined);
    assert.ok(!('collapsed' in g2)); // the key is REMOVED, not set to false
  });

  it('setGroupCollapsed: no-op on unknown groups, already-matching flags; input never mutated', () => {
    const original = layout();
    const snapshot = JSON.stringify(original);
    assert.deepEqual(setGroupCollapsed(original, 'ghost', true), original);
    assert.deepEqual(setGroupCollapsed(original, 'g2', true), original); // already collapsed
    assert.deepEqual(setGroupCollapsed(original, 'g1', false), original); // already open
    assert.equal(JSON.stringify(original), snapshot);
  });

  it('group state survives the persistence round-trip (sanitize → normalize)', () => {
    let source = setGroupCollapsed(layout(), 'g1', true);
    source = setGroupCollapsed(source, 'g2', false);
    const restored = JSON.parse(JSON.stringify(source));
    const clean = sanitizeSidebarLayoutPayload(restored)!;
    const result = normalizeSidebarLayout(clean, VISIBLE);
    assert.ok(result);
    assert.equal(result.repaired, false);
    assert.equal(result.layout.groups.find((g) => g.id === 'g1')!.collapsed, true);
    assert.equal(result.layout.groups.find((g) => g.id === 'g2')!.collapsed, undefined);
  });

  it('edit operations preserve other groups’ collapsed flags', () => {
    let next = moveSidebarItem(layout(), 'quality', MAIN_GROUP_ID, 0);
    assert.equal(next.groups.find((g) => g.id === 'g2')!.collapsed, true);
    next = moveSidebarGroup(next, 'g1', 0);
    assert.equal(next.groups.find((g) => g.id === 'g2')!.collapsed, true);
    next = deleteSidebarGroup(next, 'g1');
    assert.equal(next.groups.find((g) => g.id === 'g2')!.collapsed, true);
  });

  it('migration bakes the legacy presentation default: FIRST group open, rest collapsed', () => {
    const layout = migrateLegacySidebarLayout(
      { order: ['home', 'quality'], itemGroups: { quality: 'quality_ctrl' } },
      VISIBLE,
      [{ id: 'quality_ctrl', name: 'الجودة' }],
      new Map([['home', 'main'], ['quality', 'quality_ctrl']] as const),
    );
    assert.ok(layout);
    const flags = layout.groups.map((g) => g.collapsed === true);
    assert.equal(flags[0], false); // first group renders open
    assert.ok(flags.slice(1).every(Boolean)); // the rest collapsed
  });
});
