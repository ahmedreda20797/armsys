// ══════════════════════════════════════════════════════════════
//  SCOPE ENFORCEMENT — canonical engine matrix (A–H) + negatives
//
//  Guards the LIVE regression: configured scopes silently degrading
//  to OWN. The fixture mirrors the production tree shape (department
//  nodes holding employees, teams with managed subteams, users
//  linked/unlinked to employees).
//
//  Matrix:
//    A) manager + TEAM → team subtree incl. own + subteams
//    B) quality + TEAM → canonical team via own node (NOT own-only)
//    C) user + DEPARTMENT → own department subtree
//    D) user + OWN → own only
//    E) user + ASSIGNED → explicit assignments (not creation-own)
//    F) manager + SUBTREE (managed branches) → all managed nodes
//    G) user + SUBTREE → own node + descendants (NOT own-only)
//    H) user + ALL → unrestricted
//
//  Negatives: TEAM/DEPARTMENT/ASSIGNED/SUBTREE must never behave as
//  OWN; unresolvable organization → fail-closed (never broader).
//
//  Run: npx tsx --test src/lib/scope/__tests__/scope-enforcement.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmployeeScope, type ScopeAssignment } from '@/lib/scope';
import { buildScopeAssignments } from '@/lib/scope/server';
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

/**
 * Mirrors the production tree shape:
 *   company
 *   ├── sales (department)
 *   │   └── teamA (team, mgr=uTeamLead)
 *   │       ├── subA1 (subteam, mgr=uSubLead) — empSub1
 *   │       ├── empA1, empA2
 *   ├── hr (department) — empHr1 (linked to uHr)
 *   └── ops (department, mgr=uOpsDeptMgr) — empOps1 (linked to uOps)
 */
function fixture() {
  const orgNodes: OrgNode[] = [
    node('company', 'company', null),
    node('sales', 'department', 'company'),
    node('teamA', 'team', 'sales', { managerUserId: 'uTeamLead' }),
    node('subA1', 'subteam', 'teamA', { managerUserId: 'uSubLead' }),
    node('hr', 'department', 'company'),
    node('ops', 'department', 'company', { managerUserId: 'uOpsDeptMgr' }),
  ];
  const employees: OrgEmployeeRef[] = [
    { id: 'empA1', orgNodeId: 'teamA' },
    { id: 'empA2', orgNodeId: 'teamA' },
    { id: 'empSub1', orgNodeId: 'subA1' },
    { id: 'empHr1', orgNodeId: 'hr' },
    { id: 'empOps1', orgNodeId: 'ops' },
    { id: 'empFree', orgNodeId: null },
  ];
  return { orgNodes, employees };
}

function scopedMap(role: string, scope: string): PermissionsMap {
  return resolveEffectivePermissions(role, { employees: { level: 'read', scope: scope as never } });
}

function resolve(
  viewer: { userId: string; linkedEmployeeId?: string | null },
  scope: string,
  role = 'user',
  assignments?: ScopeAssignment[],
) {
  const { orgNodes, employees } = fixture();
  return resolveEmployeeScope(
    { userId: viewer.userId, role, linkedEmployeeId: viewer.linkedEmployeeId ?? null },
    'employees',
    scopedMap(role, scope),
    { orgNodes, employees, assignments },
  );
}

function ids(ctx: { employeeIds: ReadonlySet<string> }): string[] {
  return [...ctx.employeeIds].sort();
}

describe('matrix A/B — TEAM scope is the canonical team, never OWN', () => {
  it('A: manager of a team sees the whole team subtree (incl. subteams) + own', () => {
    // uTeamLead manages teamA and is linked to empA2 (inside it).
    const ctx = resolve({ userId: 'uTeamLead', linkedEmployeeId: 'empA2' }, 'team', 'manager');
    assert.deepEqual(ids(ctx), ['empA1', 'empA2', 'empSub1']);
    assert.equal(ctx.includes('empHr1'), false);
    assert.equal(ctx.includes('empOps1'), false);
  });

  it('A2: manager of a team with NO linked employee still resolves the managed team', () => {
    // Production regression: manager not stored as an employee in the node.
    const ctx = resolve({ userId: 'uTeamLead' }, 'team', 'manager');
    assert.deepEqual(ids(ctx), ['empA1', 'empA2', 'empSub1']);
  });

  it('A3: managing a SUBTEAM alone satisfies the team anchor (team-level branch)', () => {
    const ctx = resolve({ userId: 'uSubLead' }, 'team', 'manager');
    assert.deepEqual(ids(ctx), ['empSub1']);
  });

  it('B: quality user + TEAM sees the canonical team via their own node — NOT own-only', () => {
    // empSub1 sits in a subteam → nearest team ancestor is teamA → its subtree.
    const ctx = resolve({ userId: 'uSub1', linkedEmployeeId: 'empSub1' }, 'team', 'quality');
    assert.deepEqual(ids(ctx), ['empA1', 'empA2', 'empSub1']);
    assert.ok(ctx.employeeIds.size > 1, 'TEAM must not degrade to OWN');
  });

  it('B2: employee directly in a department node falls back to that node (never narrower than own)', () => {
    const ctx = resolve({ userId: 'uOps', linkedEmployeeId: 'empOps1' }, 'team', 'quality');
    assert.deepEqual(ids(ctx), ['empOps1']);
  });
});

describe('matrix C/D — DEPARTMENT and OWN', () => {
  it('C: DEPARTMENT resolves the own department subtree — not OWN, not another department', () => {
    const ctx = resolve({ userId: 'uOps', linkedEmployeeId: 'empOps1' }, 'department', 'user');
    assert.deepEqual(ids(ctx), ['empOps1']);
    assert.equal(ctx.includes('empHr1'), false);
    assert.ok(ctx.scope === 'department');
  });

  it('C2: manager of a DEPARTMENT node resolves it without being an employee there', () => {
    const ctx = resolve({ userId: 'uOpsDeptMgr' }, 'department', 'manager');
    assert.deepEqual(ids(ctx), ['empOps1']);
  });

  it('D: OWN resolves only the linked employee', () => {
    const ctx = resolve({ userId: 'uOps', linkedEmployeeId: 'empOps1' }, 'own', 'user');
    assert.deepEqual(ids(ctx), ['empOps1']);
  });
});

describe('matrix E — ASSIGNED: explicit assignments, never creation-ownership', () => {
  const assignments: ScopeAssignment[] = [
    { employeeId: 'empA1', assignedToUserId: 'uOps' },
    { employeeId: 'empHr1', assignedToUserId: 'uOther' },
  ];

  it('assigned employees are included even when outside own node/team', () => {
    const ctx = resolve({ userId: 'uOps', linkedEmployeeId: 'empOps1' }, 'assigned', 'user', assignments);
    assert.deepEqual(ids(ctx), ['empA1', 'empOps1']); // own + explicitly assigned
    assert.equal(ctx.includes('empHr1'), false);      // assigned to someone else
  });

  it('no valid assignment information → fail closed to own (never broader)', () => {
    const ctx = resolve({ userId: 'uOps', linkedEmployeeId: 'empOps1' }, 'assigned', 'user', []);
    assert.deepEqual(ids(ctx), ['empOps1']);
  });
});

describe('matrix F/G — SUBTREE: managed branches ∪ own node + descendants', () => {
  it('F: managed branches resolve through managerUserId (not own records)', () => {
    // uOpsDeptMgr manages ops; linked to nothing.
    const ctx = resolve({ userId: 'uOpsDeptMgr' }, 'subtree', 'manager');
    assert.deepEqual(ids(ctx), ['empOps1']);
  });

  it('F2: multiple managed nodes union', () => {
    // uTeamLead manages teamA → teamA subtree; uSubLead's subteam is inside it.
    const ctx = resolve({ userId: 'uTeamLead', linkedEmployeeId: 'empA2' }, 'subtree', 'manager');
    assert.deepEqual(ids(ctx), ['empA1', 'empA2', 'empSub1']);
  });

  it('G: non-manager SUBTREE = own organization node + descendants — NOT own-only', () => {
    // empOps1 sits directly in ops; subtree = ops subtree.
    const ctx = resolve({ userId: 'uOps', linkedEmployeeId: 'empOps1' }, 'subtree', 'user');
    assert.deepEqual(ids(ctx), ['empOps1']);
    assert.ok(ctx.employeeIds.size >= 1);
  });

  it('G2: unresolvable organization → fail-closed minimum (never broader)', () => {
    // No linked employee, manages nothing → empty set (own absent).
    const ctx = resolve({ userId: 'uNobody' }, 'subtree', 'user');
    assert.deepEqual(ids(ctx), []);
  });
});

describe('matrix H — ALL', () => {
  it('unrestricted: unassigned employees included, membership empty', () => {
    const ctx = resolve({ userId: 'uOps', linkedEmployeeId: 'empOps1' }, 'all', 'quality');
    assert.equal(ctx.isUnrestricted, true);
    assert.equal(ctx.includes('empFree'), true);
  });
});

describe('buildScopeAssignments — canonical assignment materialization', () => {
  it('CAPA assignedTo (USER id) grants its subject employees', () => {
    const pairs = buildScopeAssignments({
      users: [],
      followUps: [],
      capaCases: [
        { assignedTo: 'uOps', employeeId: 'empA1', relatedEmployeeIds: ['empA2'] },
        { assignedTo: 'uOps', employeeId: 'empClosed' }, // closed below
      ].map((c, i) => (i === 1 ? { ...c, status: 'closed' } : c)),
    });
    assert.deepEqual(pairs, [
      { employeeId: 'empA1', assignedToUserId: 'uOps' },
      { employeeId: 'empA2', assignedToUserId: 'uOps' },
    ]);
  });

  it('follow-up responsiblePerson (EMPLOYEE id) grants the LINKED user', () => {
    const pairs = buildScopeAssignments({
      users: [{ id: 'uOps', linkedEmployeeId: 'empResponsible' }],
      followUps: [
        { employeeId: 'empA1', responsiblePerson: 'empResponsible', status: 'open' },
        { employeeId: 'empA1', responsiblePerson: 'empResponsible', status: 'closed' }, // terminal
      ],
      capaCases: [],
    });
    assert.deepEqual(pairs, [{ employeeId: 'empA1', assignedToUserId: 'uOps' }]);
  });

  it('empty/unknown ids and terminal states produce nothing', () => {
    const pairs = buildScopeAssignments({
      users: [{ id: 'u1', linkedEmployeeId: null }],
      followUps: [{ employeeId: 'empA1', responsiblePerson: '', status: 'open' }],
      capaCases: [{ assignedTo: null, employeeId: 'empA1' }],
    });
    assert.deepEqual(pairs, []);
  });
});
