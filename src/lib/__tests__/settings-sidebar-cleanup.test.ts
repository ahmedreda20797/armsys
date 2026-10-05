// ══════════════════════════════════════════════════════════════
//  §SETTINGS-CENTER — GLOBAL SIDEBAR CLEANUP contract.
//
//  Settings-internal CONFIGURATION sections must not appear as
//  duplicate global-sidebar destinations; every REAL operational
//  page stays. The mechanism is the canonical overlayOnly flag:
//  the page, its permission key, its route and its API identity are
//  fully intact — only the duplicate sidebar entry is gone, and
//  removing an entry never widens or narrows authorization.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { APP_PAGES, SIDEBAR_GROUPS, migratePermission, resolveEffectivePermissions, HR_PERMISSIONS, MANAGER_PERMISSIONS, QUALITY_PERMISSIONS, DEFAULT_PERMISSIONS } from '@/config/permissions';

function sidebarVisiblePages(): Set<string> {
  // The sidebar universe = APP_PAGES minus overlayOnly (the exact
  // rule usePermissions.visiblePages applies — mirrored here pure).
  return new Set(APP_PAGES.filter((p) => !p.overlayOnly).map((p) => p.id));
}

describe('§SIDEBAR-CLEANUP — Settings-only sections leave the global sidebar', () => {
  it('the four configuration sections are overlayOnly', () => {
    for (const id of ['kpiSettings', 'rules', 'monthClose', 'rulesEngine']) {
      const page = APP_PAGES.find((p) => p.id === id);
      assert.ok(page, `${id} is still a registered page`);
      assert.equal(page.overlayOnly, true, `${id} must be overlayOnly`);
      assert.equal(page.permissionKey, id, `${id} keeps its canonical permission key`);
    }
  });

  it('they are ABSENT from the sidebar universe', () => {
    const visible = sidebarVisiblePages();
    for (const id of ['kpiSettings', 'rules', 'monthClose', 'rulesEngine']) {
      assert.equal(visible.has(id), false, `${id} must not be a sidebar destination`);
    }
  });

  it('the real global pages REMAIN unchanged', () => {
    const visible = sidebarVisiblePages();
    for (const id of [
      'home', 'operationsCenter', 'followUps', 'employees', 'attendance', 'requests',
      'quality', 'capa', 'riskCenter', 'complaints', 'observations', 'kpiDashboard',
      'kpiReports', 'qualityAuditLog', 'hrDeductions', 'travel', 'reports', 'knowledgeBase',
      'controlPanel', 'settings', 'organization', 'workflowDesigner',
    ]) {
      assert.equal(visible.has(id), true, `${id} must remain a global destination`);
    }
  });

  it('the Settings Center itself remains the canonical entry', () => {
    const visible = sidebarVisiblePages();
    assert.equal(visible.has('settings'), true);
    const group = SIDEBAR_GROUPS.find((g) => g.id === 'settings');
    assert.ok(group, 'the settings group remains registered');
  });

  it('sidebar removal never changes authorization', () => {
    // Every removed page keeps its EXACT permission entry: the manager
    // preset still holds its grants, the denying presets still deny.
    const level = (role: string, key: string) =>
      migratePermission(resolveEffectivePermissions(role, null)[key]).level;
    assert.equal(level('manager', 'kpiSettings'), 'edit');
    assert.equal(level('manager', 'monthClose'), 'edit');
    assert.equal(level('manager', 'rules'), 'none'); // preset denied before and after
    assert.equal(level('manager', 'rulesEngine'), 'none');
    assert.equal(level('admin', 'rules'), 'edit'); // admin bypass intact
  });
});

describe('§SIDEBAR-CLEANUP — the masterData permission identity', () => {
  it('is a registered overlayOnly page with the canonical action vocabulary', () => {
    const page = APP_PAGES.find((p) => p.id === 'masterData');
    assert.ok(page, 'masterData registered');
    assert.equal(page.overlayOnly, true, 'never a sidebar destination');
    assert.equal(page.permissionKey, 'masterData');
    assert.deepEqual([...page.availableActions].sort(), ['create', 'delete', 'update']);
  });

  it('follows the reference-domain grant model across presets', () => {
    const level = (role: string) =>
      migratePermission(resolveEffectivePermissions(role, null)['masterData']).level;
    const actions = (role: string) =>
      migratePermission(resolveEffectivePermissions(role, null)['masterData']).actions;
    assert.equal(level('admin'), 'edit');
    assert.equal(level('manager'), 'edit');
    assert.equal(actions('manager')?.create, true);
    assert.equal(actions('manager')?.update, true);
    assert.equal(actions('manager')?.delete, true);
    // Safe defaults for every other preset (delegable via overrides).
    assert.equal(level('hr'), 'none');
    assert.equal(level('user'), 'none');
    assert.equal(level('quality'), 'read');
  });
});

describe('§SIDEBAR-CLEANUP — SettingsPage uses the canonical gates', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/pages/SettingsPage.tsx'), 'utf8');

  it('sections gate by canViewPage (never by sidebar visibility)', () => {
    assert.ok(source.includes('canViewPage(id)'), 'permission-based section gate');
    assert.ok(!source.includes('visiblePageIds.has(id)'), 'no sidebar-visibility gate');
  });
});

describe('§PERMISSION-MANAGER — the user list owns its internal scroll', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/permissions/PermissionManagerConsole.tsx'), 'utf8');

  it('the list is ONE bounded container (max-height + overflow on the same element)', () => {
    assert.match(source, /arm-scroll max-h-\[58vh\][^"]*rounded-xl/, 'arm-scroll + max-height + rounding');
    assert.match(source, /overscroll-contain/, 'scroll containment keeps the page still');
  });

  it('no percentage-height Radix viewport remains in the user list', () => {
    assert.ok(!source.includes('<ScrollArea'), 'Radix ScrollArea removed from the list column');
    assert.ok(!source.includes("from '@/components/ui/scroll-area'"), 'the import is gone');
  });

  it('search and filters stay OUTSIDE the scroll container (always visible)', () => {
    const listIdx = source.indexOf('arm-scroll max-h-[58vh]');
    const searchIdx = source.indexOf("setFilter('search'");
    const filtersIdx = source.indexOf("slot: 'permissionManager'");
    assert.ok(searchIdx > 0 && searchIdx < listIdx, 'search wiring above the list');
    assert.ok(filtersIdx > 0 && filtersIdx < listIdx, 'persisted filters above the list');
  });
});

describe('§MASTER-DATA consumers — DB-driven vocabulary with static fallback', () => {
  function read(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf8');
  }

  it('FollowUpsPage renders the DB vocabulary (selector: active; filter: all)', () => {
    const s = read('src/components/pages/FollowUpsPage.tsx');
    assert.ok(s.includes("useMasterDataVocabulary('followUpTypes', TYPE_FALLBACK)"));
    assert.ok(s.includes('typeVocabulary.allOptions.map'), 'filter keeps inactive types reachable');
    assert.ok(s.includes('typeVocabulary.options.map'), 'form offers active types');
    assert.ok(s.includes('resolveTypeLabel'), 'badges/labels resolve through the vocabulary');
    assert.ok(s.includes('const TYPE_FALLBACK: Record<string, string>'), 'static fallback declared');
  });

  it('ComplaintsPage renders the DB vocabulary', () => {
    const s = read('src/components/pages/ComplaintsPage.tsx');
    assert.ok(s.includes("useMasterDataVocabulary('complaintTypes', COMPLAINT_TYPE_FALLBACK)"));
    assert.ok(s.includes('complaintTypeVocabulary.allOptions.map'));
    assert.ok(s.includes('complaintTypeVocabulary.options.map'));
    assert.ok(s.includes('const COMPLAINT_TYPE_FALLBACK: Record<string, string>'));
  });

  it('RequestsPage renders the DB vocabulary in BOTH form selects', () => {
    const s = read('src/components/pages/RequestsPage.tsx');
    assert.ok(s.includes("useMasterDataVocabulary('requestTypes', REQUEST_TYPE_FALLBACK)"));
    assert.ok(s.includes('requestTypeVocabulary.options.map'), 'add + edit selects are wired');
    assert.equal((s.match(/requestTypeVocabulary\.options\.map/g) ?? []).length, 2,
      'both the add and the edit form use the vocabulary');
    assert.ok(s.includes('resolveRequestTypeLabel'), 'labels resolve through the vocabulary');
    assert.ok(s.includes('const REQUEST_TYPE_FALLBACK: Record<string, string>'));
  });

  it('the shared inline quick-forms render the DB vocabulary', () => {
    const s = read('src/components/shared/inline-forms.tsx');
    assert.ok(s.includes("useMasterDataVocabulary('complaintTypes', COMPLAINT_TYPE_FALLBACK)"));
    assert.ok(s.includes("useMasterDataVocabulary('followUpTypes', FOLLOWUP_TYPE_FALLBACK)"));
    assert.ok(s.includes("useMasterDataVocabulary('requestTypes', REQUEST_TYPE_FALLBACK)"));
  });
});
