// ══════════════════════════════════════════════════════════════
//  Permission visibility — Phase 1 hardening (Objective A)
//
//  Verifies the page-visibility integration:
//    • Role presets match the required Quality KPI visibility matrix
//    • resolveEffectivePermissions (the SINGLE rule shared by client
//      AuthContext, server verifyPermission and the Control Panel
//      editor) resolves stored maps that predate the KPI pages
//    • Sidebar-visible derivation (mirror of usePermissions.visiblePages)
//      hides restricted pages and keeps unrelated pages intact
// ══════════════════════════════════════════════════════════════

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_PAGES,
  QUALITY_PERMISSIONS,
  HR_PERMISSIONS,
  MANAGER_PERMISSIONS,
  ADMIN_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  getPermissionsForRole,
  resolveEffectivePermissions,
  migratePermission,
  type PermissionsMap,
} from '@/config/permissions';

/** The Quality KPI pages added in Phase 1 (task scope). */
const KPI_PAGE_KEYS = [
  'observations',
  'observationCategories',
  'observationTemplates',
  'kpiDashboard',
  'qualityAuditLog',
  'monthClose',
  'kpiSettings',
] as const;

/** Mirror of usePermissions().visiblePages — the sidebar visibility rule. */
function visiblePageKeys(role: string, stored?: PermissionsMap | null): string[] {
  const effective = stored
    ? resolveEffectivePermissions(role, stored)
    : getPermissionsForRole(role);
  return APP_PAGES.filter((p) => {
    if (p.overlayOnly) return false;
    return migratePermission(effective[p.permissionKey] as never).level !== 'none';
  }).map((p) => p.id);
}

function hasPage(keys: string[], page: string): boolean {
  return keys.includes(page);
}

// ─── Role matrix ──────────────────────────────────────────────

test('Quality role — sees observation pages, NOT KPI settings / month close', () => {
  const visible = visiblePageKeys('quality');
  assert.ok(hasPage(visible, 'observations'), 'quality sees observations');
  assert.ok(hasPage(visible, 'kpiDashboard'), 'quality sees kpiDashboard');
  assert.ok(!hasPage(visible, 'kpiSettings'), 'quality must NOT see kpiSettings');
  assert.ok(!hasPage(visible, 'monthClose'), 'quality must NOT see monthClose');
  // Category administration is manager/admin territory: quality gets read
  // only (overlayOnly page — never in the sidebar) and no management actions.
  const catPerm = migratePermission(QUALITY_PERMISSIONS.observationCategories as never);
  assert.equal(catPerm.level, 'read');
  // No approval authority for the quality role.
  const obsPerm = migratePermission(QUALITY_PERMISSIONS.observations as never);
  assert.equal(obsPerm.level === 'edit' ? obsPerm.actions?.approve : undefined, undefined,
    'quality has no approve action');
});

test('HR role — read-only KPI dashboard only, no management pages', () => {
  const visible = visiblePageKeys('hr');
  assert.ok(hasPage(visible, 'kpiDashboard'), 'HR sees kpiDashboard (read-only)');
  assert.ok(!hasPage(visible, 'observations'), 'HR must NOT see observations');
  assert.ok(!hasPage(visible, 'qualityAuditLog'), 'HR must NOT see qualityAuditLog');
  assert.ok(!hasPage(visible, 'monthClose'), 'HR must NOT see monthClose');
  assert.ok(!hasPage(visible, 'kpiSettings'), 'HR must NOT see kpiSettings');
});

test('Manager role — sees Quality KPI management pages', () => {
  const visible = visiblePageKeys('manager');
  assert.ok(hasPage(visible, 'observations'));
  assert.ok(hasPage(visible, 'kpiDashboard'));
  assert.ok(hasPage(visible, 'qualityAuditLog'));
  assert.ok(hasPage(visible, 'monthClose'), 'manager closes/reopens months');
  assert.ok(hasPage(visible, 'kpiSettings'));
});

test('Admin role — sees all Quality KPI pages', () => {
  const visible = visiblePageKeys('admin');
  for (const key of KPI_PAGE_KEYS) {
    if (key === 'observationCategories' || key === 'observationTemplates') continue; // overlayOnly
    assert.ok(hasPage(visible, key), `admin sees ${key}`);
  }
});

test('Default (generic user) role — sees NONE of the Quality KPI management pages', () => {
  const visible = visiblePageKeys('user');
  for (const key of KPI_PAGE_KEYS) {
    assert.ok(!hasPage(visible, key), `generic user must NOT see ${key}`);
  }
});

// ─── Effective-permission resolution (the integration fix) ────

test('stored map predating the KPI pages falls back to the role preset', () => {
  // A quality user created before Phase 1 — stored map has old keys only.
  const stored: PermissionsMap = {
    home: 'read',
    quality: { level: 'edit', actions: { create: true } },
    // No KPI page keys at all.
  };
  const effective = resolveEffectivePermissions('quality', stored);
  // Restricted pages inherit the role's restriction (NOT a permissive default).
  assert.equal(migratePermission(effective.kpiSettings as never).level, 'none');
  assert.equal(migratePermission(effective.monthClose as never).level, 'none');
  // Allowed pages inherit the role grant — server and client now agree.
  assert.equal(migratePermission(effective.observations as never).level, 'edit');
  assert.equal(migratePermission(effective.kpiDashboard as never).level, 'read');
});

test('explicit stored overrides beat the role preset (grant AND restriction)', () => {
  const stored: PermissionsMap = { kpiDashboard: 'none' }; // admin-restricted
  const hrEffective = resolveEffectivePermissions('hr', stored);
  assert.equal(migratePermission(hrEffective.kpiDashboard as never).level, 'none',
    "stored 'none' overrides the HR preset grant");

  const storedGrant: PermissionsMap = { qualityAuditLog: 'read' }; // admin grant
  const hrEffective2 = resolveEffectivePermissions('hr', storedGrant);
  assert.equal(migratePermission(hrEffective2.qualityAuditLog as never).level, 'read',
    "stored grant overrides the HR preset restriction");
});

test('missing/invalid stored map resolves to the pure role preset', () => {
  assert.deepEqual(
    resolveEffectivePermissions('quality', null),
    getPermissionsForRole('quality'),
  );
  assert.deepEqual(
    resolveEffectivePermissions(undefined, undefined),
    getPermissionsForRole('user'),
  );
});

// ─── Unrelated pages stay visible (no accidental hiding) ──────

test('unrelated pages remain visible exactly as before', () => {
  // Quality keeps its existing pages.
  const q = visiblePageKeys('quality');
  assert.ok(hasPage(q, 'quality'));
  assert.ok(hasPage(q, 'capa'));
  assert.ok(hasPage(q, 'followUps'));
  // HR keeps employee management.
  const hr = visiblePageKeys('hr');
  assert.ok(hasPage(hr, 'employees'));
  assert.ok(hasPage(hr, 'attendance'));
  assert.ok(hasPage(hr, 'hrDeductions'));
  // Generic users keep their existing read-only pages.
  const user = visiblePageKeys('user');
  assert.ok(hasPage(user, 'capa'));
  assert.ok(hasPage(user, 'complaints'));
  assert.ok(hasPage(user, 'home'));
});

test('overlayOnly pages never appear in the sidebar for any role', () => {
  for (const role of ['admin', 'manager', 'quality', 'hr', 'user']) {
    const visible = visiblePageKeys(role);
    assert.ok(!hasPage(visible, 'employee360'), `${role} sidebar hides employee360 overlay`);
    assert.ok(!hasPage(visible, 'observationCategories'), `${role} sidebar hides categories overlay`);
    assert.ok(!hasPage(visible, 'observationTemplates'), `${role} sidebar hides templates overlay`);
  }
});
