// ══════════════════════════════════════════════════════════════
//  M0.3 — Organization & Data Scope Foundation
//
//  Activation of the Milestone 10 scope engine:
//    • fail-closed default (missing non-admin scope ≠ 'all')
//    • evidence-based preset scopes on the employees page
//    • scope-tier inheritance (stored.scope → position.scope →
//      role.scope → fail-closed) inside the SINGLE resolver
//    • engine resolution against the organization graph
//    • route wiring guards (GET /api/employees + employee detail)
//
//  Test-matrix numbering (M0.3 spec, items 1–20) is referenced in
//  each test title.
//
//  Run: npx tsx --test src/lib/__tests__/m03-organization-data-scope.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  FAIL_CLOSED_SCOPE,
  explainScopeResolution,
  getPermissionsForRole,
  migratePermission,
  resolveEffectivePermissions,
  resolvePageScope,
  type PagePermission,
  type PermissionsMap,
} from '@/config/permissions';
import { resolveEmployeeScope, filterEmployeesByScope } from '@/lib/scope';
import type { OrgNode, OrgEmployeeRef } from '@/lib/organization';

const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const API_ROOT = join(PROJECT_ROOT, 'src', 'app', 'api');

function toPosix(absPath: string): string {
  return relative(PROJECT_ROOT, absPath).split(sep).join('/');
}

function collect(dir: string, filter: (name: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path, filter, out);
    else if (filter(entry.name)) out.push(path);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// ── Organization fixture ─────────────────────────────────────
//
// company
// └── sales (department)
//     ├── teamA — empAhmed (linked to uAhmed), empMohamed
//     └── teamB (managed by uManagerB) — empAli, empOmar
// └── quality (department) — empSara (linked to uSara)
// empFree — unassigned (orgNodeId null)
function node(id: string, type: OrgNode['type'], parentId: string | null, extra: Partial<OrgNode> = {}): OrgNode {
  return {
    id, name: id, type, parentId, managerUserId: null, managerUserName: null,
    status: 'active', order: 0, description: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

function fixture() {
  const orgNodes: OrgNode[] = [
    node('company', 'company', null),
    node('sales', 'department', 'company'),
    node('teamA', 'team', 'sales'),
    node('teamB', 'team', 'sales', { managerUserId: 'uManagerB' }),
    node('qualityDept', 'department', 'company'),
  ];
  const employees: OrgEmployeeRef[] = [
    { id: 'empAhmed', orgNodeId: 'teamA' },
    { id: 'empMohamed', orgNodeId: 'teamA' },
    { id: 'empAli', orgNodeId: 'teamB' },
    { id: 'empOmar', orgNodeId: 'teamB' },
    { id: 'empSara', orgNodeId: 'qualityDept' },
    { id: 'empFree', orgNodeId: null },
  ];
  return { orgNodes, employees };
}

/** Effective map for a role with an employees-scope stored override. */
function mapWithScope(role: string, scope: string): PermissionsMap {
  return resolveEffectivePermissions(role, { employees: { level: 'read', scope: scope as never } });
}

// ══════════════════════════════════════════════════════════════
//  A. Fail-closed default + preset activation
// ══════════════════════════════════════════════════════════════

describe('M0.3 A — fail-closed scope default', () => {
  it('[matrix 9] a non-admin entry WITHOUT a scope fails closed — never "all"', () => {
    assert.equal(resolvePageScope({ employees: { level: 'read' } }, 'employees', 'quality'), FAIL_CLOSED_SCOPE);
    assert.equal(resolvePageScope({ employees: 'read' }, 'employees', 'hr'), FAIL_CLOSED_SCOPE);
    assert.equal(resolvePageScope({}, 'employees', 'manager'), FAIL_CLOSED_SCOPE);
    assert.equal(resolvePageScope(null, 'employees', 'user'), FAIL_CLOSED_SCOPE);
  });

  it('[matrix 9] engine side: unconfigured non-admin resolves an EMPTY people scope without linkage', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'u1', role: 'quality' }, 'employees',
      resolveEffectivePermissions('user', null), // generic role: no scope anywhere
      { orgNodes, employees },
    );
    assert.equal(ctx.isUnrestricted, false);
    assert.equal(ctx.scope, FAIL_CLOSED_SCOPE);
    assert.equal(ctx.employeeIds.size, 0);
  });

  it('[matrix 10] admin is unaffected — always "all", structured source "admin"', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'admin1', role: 'admin' }, 'employees', mapWithScope('quality', 'own'),
      { orgNodes, employees },
    );
    assert.equal(ctx.isUnrestricted, true);
    assert.equal(ctx.source, 'admin');
    assert.equal(ctx.includes('empFree'), true); // admin keeps seeing everything
  });

  it('a configured scope on the entry wins; structured source "configured"', () => {
    const map = mapWithScope('quality', 'team');
    assert.equal(resolvePageScope(map, 'employees', 'quality'), 'team');
    assert.deepEqual(explainScopeResolution(map, 'employees', 'quality'), {
      scope: 'team', source: 'configured', configured: true,
    });
  });

  it('permission and scope stay separate axes — a "none" level with an "all" scope still denies the page', () => {
    // [matrix 5 precondition] scope NEVER grants permission: the level gate
    // is what verifyPermission enforces before any scope resolution.
    const perm = migratePermission({ level: 'none', scope: 'all' } as PagePermission);
    assert.equal(perm.level, 'none');
    assert.equal(perm.scope, 'all');
  });
});

describe('M0.3 A — preset activation (evidence-based, employees page only)', () => {
  it('HR preset: employees scope "all" (workforce administration is org-wide by function)', () => {
    assert.equal(resolvePageScope(getPermissionsForRole('hr'), 'employees', 'hr'), 'all');
  });

  it('QUALITY preset: employees scope "all" (org-wide monitoring function)', () => {
    assert.equal(resolvePageScope(getPermissionsForRole('quality'), 'employees', 'quality'), 'all');
  });

  it('MANAGER preset: employees scope "subtree" (managed org nodes ∪ own — assignment-driven, not role→data)', () => {
    assert.equal(resolvePageScope(getPermissionsForRole('manager'), 'employees', 'manager'), 'subtree');
  });

  it('DEFAULT (generic user) preset: employees deliberately UNCONFIGURED → fail-closed', () => {
    assert.equal(resolvePageScope(getPermissionsForRole('user'), 'employees', 'user'), FAIL_CLOSED_SCOPE);
  });

  it('activation is employees-only: no OTHER page in any preset carries a scope', () => {
    for (const role of ['admin', 'hr', 'manager', 'quality', 'user']) {
      const preset = getPermissionsForRole(role);
      for (const [key, entry] of Object.entries(preset)) {
        if (key === 'employees') continue;
        if (typeof entry === 'object') {
          assert.equal(entry.scope, undefined, `${role}.${key} must not pre-configure a scope`);
        }
      }
    }
  });

  it('[matrix 2] manager preset alone (no stored override) resolves managed subtrees', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uManagerB', role: 'manager', linkedEmployeeId: 'empOmar' },
      'employees', getPermissionsForRole('manager'),
      { orgNodes, employees },
    );
    assert.equal(ctx.scope, 'subtree');
    assert.equal(ctx.includes('empAli'), true);    // teamB managed by uManagerB
    assert.equal(ctx.includes('empOmar'), true);   // own linked record
    assert.equal(ctx.includes('empAhmed'), false); // teamA not managed
    assert.equal(ctx.includes('empSara'), false);  // other department
  });

  it('a manager with NO managed nodes and no linkage fails closed to an empty set', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uOrphan', role: 'manager' }, 'employees', getPermissionsForRole('manager'),
      { orgNodes, employees },
    );
    assert.equal(ctx.employeeIds.size, 0);
  });
});

// ══════════════════════════════════════════════════════════════
//  B. Scope-tier inheritance inside the single resolver
// ══════════════════════════════════════════════════════════════

describe('M0.3 B — scope-tier inheritance (stored.scope → position.scope → role.scope → fail-closed)', () => {
  it('a stored object override WITHOUT a scope inherits the role preset scope (level still replaces)', () => {
    const effective = resolveEffectivePermissions('manager', { employees: { level: 'read', actions: {} } });
    assert.equal(migratePermission(effective.employees).level, 'read');
    assert.equal(resolvePageScope(effective, 'employees', 'manager'), 'subtree');
  });

  it('a legacy STRING override also inherits the preset scope (pre-scope maps cannot strip it)', () => {
    const effective = resolveEffectivePermissions('manager', { employees: 'read' });
    assert.equal(migratePermission(effective.employees).level, 'read');
    assert.equal(resolvePageScope(effective, 'employees', 'manager'), 'subtree');
  });

  it('an explicitly configured stored scope WINS over the preset scope', () => {
    const effective = resolveEffectivePermissions('manager', { employees: { level: 'read', scope: 'all' } });
    assert.equal(resolvePageScope(effective, 'employees', 'manager'), 'all');
  });

  it('a position template without a scope inherits the preset scope; an explicit template scope beats the preset', () => {
    const noScopeTemplate = { employees: { level: 'read' } };
    const inherited = resolveEffectivePermissions('manager', null, noScopeTemplate);
    assert.equal(resolvePageScope(inherited, 'employees', 'manager'), 'subtree');

    const scopedTemplate = { employees: { level: 'read', scope: 'department' } };
    const overridden = resolveEffectivePermissions('manager', null, scopedTemplate);
    assert.equal(resolvePageScope(overridden, 'employees', 'manager'), 'department');
  });

  it('a stored scope beats a position-template scope (resolver tier order preserved)', () => {
    const effective = resolveEffectivePermissions(
      'manager',
      { employees: { level: 'read', scope: 'team' } },
      { employees: { level: 'read', scope: 'all' } },
    );
    assert.equal(resolvePageScope(effective, 'employees', 'manager'), 'team');
  });

  it('an INVALID explicitly-configured scope is untrusted → fail-closed (not inherited preset scope)', () => {
    const effective = resolveEffectivePermissions('manager', { employees: { level: 'read', scope: 'galaxy' as never } });
    assert.equal(resolvePageScope(effective, 'employees', 'manager'), FAIL_CLOSED_SCOPE);
  });

  it('entries with no scope on ANY tier merge byte-identically to the pre-M0.3 spread', () => {
    const effective = resolveEffectivePermissions('quality', { home: 'read', attendance: 'edit' });
    assert.equal(effective.home, 'read');            // legacy string passes through
    assert.equal(effective.attendance, 'edit');      // legacy string passes through
    assert.deepEqual(effective.followUps, getPermissionsForRole('quality').followUps);
  });

  it('[matrix 11] stored "none" over a role read grant → permission DENIED (scope is moot)', () => {
    const effective = resolveEffectivePermissions('manager', { employees: { level: 'none' } });
    assert.equal(migratePermission(effective.employees).level, 'none'); // → 403 at the route gate
  });

  it('[matrix 12] stored read over a role deny → permission SUCCEEDS, then the scope applies', () => {
    // The generic preset denies observations; a stored grant reopens it.
    // The page has no scope on any tier → data fails closed to 'own'.
    const effective = resolveEffectivePermissions('user', { observations: { level: 'read' } });
    assert.equal(migratePermission(effective.observations).level, 'read'); // permission passes
    assert.equal(resolvePageScope(effective, 'observations', 'user'), FAIL_CLOSED_SCOPE); // scope restricts
  });
});

// ══════════════════════════════════════════════════════════════
//  C. Engine resolution against the organization graph
// ══════════════════════════════════════════════════════════════

describe('M0.3 C — engine resolution (matrix 1–8, 15–19)', () => {
  it('[matrix 1] ALL: admin + employees read → every employee, including unassigned', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uAdmin', role: 'quality', linkedEmployeeId: 'empSara' },
      'employees', mapWithScope('quality', 'all'), { orgNodes, employees },
    );
    assert.equal(ctx.isUnrestricted, true);
    for (const e of employees) assert.equal(ctx.includes(e.id), true, e.id);
  });

  it('[matrix 2] TEAM: only the assigned team', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uAhmed', role: 'manager', linkedEmployeeId: 'empAhmed' },
      'employees', mapWithScope('manager', 'team'), { orgNodes, employees },
    );
    assert.equal(ctx.includes('empAhmed'), true);
    assert.equal(ctx.includes('empMohamed'), true);  // teammate
    assert.equal(ctx.includes('empAli'), false);     // other team
    assert.equal(ctx.includes('empSara'), false);    // other department
  });

  it('[matrix 3] DEPARTMENT: the assigned department subtree', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uAhmed', role: 'manager', linkedEmployeeId: 'empAhmed' },
      'employees', mapWithScope('manager', 'department'), { orgNodes, employees },
    );
    for (const id of ['empAhmed', 'empMohamed', 'empAli', 'empOmar']) {
      assert.equal(ctx.includes(id), true, `${id} in sales subtree`);
    }
    assert.equal(ctx.includes('empSara'), false);
  });

  it('[matrix 4] BRANCH: an intermediate node subtree resolves like a branch (generic-depth tree)', () => {
    // A "branch" is any intermediate org node; the department anchor
    // walks to the nearest department-typed ancestor (branchX) and
    // its whole subtree — nested teams included.
    const orgNodes: OrgNode[] = [
      node('company', 'company', null),
      node('branchX', 'department', 'company'),
      node('teamC', 'team', 'branchX'),
    ];
    const employees: OrgEmployeeRef[] = [
      { id: 'empC1', orgNodeId: 'teamC' },
      { id: 'empC2', orgNodeId: 'teamC' },
      { id: 'empHQ', orgNodeId: 'company' },
    ];
    const ctx = resolveEmployeeScope(
      { userId: 'uBranchMgr', role: 'manager', linkedEmployeeId: 'empC1' },
      'employees', mapWithScope('manager', 'department'), { orgNodes, employees },
    );
    assert.equal(ctx.includes('empC1'), true);
    assert.equal(ctx.includes('empC2'), true);
    assert.equal(ctx.includes('empHQ'), false); // outside the branch subtree
  });

  it('[matrix 6] TEAM A scope + TEAM B rows requested → filter intersects: no Team B data', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uAhmed', role: 'manager', linkedEmployeeId: 'empAhmed' },
      'employees', mapWithScope('manager', 'team'), { orgNodes, employees },
    );
    const teamBRows = employees.filter((e) => e.orgNodeId === 'teamB');
    assert.deepEqual(filterEmployeesByScope(teamBRows, ctx), []); // authorizedScope ∩ filters
  });

  it('[matrix 7] department-scoped user requesting another department → no unauthorized records', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uAhmed', role: 'manager', linkedEmployeeId: 'empAhmed' },
      'employees', mapWithScope('manager', 'department'), { orgNodes, employees },
    );
    const qualityRows = employees.filter((e) => e.orgNodeId === 'qualityDept');
    assert.deepEqual(filterEmployeesByScope(qualityRows, ctx), []);
  });

  it('[matrix 8] an UNASSIGNED employee never leaks into a restricted scope', () => {
    const { orgNodes, employees } = fixture();
    for (const scope of ['team', 'department', 'subtree'] as const) {
      const ctx = resolveEmployeeScope(
        { userId: 'uAhmed', role: 'manager', linkedEmployeeId: 'empAhmed' },
        'employees', mapWithScope('manager', scope), { orgNodes, employees },
      );
      assert.equal(ctx.includes('empFree'), false, `empFree must not leak into ${scope} scope`);
    }
    // …while full scope / admin still sees them (no fabricated assignments).
    const allCtx = resolveEmployeeScope(
      { userId: 'uAdmin', role: 'admin' }, 'employees', {}, { orgNodes, employees },
    );
    assert.equal(allCtx.includes('empFree'), true);
  });

  it('[matrix 15–18] the engine answers ONLY from the org graph — caller-supplied ids never widen it', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uAhmed', role: 'manager', linkedEmployeeId: 'empAhmed' },
      'employees', mapWithScope('manager', 'team'), { orgNodes, employees },
    );
    // Whatever ids/roles/org ids a request might claim, the context
    // is fixed: teamA members only.
    assert.equal(ctx.includes('empAli'), false);
    assert.equal(ctx.includes('empSara'), false);
    assert.equal(ctx.includes('empFree'), false);
  });

  it('[matrix 19] filters can only NARROW: server filtering applies on top of the scope', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uAhmed', role: 'manager', linkedEmployeeId: 'empAhmed' },
      'employees', mapWithScope('manager', 'department'), { orgNodes, employees },
    );
    const filtered = filterEmployeesByScope(employees, ctx).map((e) => e.id).sort();
    assert.deepEqual(filtered, ['empAhmed', 'empAli', 'empMohamed', 'empOmar']); // sales only
  });

  it('structured audit result: source is threaded through every context', () => {
    const { orgNodes, employees } = fixture();
    assert.equal(
      resolveEmployeeScope({ userId: 'u1', role: 'hr' }, 'employees', getPermissionsForRole('hr'), { orgNodes, employees }).source,
      'configured', // hr preset entry carries scope 'all'
    );
    assert.equal(
      resolveEmployeeScope({ userId: 'u1', role: 'user' }, 'employees', getPermissionsForRole('user'), { orgNodes, employees }).source,
      'fail-closed',
    );
  });
});

// ══════════════════════════════════════════════════════════════
//  D. Route wiring guards (static analysis, M0.x convention)
// ══════════════════════════════════════════════════════════════

describe('M0.3 D — route wiring guards', () => {
  const employeesRoute = readFileSync(join(API_ROOT, 'employees', 'route.ts'), 'utf8');
  const employeesRouteCode = stripComments(employeesRoute);
  const detailRoutePath = join(API_ROOT, 'employee-360', '[id]', 'route.ts');
  const detailRouteCode = stripComments(readFileSync(detailRoutePath, 'utf8'));

  it('[matrix 5/13] GET /api/employees: 401 unauthenticated + permission gate BEFORE scope resolution', () => {
    assert.ok(existsSync(join(API_ROOT, 'employees', 'route.ts')));
    assert.match(employeesRouteCode, /requireAuth\(request\)/);
    assert.match(employeesRouteCode, /status:\s*401/);
    assert.match(employeesRouteCode, /verifyPermission\(request,\s*'employees',\s*'view'\)/);
    const gateIndex = employeesRouteCode.indexOf('verifyPermission');
    const scopeIndex = employeesRouteCode.indexOf('resolvePageScope');
    assert.ok(gateIndex >= 0 && scopeIndex > gateIndex, 'permission gate must run before scope resolution');
  });

  it('[matrix 15–19] GET /api/employees: no query parameter can widen the scope', () => {
    // The only searchParams read in the route is 'counts'; the scope
    // engine is fed exclusively from the authenticated identity.
    const reads = [...employeesRouteCode.matchAll(/searchParams\.get\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
    assert.deepEqual(reads, ['counts']);
    assert.match(employeesRouteCode, /userId:\s*auth\.userId/);
    assert.match(employeesRouteCode, /role:\s*auth\.role/);
    assert.match(employeesRouteCode, /linkedEmployeeId:\s*auth\.linkedEmployeeId/);
  });

  it('[matrix 20] employee detail route enforces the SAME scope before assembling data', () => {
    // The employees gate may be expressed either through the classic
    // adapter (verifyPermission) or the canonical authorizer
    // (authorizeRequest) — same gate, same page key, same action.
    assert.match(
      detailRouteCode,
      /(verifyPermission\(request,\s*'employees',\s*'view'\)|authorizeRequest\(request,\s*\{\s*page:\s*'employees',\s*action:\s*'view'\s*,?\s*\}\))/,
    );
    assert.match(detailRouteCode, /resolveEmployeeScope\(/);
    const scopeIndex = detailRouteCode.indexOf('resolveEmployeeScope');
    const aggregateIndex = detailRouteCode.indexOf('Promise.allSettled');
    assert.ok(scopeIndex >= 0 && aggregateIndex > scopeIndex, 'scope check must precede data aggregation');
    // Out-of-scope → safe not-found (anti-enumeration, same body as the missing path)
    assert.ok(
      /scopeContext\.includes\(employeeId\)[\s\S]{0,200}status:\s*404/.test(detailRouteCode),
      'out-of-scope employee must resolve as 404',
    );
  });

  it('no duplicate scope logic: the RAW engine is consumed by exactly the two employee routes', () => {
    // M0.4 disclosure: routes adopted since M0.4 consume the engine
    // ONLY through the server guard (@/lib/scope/server), whose
    // function name resolveEmployeeScopeFromDb CONTAINS the substring
    // matched below. Stripping it first keeps this assertion on its
    // original invariant — no route calls the raw engine directly —
    // while the full M0.4 consumer set is pinned by the M0.4 suite
    // (m04-scoped-write-paths.test.ts, group H).
    const routeFiles = collect(API_ROOT, (n) => n === 'route.ts');
    const consumers = routeFiles
      .map(toPosix)
      .filter((p) =>
        /resolveEmployeeScope|filterEmployeesByScope/.test(
          stripComments(readFileSync(join(PROJECT_ROOT, p), 'utf8'))
            .replace(/resolveEmployeeScopeFromDb/g, ''),
        ));
    assert.deepEqual(consumers.sort(), [
      'src/app/api/employee-360/[id]/route.ts',
      'src/app/api/employees/route.ts',
    ]);
  });

  it('client parity: usePermissions delegates to the canonical resolvePageScope (no second scope logic)', () => {
    const hookSrc = stripComments(readFileSync(join(PROJECT_ROOT, 'src', 'hooks', 'usePermissions.ts'), 'utf8'));
    assert.match(hookSrc, /resolvePageScope\(/);
    assert.doesNotMatch(hookSrc, /scope\s*\?\?\s*'all'/); // the old inline 'all' fallback must be gone
  });

  it('Permission Manager console persists scopes explicitly — selecting a scope stores it (incl. "all")', () => {
    // The console is now the single editor surface. It edits ONLY the
    // direct-override tier: scope 'inherit' DELETES the facet (the
    // resolver then inherits the lower tier's scope); any chosen value
    // — including 'all' — is stored explicitly on the entry. The scope
    // vocabulary offered is the CANONICAL one (no invented values).
    const pmSrc = stripComments(readFileSync(join(PROJECT_ROOT, 'src', 'components', 'permissions', 'PermissionManagerConsole.tsx'), 'utf8'));
    assert.match(pmSrc, /onSetScope = \(pageKey: string, scope: DataScope \| 'inherit'\)/); // the single scope mutation
    assert.match(pmSrc, /if \(scope === 'inherit'\) delete entry\.scope;/);                 // inherit = absent, never stored as a value
    assert.match(pmSrc, /else entry\.scope = scope;/);                                      // chosen value stored explicitly (incl. 'all')
    const rowSrc = stripComments(readFileSync(join(PROJECT_ROOT, 'src', 'components', 'permissions', 'PageAccessRow.tsx'), 'utf8'));
    assert.match(rowSrc, /resolvePageScope\(/);            // preview through the CANONICAL scope resolver
    assert.match(rowSrc, /describeDataScope\(/);           // canonical scope labels, no parallel vocabulary
  });
});
