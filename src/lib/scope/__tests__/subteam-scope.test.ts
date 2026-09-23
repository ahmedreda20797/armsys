// ══════════════════════════════════════════════════════════════
//  Scope-semantics regression suite — §explicit scope semantics
//
//  Codifies the canonical scope vocabulary after the subteam
//  roll-up fix:
//    • TEAM anchors at the viewer's EXACT org node — a subteam
//      member/manager NEVER rolls up to the parent team (no
//      siblings, no parent, no department).
//    • OWN resolves exactly ONE identity: users.linkedEmployeeId —
//      and fails closed (empty) without the linkage.
//    • ALL (configured on any tier) is unrestricted — no
//      organizational narrowing.
//    • DEPARTMENT resolves the exact department per the tree and
//      never anchors at a company/root node.
//    • Managed branches stay at their scope level: managed
//      team/subteam nodes feed TEAM, managed departments feed
//      DEPARTMENT, ALL managed nodes feed SUBTREE.
//
//  Test organization (§17):
//    company
//    ├── deptA (department)
//    │   └── teamA (team)
//    │       ├── subA1 (subteam, managed by uM1) — eA1a, eA1b, eA1c
//    │       └── subA2 (subteam) — eA2
//    │       (teamA direct) — eTeamA
//    └── deptB (department) — eB
//
//  Run: npx tsx --test src/lib/scope/__tests__/subteam-scope.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmployeeScope, filterEmployeesByScope } from '@/lib/scope';
import { resolveEffectivePermissions, type PermissionsMap } from '@/config/permissions';
import type { OrgNode, OrgEmployeeRef } from '@/lib/organization';

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
    node('deptA', 'department', 'company'),
    node('teamA', 'team', 'deptA'),
    node('subA1', 'subteam', 'teamA', { managerUserId: 'uM1' }),
    node('subA2', 'subteam', 'teamA'),
    node('deptB', 'department', 'company'),
  ];
  const employees: OrgEmployeeRef[] = [
    { id: 'eA1a', orgNodeId: 'subA1' },
    { id: 'eA1b', orgNodeId: 'subA1' },
    { id: 'eA2', orgNodeId: 'subA2' },
    { id: 'eTeamA', orgNodeId: 'teamA' },
    { id: 'eB', orgNodeId: 'deptB' },
    { id: 'eFree', orgNodeId: null },
  ];
  return { orgNodes, employees };
}

/** Effective map for a role with an employees-scope override tier. */
function mapWithScope(role: string, scope: string): PermissionsMap {
  return resolveEffectivePermissions(role, { employees: { level: 'read', scope: scope as never } });
}

const SCOPE_VIEWER = (userId: string, linkedEmployeeId: string | null) => ({
  userId,
  role: 'manager',
  linkedEmployeeId,
});

describe('§TEAM-EXACT — subteam scope never rolls up (§17)', () => {
  it('manager of Subteam A1 with TEAM → Subteam A1 ONLY', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      SCOPE_VIEWER('uM1', 'eA1a'), 'employees', mapWithScope('manager', 'team'), { orgNodes, employees },
    );
    assert.equal(ctx.scope, 'team');
    assert.ok(ctx.includes('eA1a'), 'own subteam member');
    assert.ok(ctx.includes('eA1b'), 'subteam member');
    assert.ok(!ctx.includes('eA2'), 'sibling subteam MUST stay out');
    assert.ok(!ctx.includes('eTeamA'), 'parent-team direct member MUST stay out');
    assert.ok(!ctx.includes('eB'), 'other department MUST stay out');
  });

  it('plain MEMBER of Subteam A2 with TEAM → Subteam A2 only (no parent roll-up)', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uA2', role: 'user', linkedEmployeeId: 'eA2' },
      'employees', mapWithScope('user', 'team'), { orgNodes, employees },
    );
    assert.ok(ctx.includes('eA2'));
    assert.ok(!ctx.includes('eA1a'), 'sibling subteam must not leak through the parent team');
    assert.ok(!ctx.includes('eA1b'), 'sibling subteam must not leak through the parent team');
    assert.ok(!ctx.includes('eTeamA'), 'parent team direct members must not leak');
  });

  it('TEAM placement on a DEPARTMENT node contributes NO team anchor (fail-closed → own)', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uDept', role: 'user', linkedEmployeeId: 'eB' }, // eB sits on deptB (department-typed)
      'employees', mapWithScope('user', 'team'), { orgNodes, employees },
    );
    assert.ok(ctx.includes('eB'), 'own record always included');
    assert.equal(ctx.employeeIds.size, 1, 'no team-level placement → no team anchor');
  });

  it('managed-branch separation: a managed DEPARTMENT does not widen TEAM', () => {
    const { orgNodes, employees } = fixture();
    const nodes = orgNodes.map((n) => (n.id === 'deptA' ? { ...n, managerUserId: 'uDeptMgr' } : n));
    const ctx = resolveEmployeeScope(
      SCOPE_VIEWER('uDeptMgr', null), 'employees', mapWithScope('manager', 'team'), { orgNodes: nodes, employees },
    );
    assert.equal(ctx.employeeIds.size, 0, 'team scope ignores managed department branches (no linkage → empty)');
  });

  it('managed-branch separation: a managed TEAM does not widen DEPARTMENT', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      SCOPE_VIEWER('uM1', null), 'employees', mapWithScope('manager', 'department'), { orgNodes, employees },
    );
    assert.equal(ctx.employeeIds.size, 0, 'department scope ignores managed team branches (no linkage → empty)');
  });
});

describe('§DEPARTMENT — exact department per the organization tree', () => {
  it('manager of Subteam A1 with DEPARTMENT + boundary override deptA → whole Department A subtree', () => {
    const { orgNodes, employees } = fixture();
    // §ORG-BOUNDARY: the department anchor is the boundary's
    // department node. A subteam manager's ASSIGNMENT boundary is the
    // subteam itself — climbing to the department would silently
    // broaden; the department must be granted explicitly.
    const ctx = resolveEmployeeScope(
      {
        userId: 'uM1', role: 'manager', linkedEmployeeId: 'eA1a',
        orgBoundaryNodeIds: ['deptA'],
      },
      'employees', mapWithScope('manager', 'department'), { orgNodes, employees },
    );
    assert.equal(ctx.scope, 'department');
    for (const id of ['eA1a', 'eA1b', 'eA2', 'eTeamA']) {
      assert.ok(ctx.includes(id), `${id} belongs to Department A`);
    }
    assert.ok(!ctx.includes('eB'), 'Department B stays out');
  });

  it('subteam ASSIGNMENT boundary + DEPARTMENT → own record only (no ancestor climb)', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      SCOPE_VIEWER('uM1', 'eA1a'), 'employees', mapWithScope('manager', 'department'), { orgNodes, employees },
    );
    assert.deepEqual([...ctx.employeeIds], ['eA1a']);
  });

  it('DEPARTMENT placement on the COMPANY node contributes NO department anchor (fail-closed → own)', () => {
    const { orgNodes, employees } = fixture();
    const nodes = [...orgNodes, node('hq', 'company', 'company')];
    const emps = [...employees, { id: 'eHq', orgNodeId: 'hq' }];
    const ctx = resolveEmployeeScope(
      { userId: 'uHq', role: 'user', linkedEmployeeId: 'eHq' },
      'employees', mapWithScope('user', 'department'), { orgNodes: nodes, employees: emps },
    );
    assert.ok(ctx.includes('eHq'));
    assert.equal(ctx.employeeIds.size, 1, 'a root placement must never anchor the whole organization');
  });
});

describe('§SUBTREE — own node + descendants + managed branches', () => {
  it('manager of Subteam A1 with SUBTREE → A1 subtree (+ own record)', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      SCOPE_VIEWER('uM1', 'eA1a'), 'employees', mapWithScope('manager', 'subtree'), { orgNodes, employees },
    );
    assert.ok(ctx.includes('eA1a'));
    assert.ok(ctx.includes('eA1b'));
    assert.ok(!ctx.includes('eA2'), 'subtree is the exact node + descendants, not siblings');
    assert.ok(!ctx.includes('eTeamA'));
  });
});

describe('§OWN — exactly the linked employee identity (§18 user-link test)', () => {
  it('OWN → only the linked employee (EMP-067 case)', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      SCOPE_VIEWER('u67', 'eA1a'), 'employees', mapWithScope('user', 'own'), { orgNodes, employees },
    );
    assert.equal(ctx.scope, 'own');
    assert.ok(ctx.includes('eA1a'));
    assert.equal(ctx.employeeIds.size, 1);
  });

  it('re-linking the user moves OWN to the new identity (no stale team result)', () => {
    const { orgNodes, employees } = fixture();
    const before = resolveEmployeeScope(
      SCOPE_VIEWER('u67', 'eA1a'), 'employees', mapWithScope('user', 'own'), { orgNodes, employees },
    );
    assert.deepEqual([...before.employeeIds], ['eA1a']);

    const after = resolveEmployeeScope(
      SCOPE_VIEWER('u67', 'eB'), 'employees', mapWithScope('user', 'own'), { orgNodes, employees },
    );
    assert.deepEqual([...after.employeeIds], ['eB'], 'OWN follows the canonical linkedEmployeeId only');
  });

  it('OWN without a linked employee FAILS CLOSED to an empty set (never team/department/all)', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      SCOPE_VIEWER('uNoLink', null), 'employees', mapWithScope('manager', 'own'), { orgNodes, employees },
    );
    assert.equal(ctx.employeeIds.size, 0);
    assert.equal(ctx.isUnrestricted, false);
  });
});

describe('§ALL — no additional narrowing WITHIN the boundary (§16/§24)', () => {
  it('ALL + company boundary override spans that boundary — and only it', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      {
        userId: 'uComp', role: 'manager', linkedEmployeeId: 'eA1a',
        orgBoundaryNodeIds: ['company'],
      },
      'employees', mapWithScope('manager', 'all'), { orgNodes, employees },
    );
    assert.equal(ctx.isUnrestricted, false, 'non-admin ALL is boundary-bounded, never global');
    for (const id of ['eA1a', 'eA1b', 'eA2', 'eTeamA', 'eB']) {
      assert.ok(ctx.includes(id), `${id} inside the company boundary`);
    }
    assert.ok(!ctx.includes('eFree'), 'unplaced employees are outside every node subtree');
  });

  it('ALL without a resolvable boundary fails closed to the own record (never org-wide)', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      SCOPE_VIEWER('uGhost', null), 'employees', mapWithScope('manager', 'all'), { orgNodes, employees },
    );
    assert.equal(ctx.isUnrestricted, false);
    assert.equal(ctx.employeeIds.size, 0);
  });

  it('user override scope ALL on a manager beats the preset subtree (boundary-limited)', () => {
    const { orgNodes, employees } = fixture();
    const permissions = resolveEffectivePermissions('manager', { employees: { level: 'read', scope: 'all' } });
    const ctx = resolveEmployeeScope(
      {
        userId: 'uM1', role: 'manager', linkedEmployeeId: 'eA1a',
        orgBoundaryNodeIds: ['company'],
      },
      'employees', permissions, { orgNodes, employees },
    );
    assert.equal(ctx.scope, 'all');
    assert.ok(ctx.includes('eB'), 'ALL spans the whole authorized boundary');
    assert.ok(filterEmployeesByScope(employees, ctx).length > 2);
  });

  it('generic role WITHOUT a configured scope stays fail-closed (own) — not all', () => {
    const { orgNodes, employees } = fixture();
    const permissions = resolveEffectivePermissions('user', null);
    const ctx = resolveEmployeeScope(
      SCOPE_VIEWER('uGeneric', 'eA1a'), 'employees', permissions, { orgNodes, employees },
    );
    assert.equal(ctx.scope, 'own');
    assert.deepEqual([...ctx.employeeIds], ['eA1a']);
  });
});

describe('§ASSIGNED — canonical assignment source ∪ own', () => {
  it('ASSIGNED resolves assignment pairs + own record only', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      SCOPE_VIEWER('uAssign', 'eA1a'),
      'employees', mapWithScope('user', 'assigned'),
      {
        orgNodes, employees,
        assignments: [
          { employeeId: 'eA2', assignedToUserId: 'uAssign' },
          { employeeId: 'eB', assignedToUserId: 'someoneElse' },
        ],
      },
    );
    assert.ok(ctx.includes('eA1a'), 'own');
    assert.ok(ctx.includes('eA2'), 'explicitly assigned');
    assert.ok(!ctx.includes('eB'), 'assigned to someone else');
    assert.ok(!ctx.includes('eA1b'), 'same subteam ≠ assigned');
  });
});
