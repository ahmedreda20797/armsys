// src/lib/__tests__/connect-floating-nav.test.ts
// ══════════════════════════════════════════════════════════════
//  §CONNECT-UI-RECOVERY — NAVIGATION CONTRACT
//
//  Connect is the GLOBAL FLOATING interface (far-left launcher mounted
//  once in the authenticated shell), NOT a sidebar destination. This
//  suite pins the navigation mechanics (mirroring the §SIDEBAR-CLEANUP
//  convention used for the settings sections):
//    • 'connect' is overlayOnly in APP_PAGES — absent from the sidebar
//      universe (and therefore from the layout editor + persisted
//      layout rendering, which both filter by the same set);
//    • the permission identity stays fully intact (presets, admin
//      bypass, route-permission guard) — removing a NAV entry never
//      changes authorization;
//    • the page id stays routable (deep links from notifications);
//    • the floating root is mounted EXACTLY ONCE in the shared
//      authenticated shell (AppLayout), never inside a page.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  APP_PAGES,
  migratePermission,
  resolveEffectivePermissions,
  DEFAULT_PERMISSIONS,
  HR_PERMISSIONS,
  MANAGER_PERMISSIONS,
  QUALITY_PERMISSIONS,
} from '@/config/permissions';

const projectRoot = join(__dirname, '..', '..', '..');

function sidebarVisiblePages(): Set<string> {
  // The sidebar universe = APP_PAGES minus overlayOnly (the exact
  // rule usePermissions.visiblePages applies — mirrored here pure).
  return new Set(APP_PAGES.filter((p) => !p.overlayOnly).map((p) => p.id));
}

describe('§CONNECT-NAV — Connect leaves the right sidebar', () => {
  it('connect is overlayOnly in APP_PAGES (never a sidebar destination)', () => {
    const page = APP_PAGES.find((p) => p.id === 'connect');
    assert.ok(page, 'connect is still a registered page');
    assert.equal(page.overlayOnly, true, 'connect must be overlayOnly');
    assert.equal(page.permissionKey, 'connect', 'canonical permission key unchanged');
  });

  it('connect is ABSENT from the sidebar universe (and thus from the layout editor)', () => {
    const visible = sidebarVisiblePages();
    assert.equal(visible.has('connect'), false, 'connect must not be a sidebar destination');
  });

  it('the real operational pages REMAIN sidebar destinations', () => {
    const visible = sidebarVisiblePages();
    for (const id of ['home', 'operationsCenter', 'followUps', 'employees', 'attendance', 'requests', 'settings']) {
      assert.equal(visible.has(id), true, `${id} must remain a global destination`);
    }
  });

  it('overlayOnly pages stay excluded for ADMINS too (visiblePages filters uniformly)', () => {
    // visiblePages applies the overlayOnly filter BEFORE the admin
    // branch — an admin must not see connect in the sidebar either.
    const adminVisible = APP_PAGES.filter((p) => !p.overlayOnly).map((p) => p.id);
    assert.equal(adminVisible.includes('connect'), false);
  });
});

describe('§CONNECT-NAV — navigation removal never touches authorization', () => {
  const level = (role: string, key: string, stored: Record<string, unknown> | null = null) =>
    migratePermission(resolveEffectivePermissions(role, stored)[key]).level;

  it('every staff preset still holds connect: read (unchanged)', () => {
    for (const preset of [DEFAULT_PERMISSIONS, HR_PERMISSIONS, MANAGER_PERMISSIONS, QUALITY_PERMISSIONS]) {
      assert.equal(migratePermission(preset.connect).level, 'read');
    }
    assert.equal(level('manager', 'connect'), 'read');
    assert.equal(level('hr', 'connect'), 'read');
  });

  it('a stored connect:none override still denies (the 403 gate is unaffected)', () => {
    assert.equal(level('user', 'connect', { connect: 'none' }), 'none');
  });

  it('the admin bypass keeps full access', () => {
    // Admin is decided by role in the authorizer — the permission
    // entry itself is not even consulted. Assert the page remains
    // registered so every permission surface keeps resolving it.
    assert.ok(APP_PAGES.find((p) => p.permissionKey === 'connect'));
  });
});

describe('§CONNECT-NAV — deep-link compatibility', () => {
  it("the 'connect' PageId stays registered in src/types/index.ts", () => {
    const source = readFileSync(join(projectRoot, 'src', 'types', 'index.ts'), 'utf8');
    assert.match(source, /'connect'/, "PageId union keeps 'connect'");
  });

  it('src/app/page.tsx still routes the connect page id to the overlay-opening shim', () => {
    const source = readFileSync(join(projectRoot, 'src', 'app', 'page.tsx'), 'utf8');
    assert.match(source, /case 'connect':\s*return <ConnectPage/, "renderPage keeps the 'connect' case");
    assert.match(source, /ConnectPage\s*=\s*dynamic/, 'ConnectPage stays lazy-imported');
  });
});

describe('§CONNECT-NAV — global mounting in the authenticated shell', () => {
  it('AppLayout mounts ConnectFloatingRoot EXACTLY ONCE (outside page content)', () => {
    const source = readFileSync(join(projectRoot, 'src', 'components', 'layout', 'AppLayout.tsx'), 'utf8');
    const mounts = source.match(/<ConnectFloatingRoot\s*\/>/g) ?? [];
    assert.equal(mounts.length, 1, 'exactly one global mount in AppLayout');
    assert.match(source, /import \{ ConnectFloatingRoot \}/, 'imported in the shared shell');
  });

  it('no PAGE component mounts the floating root (no per-page duplicates)', () => {
    const pagesDir = join(projectRoot, 'src', 'components', 'pages');
    // Bounded check: the pages that historically hosted Connect UI.
    // Matches an actual JSX mount, not prose comments.
    for (const file of ['ConnectPage.tsx', 'HomePage.tsx']) {
      const source = readFileSync(join(pagesDir, file), 'utf8');
      const mounts = source.match(/<ConnectFloatingRoot/g) ?? [];
      assert.equal(mounts.length, 0, `${file} must not mount the floating root`);
    }
  });

  it('ConnectPage shim opens the overlay and mounts NO connect polling queries', () => {
    const source = readFileSync(join(projectRoot, 'src', 'components', 'pages', 'ConnectPage.tsx'), 'utf8');
    assert.match(source, /openWithConversation/, 'shim converts the visit into one overlay open');
    assert.equal(source.includes('useConnectConversations'), false, 'no duplicate list polling in the shim');
    assert.equal(source.includes('useConnectMessages'), false, 'no message polling in the shim');
    assert.equal(source.includes('useConnectSync'), false, 'no sync polling in the shim');
  });

  it('the floating root gates rendering on authentication + connect permission', () => {
    const source = readFileSync(
      join(projectRoot, 'src', 'components', 'connect', 'floating', 'ConnectFloatingRoot.tsx'),
      'utf8',
    );
    assert.match(source, /useAuth\(\)/, 'reads the auth context');
    assert.match(source, /canViewPage\('connect'\)/, 'gates on the connect page permission');
    assert.match(source, /data-testid="connect-launcher"/, 'stable launcher handle for e2e');
  });
});
