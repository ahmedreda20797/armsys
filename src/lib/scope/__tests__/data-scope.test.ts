// ══════════════════════════════════════════════════════════════
//  Milestone 10 — Data Scope engine (organization-aware)
//
//  Covers (milestone test plan C):
//    • all / department / team / subtree / assigned / own
//    • admin always resolves 'all' (same bypass as verifyPermission)
//    • relationship-based resolution: moving an employee between
//      nodes changes scope AUTOMATICALLY without editing any
//      permission list
//    • fail-closed: linkage-less viewers get empty people scopes
//
//  Run: npx tsx --test src/lib/scope/__tests__/data-scope.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmployeeScope, filterEmployeesByScope } from '@/lib/scope';
import { getPermissionsForRole, resolveEffectivePermissions, type PermissionsMap } from '@/config/permissions';
import type { OrgNode, OrgEmployeeRef } from '@/lib/organization';

function node(id: string, type: OrgNode['type'], parentId: string | null, extra: Partial<OrgNode> = {}): OrgNode {
  return {
    id, name: id, type, parentId, managerUserId: null, managerUserName: null,
    status: 'active', order: 0, description: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

/**
 * company
 * └── sales (department)
 *     ├── teamA — Ahmed (linked to uAhmed), Mohamed
 *     └── teamB (managed by uManagerB) — Ali, Omar
 * └── quality (department) — Sara (linked to uSara)
 */
function fixture() {
  const orgNodes: OrgNode[] = [
    node('company', 'company', null),
    node('sales', 'department', 'company'),
    node('teamA', 'team', 'sales'),
    node('teamB', 'team', 'sales', { managerUserId: 'uManagerB' }),
    node('quality', 'department', 'company'),
  ];
  const employees: OrgEmployeeRef[] = [
    { id: 'empAhmed', orgNodeId: 'teamA' },
    { id: 'empMohamed', orgNodeId: 'teamA' },
    { id: 'empAli', orgNodeId: 'teamB' },
    { id: 'empOmar', orgNodeId: 'teamB' },
    { id: 'empSara', orgNodeId: 'quality' },
    { id: 'empFree', orgNodeId: null },
  ];
  return { orgNodes, employees };
}

/** Effective map for a quality-role user with an employees-scope override. */
function mapWithScope(scope: string): PermissionsMap {
  return resolveEffectivePermissions('quality', { employees: { level: 'read', scope: scope as never } });
}

describe('data scope — resolution per scope kind', () => {
  it('all: quality preset carries scope "all" — resolved WITHIN the organizational boundary', () => {
    const { orgNodes, employees } = fixture();
    // §ORG-BOUNDARY: a NON-ADMIN 'all' is no longer a global bypass —
    // it means "no narrowing inside the boundary". The quality preset
    // still carries the explicit 'all' (configured tier), but the
    // reachable set is the boundary's subtree union. A quality user
    // assigned to the company node (linked empSara is in 'quality'
    // department under company) resolves company-wide, and an
    // unplaced quality user fails closed.
    const permissions = getPermissionsForRole('quality');
    assert.equal(permissions.employees && typeof permissions.employees === 'object' ? permissions.employees.scope : undefined, 'all');

    const placed = resolveEmployeeScope(
      { userId: 'u1', role: 'quality', linkedEmployeeId: 'empSara' }, 'employees', permissions, { orgNodes, employees },
    );
    assert.equal(placed.isUnrestricted, false);
    // empSara sits in the quality department under company → the
    // assignment boundary is that department node; ALL spans it.
    assert.equal(placed.includes('empSara'), true);
    assert.equal(placed.includes('empAhmed'), false, 'sales is outside the quality-department boundary');

    const unplaced = resolveEmployeeScope(
      { userId: 'u2', role: 'quality' }, 'employees', permissions, { orgNodes, employees },
    );
    assert.equal(unplaced.isUnrestricted, false);
    assert.equal(unplaced.employeeIds.size, 0, 'unresolvable boundary fails closed');
  });

  it('admin always resolves all regardless of configured scope', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'admin1', role: 'admin' }, 'employees', mapWithScope('own'), { orgNodes, employees },
    );
    assert.equal(ctx.isUnrestricted, true);
  });

  it('own: only the linked employee', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uAhmed', role: 'quality', linkedEmployeeId: 'empAhmed' },
      'employees', mapWithScope('own'), { orgNodes, employees },
    );
    assert.equal(ctx.isUnrestricted, false);
    assert.equal(ctx.includes('empAhmed'), true);
    assert.equal(ctx.includes('empMohamed'), false);
    assert.equal(ctx.includes('empFree'), false);
  });

  it('team: the linked employee\'s team subtree', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uAhmed', role: 'quality', linkedEmployeeId: 'empAhmed' },
      'employees', mapWithScope('team'), { orgNodes, employees },
    );
    // teamA members only (Sara/Omar/Ali are outside)
    assert.equal(ctx.includes('empAhmed'), true);
    assert.equal(ctx.includes('empMohamed'), true);
    assert.equal(ctx.includes('empAli'), false);
    assert.equal(ctx.includes('empSara'), false);
  });

  it('department: the boundary department node\'s full membership per the tree', () => {
    const { orgNodes, employees } = fixture();
    // §ORG-BOUNDARY: empAhmed's own node is teamA — the department
    // anchor is NOT climbed to. With the sales department granted as
    // the boundary, DEPARTMENT resolves its whole membership.
    const ctx = resolveEmployeeScope(
      { userId: 'uAhmed', role: 'quality', linkedEmployeeId: 'empAhmed', orgBoundaryNodeIds: ['sales'] },
      'employees', mapWithScope('department'), { orgNodes, employees },
    );
    for (const id of ['empAhmed', 'empMohamed', 'empAli', 'empOmar']) {
      assert.equal(ctx.includes(id), true, `${id} should be in the sales department membership`);
    }
    assert.equal(ctx.includes('empSara'), false); // quality department
    assert.equal(ctx.includes('empFree'), false);
  });

  it('department: a team-level assignment boundary contributes NO department anchor (fail-closed)', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uAhmed', role: 'quality', linkedEmployeeId: 'empAhmed' },
      'employees', mapWithScope('department'), { orgNodes, employees },
    );
    assert.deepEqual([...ctx.employeeIds], ['empAhmed'], 'no ancestor climb — own record only');
  });

  it('subtree: union of MANAGED node subtrees ∪ own', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uManagerB', role: 'manager', linkedEmployeeId: 'empOmar' },
      'employees',
      resolveEffectivePermissions('manager', { employees: { level: 'read', scope: 'subtree' } }),
      { orgNodes, employees },
    );
    assert.equal(ctx.includes('empAli'), true);   // teamB managed
    assert.equal(ctx.includes('empOmar'), true);  // own + managed
    assert.equal(ctx.includes('empAhmed'), false);// teamA not managed
  });

  it('assigned: assignment pairs ∪ own', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uQuality1', role: 'quality', linkedEmployeeId: 'empSara' },
      'employees', mapWithScope('assigned'),
      {
        orgNodes, employees,
        assignments: [
          { employeeId: 'empAli', assignedToUserId: 'uQuality1' },
          { employeeId: 'empOmar', assignedToUserId: 'someoneElse' },
        ],
      },
    );
    assert.equal(ctx.includes('empSara'), true); // own
    assert.equal(ctx.includes('empAli'), true);  // assigned
    assert.equal(ctx.includes('empOmar'), false);// assigned to someone else
  });

  it('fail-closed: viewers without linkage resolve empty people scopes', () => {
    const { orgNodes, employees } = fixture();
    for (const scope of ['own', 'team', 'department'] as const) {
      const ctx = resolveEmployeeScope(
        { userId: 'uNoLink', role: 'quality' }, 'employees', mapWithScope(scope), { orgNodes, employees },
      );
      assert.equal(ctx.employeeIds.size, 0, `${scope} should be empty without linkage`);
    }
  });
});

describe('data scope — organization-aware dynamics', () => {
  it('moving an employee to another node changes scope AUTOMATICALLY', () => {
    const { orgNodes, employees } = fixture();
    const viewer = { userId: 'uAhmed', role: 'quality', linkedEmployeeId: 'empAhmed' };
    const permissions = mapWithScope('team');

    const before = resolveEmployeeScope(viewer, 'employees', permissions, { orgNodes, employees });
    assert.equal(before.includes('empMohamed'), true); // Mohamed in teamA with Ahmed

    // Ahmed moves to teamB — the RELATIONSHIP changes, nothing else
    const moved = employees.map((e) => (e.id === 'empAhmed' ? { ...e, orgNodeId: 'teamB' } : e));
    const after = resolveEmployeeScope(viewer, 'employees', permissions, { orgNodes, employees: moved });
    assert.equal(after.includes('empMohamed'), false); // out of Ahmed's new team
    assert.equal(after.includes('empAli'), true);     // new teammates visible
    assert.equal(after.includes('empAhmed'), true);   // own always included
  });

  it('filterEmployeesByScope passes everything through when unrestricted', () => {
    const employees = [{ id: 'a' }, { id: 'b' }];
    const ctx = resolveEmployeeScope({ userId: 'x', role: 'admin' }, 'employees', {}, {
      orgNodes: [], employees: [],
    });
    assert.equal(filterEmployeesByScope(employees, ctx).length, 2);
  });

  it('filterEmployeesByScope drops out-of-scope rows (server-authoritative)', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uAhmed', role: 'quality', linkedEmployeeId: 'empAhmed' },
      'employees', mapWithScope('team'), { orgNodes, employees },
    );
    const filtered = filterEmployeesByScope(employees, ctx);
    assert.deepEqual(filtered.map((e) => e.id).sort(), ['empAhmed', 'empMohamed']);
  });
});

// ══════════════════════════════════════════════════════════════
//  §18 ORG-SCOPE — a manager ASSIGNED to an org node (managerUserId)
//  resolves that node's subtree under team/department scope, even when
//  the manager is not an employee INSIDE the team/department.
// ══════════════════════════════════════════════════════════════
describe('§18 org-based scope — manager assignment drives team/department scope', () => {
  it('team scope + manager of teamB (not an employee there) → whole teamB subtree', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uManagerB', role: 'manager', linkedEmployeeId: null },
      'employees',
      mapWithScope('team'),
      { orgNodes, employees },
    );
    assert.equal(ctx.scope, 'team');
    // Ali + Omar are IN teamB; Ahmed/Mohamed (teamA) and Sara are not.
    assert.ok(ctx.includes('empAli'));
    assert.ok(ctx.includes('empOmar'));
    assert.ok(!ctx.includes('empAhmed'));
    assert.ok(!ctx.includes('empSara'));
  });

  it('department scope + manager of a department node → whole department subtree', () => {
    const { orgNodes, employees } = fixture();
    const nodes = [...orgNodes, { ...orgNodes[1], managerUserId: 'uSalesManager' }];
    const ctx = resolveEmployeeScope(
      { userId: 'uSalesManager', role: 'manager', linkedEmployeeId: null },
      'employees',
      mapWithScope('department'),
      { orgNodes: nodes, employees },
    );
    // The entire sales subtree: both teams + their members.
    assert.ok(ctx.includes('empAhmed'));
    assert.ok(ctx.includes('empMohamed'));
    assert.ok(ctx.includes('empAli'));
    assert.ok(ctx.includes('empOmar'));
    assert.ok(!ctx.includes('empSara'), 'quality department stays out of scope');
  });

  it('self scope remains self only — even for org managers (fail-closed semantics preserved)', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uManagerB', role: 'manager', linkedEmployeeId: 'empAhmed' },
      'employees',
      mapWithScope('own'),
      { orgNodes, employees },
    );
    assert.ok(ctx.includes('empAhmed'));
    assert.ok(!ctx.includes('empAli'));
    assert.ok(!ctx.includes('empOmar'));
  });

  it('a linked employee ALSO anchors team scope by their own node (union, not replacement)', () => {
    const { orgNodes, employees } = fixture();
    // Manager of teamB who is also an employee IN teamA: gets both.
    const ctx = resolveEmployeeScope(
      { userId: 'uManagerB', role: 'manager', linkedEmployeeId: 'empAhmed' },
      'employees',
      mapWithScope('team'),
      { orgNodes, employees },
    );
    assert.ok(ctx.includes('empAhmed'), 'own team (via linked employee) in scope');
    assert.ok(ctx.includes('empAli'), 'managed team in scope');
  });
});
