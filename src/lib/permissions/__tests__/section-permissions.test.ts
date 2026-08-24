// ══════════════════════════════════════════════════════════════
//  Milestone 10 — Section permissions, page scope carrier, safe
//  defaults, and explainable authorization.
//
//  Covers:
//    • section access: page gate → override → inherited level
//    • a restricted section never hides the whole page
//    • scope rides on PagePermission + migrate round-trip
//      (invalid scopes dropped, fail-safe to 'all')
//    • resolvePageScope default 'all' (engine inert until
//      configured) + admin bypass
//    • safe defaults: the new organization page is admin-only in
//      every non-admin preset
//    • explainPageAccess: tier trace + winner + admin bypass
//    • diffPermissionMaps: added / removed / changed
//
//  Run: npx tsx --test src/lib/permissions/__tests__/section-permissions.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  migratePermission, resolveSectionAccess, resolvePageScope, explainPageAccess,
  diffPermissionMaps, PAGE_SECTIONS, getPermissionsForRole, APP_PAGES,
  resolveEffectivePermissions, FAIL_CLOSED_SCOPE, type PermissionsMap,
} from '@/config/permissions';

describe('section permissions — resolution rule', () => {
  const map: PermissionsMap = {
    employee360: {
      level: 'read',
      sections: { hrDeductions: 'none', timeline: 'edit' },
    },
  };

  it('page level none hides EVERY section (page gate wins)', () => {
    const denied: PermissionsMap = { employee360: { level: 'none', sections: { basicInfo: 'edit' } } };
    assert.equal(resolveSectionAccess(denied, 'employee360', 'basicInfo'), 'none');
  });

  it('explicit section override replaces inheritance in both directions', () => {
    assert.equal(resolveSectionAccess(map, 'employee360', 'hrDeductions'), 'none');
    assert.equal(resolveSectionAccess(map, 'employee360', 'timeline'), 'edit');
  });

  it('sections without an override inherit the page level', () => {
    assert.equal(resolveSectionAccess(map, 'employee360', 'attendance'), 'read');
    assert.equal(resolveSectionAccess(map, 'employee360', 'basicInfo'), 'read');
  });

  it('restricting a section does NOT restrict the page', () => {
    // The core requirement: section-level restriction while the page stays readable
    assert.equal(migratePermission(map.employee360).level, 'read');
    assert.equal(resolveSectionAccess(map, 'employee360', 'hrDeductions'), 'none');
  });

  it('invalid section override values are ignored (inherit instead)', () => {
    const junk: PermissionsMap = { employee360: { level: 'read', sections: { attendance: 'superuser' as never } } };
    assert.equal(resolveSectionAccess(junk, 'employee360', 'attendance'), 'read');
  });

  it('missing page entry fails closed', () => {
    assert.equal(resolveSectionAccess({}, 'employee360', 'basicInfo'), 'none');
    assert.equal(resolveSectionAccess(null, 'employee360', 'basicInfo'), 'none');
  });

  it('the registry documents stable Employee 360 section ids (foundation)', () => {
    const ids = PAGE_SECTIONS.employee360?.map((s) => s.id);
    assert.ok(ids?.includes('basicInfo'));
    assert.ok(ids?.includes('hrDeductions'));
    assert.ok(ids?.includes('timeline'));
  });
});

describe('data scope — permission carrier', () => {
  it('migratePermission preserves a valid scope through the round-trip', () => {
    const perm = { level: 'read' as const, scope: 'team' as const };
    assert.equal(migratePermission(perm).scope, 'team');
  });

  it('an INVALID scope is dropped (fail-safe to the all default)', () => {
    const perm = { level: 'read' as const, scope: 'galaxy' as never };
    assert.equal(migratePermission(perm).scope, undefined);
  });

  it('legacy string entries keep working — M0.3: unscoped non-admin entries now FAIL CLOSED to own', () => {
    // Superseded expectation: this used to resolve 'all' (inert
    // engine). M0.3 DEFAULT SCOPE SAFETY: a non-admin scope that
    // cannot be resolved is never silently 'all'.
    assert.equal(migratePermission('read').scope, undefined);
    assert.equal(resolvePageScope({ p: 'read' }, 'p'), FAIL_CLOSED_SCOPE);
  });

  it('resolvePageScope: configured scope wins; admin always all', () => {
    const map: PermissionsMap = { employees: { level: 'read', scope: 'department' } };
    assert.equal(resolvePageScope(map, 'employees'), 'department');
    assert.equal(resolvePageScope(map, 'employees', 'admin'), 'all');
    assert.equal(resolvePageScope(getPermissionsForRole('quality'), 'employees', 'quality'), 'all');
  });

  it('M0.3 activation: preset scopes exist ONLY on the employees page; every other page stays unscoped', () => {
    // Superseded expectation: "NO preset configures a scope" held
    // while the engine was inert. M0.3 activates it with
    // evidence-based scopes on employees only (see
    // m03-organization-data-scope.test.ts for the full matrix).
    assert.equal(migratePermission(getPermissionsForRole('hr').employees).scope, 'all');
    assert.equal(migratePermission(getPermissionsForRole('manager').employees).scope, 'subtree');
    assert.equal(migratePermission(getPermissionsForRole('quality').employees).scope, 'all');
    assert.equal(migratePermission(getPermissionsForRole('user').employees).scope, undefined); // fail-closed
    for (const role of ['admin', 'hr', 'manager', 'quality', 'user']) {
      const preset = getPermissionsForRole(role);
      for (const [key, entry] of Object.entries(preset)) {
        if (key === 'employees') continue;
        if (typeof entry === 'object') {
          assert.equal(entry.scope, undefined, `${role}.${key} must not pre-configure scopes`);
        }
      }
    }
  });
});

describe('safe defaults — new organization page', () => {
  it('exists in the registry under the settings group', () => {
    const page = APP_PAGES.find((p) => p.id === 'organization');
    assert.ok(page);
    assert.equal(page!.permissionKey, 'organization');
    assert.equal(page!.groupId, 'settings');
  });

  it('is granted ONLY to the admin preset (fail-closed for everyone else)', () => {
    assert.notEqual(migratePermission(getPermissionsForRole('admin').organization).level, 'none');
    for (const role of ['hr', 'manager', 'quality', 'user']) {
      assert.equal(
        migratePermission(getPermissionsForRole(role).organization).level, 'none',
        `${role} must default to organization: none`,
      );
    }
  });

  it('users whose stored map predates the page also inherit the safe default', () => {
    // resolveEffectivePermissions: missing stored key → preset fallback
    const legacyStored: PermissionsMap = { home: 'read', employees: 'read' }; // map saved BEFORE the page existed
    const merged: PermissionsMap = { ...getPermissionsForRole('quality'), ...legacyStored };
    assert.equal(migratePermission(merged.organization).level, 'none');
  });
});

describe('explainable authorization — explainPageAccess', () => {
  it('admin bypass produces a full-access explanation', () => {
    const e = explainPageAccess('admin', null, 'employees');
    assert.equal(e.isAdminBypass, true);
    assert.equal(e.level, 'edit');
    assert.equal(e.scope, 'all');
    assert.equal(e.winner, 'admin');
  });

  it('traces role → position → stored tiers with the correct winner', () => {
    const stored = { kpiSettings: 'none' };
    const template = { kpiSettings: { level: 'edit' } };
    const e = explainPageAccess('quality', stored, 'kpiSettings', template);
    assert.equal(e.level, 'none');
    assert.equal(e.winner, 'stored');
    // All three tiers carry an explicit entry — the conflict detector
    // surfaces every disagreeing source (role none / position edit /
    // stored none) with the final decision.
    assert.equal(e.sources.length, 3);
    assert.ok(e.sources.some((s) => s.source === 'role' && s.level === 'none'));
    assert.ok(e.sources.some((s) => s.source === 'position' && s.level === 'edit'));
    assert.ok(e.sources.some((s) => s.source === 'stored' && s.level === 'none'));
  });

  it('denied page with no granting tier explains the default deny', () => {
    const e = explainPageAccess('quality', null, 'controlPanel');
    assert.equal(e.level, 'none');
    assert.equal(e.winner === 'role' || e.winner === 'default-deny', true);
  });

  it('explanation matches the actual resolver output (no divergence)', () => {
    const cases: Array<[string, Record<string, unknown> | null, string, Record<string, unknown> | null]> = [
      ['quality', null, 'observations', null],
      ['quality', { observations: 'none' }, 'observations', null],
      ['hr', null, 'kpiDashboard', null],
      ['manager', null, 'kpiSettings', { kpiSettings: 'read' }],
    ];
    for (const [role, stored, pageKey, template] of cases) {
      const e = explainPageAccess(role, stored, pageKey, template);
      // effective resolution through the real resolver
      const effective = resolveEffectivePermissions(role, stored, template);
      assert.equal(e.level, migratePermission(effective[pageKey]).level, `${role}/${pageKey}`);
    }
  });
});

describe('permission change preview — diffPermissionMaps', () => {
  it('classifies added / removed / changed entries and skips unchanged ones', () => {
    const before: PermissionsMap = { a: 'read', b: 'edit', c: 'none', d: 'read' };
    const after: PermissionsMap = { a: 'edit', b: 'none', c: 'none', d: 'read', e: 'read' };
    const diff = diffPermissionMaps(before, after);
    assert.deepEqual(
      diff.map((d) => `${d.pageKey}:${d.change}`).sort(),
      ['a:changed', 'b:removed', 'e:added'],
    );
  });

  it('empty diff for identical maps; handles null maps', () => {
    assert.equal(diffPermissionMaps({}, {}).length, 0);
    assert.equal(diffPermissionMaps(null, null).length, 0);
    const fromNothing = diffPermissionMaps(null, { x: 'read' });
    assert.deepEqual(fromNothing.map((d) => d.change), ['added']);
  });
});
