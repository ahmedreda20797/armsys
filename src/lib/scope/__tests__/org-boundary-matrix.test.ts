// ══════════════════════════════════════════════════════════════
//  §ORG-BOUNDARY — WHERE × HOW-MUCH canonical matrix (§28–§32)
//
//  Production-shaped tree (real dump, names shortened):
//
//    الادارة العامة (GA — legacy company-typed root)
//    ├── Accounts / Offline Ops / … (central departments)
//    ├── Company A (Alrehla Alfarida)
//    │   └── Sales Dept (AA Sales Team — department-typed)
//    │       ├── Eslam's Sales Team (team, MGR=uEslam)
//    │       │   ├── Mostafa's Sales Team (subteam, MGR=uMostafa) — eM1, eM2
//    │       │   ├── Hanin's Sales Team (subteam, MGR=uHanin) — eH1
//    │       │   └── Lotfy Sales Team (subteam, MGR=uLotfy) — eL1
//    │       │   (Eslam direct) — eE1
//    │       └── Religious Tourism (team) — eR1
//    └── Company B (Halaa Travels)
//        └── HT Sales Team (department)
//            └── Yasmina's Sales Team (team) — eY1
//
//  Persons:
//    uMostafa  — subteam manager (boundary: Mostafa's node)
//    uEslam    — parent team manager (boundary: Eslam's node)
//    uDeptMgr  — department manager (boundary: Sales Dept)
//    uCompA    — company-level user (boundary override: Company A)
//    uCorp     — cross-company user (boundary override: A + B)
//    uGa       — General Administration user (boundary override: GA root)
//    uEmp67    — employee with OWN (linked eM1)
//    uCentral  — central-department user placed directly under GA
//
//  Run: npx tsx --test src/lib/scope/__tests__/org-boundary-matrix.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmployeeScope } from '@/lib/scope';
import { resolveOrgBoundary, explainOrgBoundary } from '@/lib/scope/boundary';
import { resolveOrgNodeLevel, buildOrgIndex, type OrgNodeLevel } from '@/lib/organization';
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

const GA = 'ga-root';
const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';
const SALES_DEPT = 'sales-dept';
const ESLAM = 'eslam-team';
const MOSTAFA = 'mostafa-subteam';
const HANIN = 'hanin-subteam';
const LOTFY = 'lotfy-subteam';
const TOURISM = 'tourism-team';
const HT_SALES = 'ht-sales-dept';
const YASMINA = 'yasmina-team';
const CENTRAL_DEPT = 'accounts';

function fixture() {
  // GA root is stored 'company'-typed (production shape); the level
  // layer must resolve it to general_administration.
  const orgNodes: OrgNode[] = [
    node(GA, 'company', null, { name: 'الادارة العامة' }),
    node(CENTRAL_DEPT, 'department', GA),
    node(COMPANY_A, 'company', GA, { name: 'Alrehla Alfarida' }),
    node(SALES_DEPT, 'department', COMPANY_A, { name: 'AA Sales Team' }),
    node(ESLAM, 'team', SALES_DEPT, { managerUserId: 'uEslam', name: "Eslam's Sales Team" }),
    node(MOSTAFA, 'subteam', ESLAM, { managerUserId: 'uMostafa', name: "Mostafa's Sales Team" }),
    node(HANIN, 'subteam', ESLAM, { managerUserId: 'uHanin', name: "Hanin's Sales Team" }),
    node(LOTFY, 'subteam', ESLAM, { managerUserId: 'uLotfy', name: 'Lotfy Sales Team' }),
    node(TOURISM, 'team', SALES_DEPT, { name: 'Religious Tourism' }),
    node(COMPANY_B, 'company', GA, { name: 'Halaa Travels' }),
    node(HT_SALES, 'department', COMPANY_B, { name: 'HT Sales Team' }),
    node(YASMINA, 'team', HT_SALES, { name: "Yasmina's Sales Team" }),
  ];
  const employees: OrgEmployeeRef[] = [
    { id: 'eM1', orgNodeId: MOSTAFA },
    { id: 'eM2', orgNodeId: MOSTAFA },
    { id: 'eH1', orgNodeId: HANIN },
    { id: 'eL1', orgNodeId: LOTFY },
    { id: 'eE1', orgNodeId: ESLAM },     // Eslam's direct member
    { id: 'eR1', orgNodeId: TOURISM },   // same department, other team
    { id: 'eY1', orgNodeId: YASMINA },   // Company B
    { id: 'eC1', orgNodeId: CENTRAL_DEPT }, // central department under GA
    { id: 'eFree', orgNodeId: null },
  ];
  return { orgNodes, employees };
}

/** Effective map carrying an employees-entry scope. */
function mapWithScope(role: string, scope: string): PermissionsMap {
  return resolveEffectivePermissions(role, { employees: { level: 'read', scope: scope as never } });
}

function resolve(
  viewer: { userId: string; linkedEmployeeId?: string | null; orgBoundaryNodeIds?: string[] | null },
  scope: string,
  role = 'manager',
) {
  const { orgNodes, employees } = fixture();
  return resolveEmployeeScope(
    {
      userId: viewer.userId,
      role,
      linkedEmployeeId: viewer.linkedEmployeeId ?? null,
      orgBoundaryNodeIds: viewer.orgBoundaryNodeIds ?? null,
    },
    'employees',
    mapWithScope(role, scope),
    { orgNodes, employees },
  );
}

const ids = (ctx: { employeeIds: ReadonlySet<string> }): string[] => [...ctx.employeeIds].sort();

// ── §16 audit — the level normalization layer ──────────────────

describe('§16 node levels — normalization (no data rename)', () => {
  const levels: Array<[string, OrgNodeLevel]> = [
    [GA, 'general_administration'],
    [COMPANY_A, 'company'],
    [COMPANY_B, 'company'],
    [SALES_DEPT, 'department'],
    [CENTRAL_DEPT, 'department'],
    [ESLAM, 'team'],
    [TOURISM, 'team'],
    [MOSTAFA, 'subteam'],
    [HANIN, 'subteam'],
  ];
  for (const [nodeId, expected] of levels) {
    it(`${nodeId} → level ${expected} (stored type stays untouched)`, () => {
      const { orgNodes } = fixture();
      const index = buildOrgIndex(orgNodes);
      assert.equal(resolveOrgNodeLevel(index, nodeId), expected);
    });
  }
});

// ── §29 CRITICAL SUBTEAM TEST ───────────────────────────────────

describe('§29 Mostafa — subteam manager, boundary = his subteam, scope TEAM', () => {
  it('sees ONLY Mostafa subteam employees — no Eslam direct, no siblings, no other depts/companies', () => {
    const ctx = resolve({ userId: 'uMostafa', linkedEmployeeId: 'eM1' }, 'team');
    assert.deepEqual(ids(ctx), ['eM1', 'eM2']);
  });

  it('same viewer with SUBTREE still resolves only the subteam subtree (no parent climb)', () => {
    const ctx = resolve({ userId: 'uMostafa', linkedEmployeeId: 'eM1' }, 'subtree');
    assert.deepEqual(ids(ctx), ['eM1', 'eM2']);
  });

  it('boundary source is the organization assignment (تلقائي — من التعيين التنظيمي)', () => {
    const ctx = resolve({ userId: 'uMostafa', linkedEmployeeId: 'eM1' }, 'team');
    assert.equal(ctx.boundary.source, 'assignment');
  });
});

// ── §10/§13 Example 2 — parent team manager with SUBTREE ────────

describe('§10 Eslam — parent team manager: TEAM vs SUBTREE', () => {
  it('TEAM = the exact team node DIRECT members (his direct report only)', () => {
    const ctx = resolve({ userId: 'uEslam', linkedEmployeeId: 'eE1' }, 'team');
    assert.deepEqual(ids(ctx), ['eE1']);
  });

  it('SUBTREE = selected node + descendants (all three subteams + direct)', () => {
    const ctx = resolve({ userId: 'uEslam', linkedEmployeeId: 'eE1' }, 'subtree');
    assert.deepEqual(ids(ctx), ['eE1', 'eH1', 'eL1', 'eM1', 'eM2']);
  });

  it('never crosses into the sibling team of the same department', () => {
    const ctx = resolve({ userId: 'uEslam', linkedEmployeeId: 'eE1' }, 'subtree');
    assert.ok(!ctx.includes('eR1'));
    assert.ok(!ctx.includes('eY1'));
  });
});

// ── Department boundary ─────────────────────────────────────────

describe('§7/§13.Ex5 department manager — boundary = Sales Dept', () => {
  it('DEPARTMENT scope = the department full membership per the tree', () => {
    const { orgNodes, employees } = fixture();
    const ctx = resolveEmployeeScope(
      { userId: 'uDeptMgr', role: 'manager', linkedEmployeeId: null, orgBoundaryNodeIds: [SALES_DEPT] },
      'employees', mapWithScope('manager', 'department'), { orgNodes, employees },
    );
    assert.deepEqual(ids(ctx), ['eE1', 'eH1', 'eL1', 'eM1', 'eM2', 'eR1']);
  });

  it('a TEAM-level boundary contributes NO department anchor (fail-closed → own record)', () => {
    const ctx = resolve({ userId: 'uMostafa', linkedEmployeeId: 'eM1' }, 'department');
    assert.deepEqual(ids(ctx), ['eM1']);
  });

  it('a subteam manager does NOT inherit the department by climbing', () => {
    const { orgNodes, employees } = fixture();
    const boundary = resolveOrgBoundary(
      { userId: 'uMostafa', role: 'manager', linkedEmployeeId: 'eM1', orgBoundaryNodeIds: null },
      { orgNodes, employees },
    );
    assert.deepEqual(boundary.nodeIds, [MOSTAFA]);
    assert.equal(boundary.source, 'assignment');
  });
});

// ── §30 CRITICAL COMPANY TEST ───────────────────────────────────

describe('§30 Company A manager — boundary = Company A, scope ALL', () => {
  it('ALL inside Company A: everything beneath it, NOT Company B', () => {
    const ctx = resolve({ userId: 'uCompA', orgBoundaryNodeIds: [COMPANY_A] }, 'all', 'manager');
    assert.deepEqual(ids(ctx), ['eE1', 'eH1', 'eL1', 'eM1', 'eM2', 'eR1']);
    assert.ok(!ctx.includes('eY1'), 'Company B must stay out');
    assert.ok(!ctx.includes('eC1'), 'central GA departments stay out');
    assert.ok(!ctx.includes('eFree'), 'unplaced employees stay out of a company boundary');
    assert.equal(ctx.boundary.source, 'override');
  });

  it('company access comes from the boundary, never from the role (HR of A ≠ B)', () => {
    // hr role with its preset 'all' scope — still Company A only.
    const ctx = resolve({ userId: 'uHrA', orgBoundaryNodeIds: [COMPANY_A] }, 'all', 'hr');
    assert.ok(!ctx.includes('eY1'));
  });

  it('a user with NO boundary override and no placement fails closed (not company-wide)', () => {
    const ctx = resolve({ userId: 'uGhost' }, 'all', 'hr');
    assert.deepEqual(ids(ctx), []);
    assert.equal(ctx.isUnrestricted, false);
  });
});

// ── §31 CROSS-COMPANY TEST ──────────────────────────────────────

describe('§31 Corporate manager — boundary = Company A + Company B', () => {
  it('ALL across both companies, union of subtrees, no third data', () => {
    const ctx = resolve({ userId: 'uCorp', orgBoundaryNodeIds: [COMPANY_A, COMPANY_B] }, 'all', 'manager');
    assert.deepEqual(ids(ctx), ['eE1', 'eH1', 'eL1', 'eM1', 'eM2', 'eR1', 'eY1']);
    assert.ok(!ctx.includes('eC1'), 'GA central department stays out of a companies-only boundary');
    assert.ok(!ctx.includes('eFree'));
  });

  it('one user account — the union resolves from two boundary nodes', () => {
    const { orgNodes, employees } = fixture();
    const boundary = resolveOrgBoundary(
      { userId: 'uCorp', role: 'manager', orgBoundaryNodeIds: [COMPANY_A, COMPANY_B] },
      { orgNodes, employees },
    );
    assert.equal(boundary.source, 'override');
    assert.equal(boundary.nodeIds.length, 2);
  });
});

// ── §32 GENERAL ADMINISTRATION TEST ─────────────────────────────

describe('§32 General Administration manager — boundary = GA root', () => {
  it('ALL across every child company and node — but still boundary-based', () => {
    const ctx = resolve({ userId: 'uGa', orgBoundaryNodeIds: [GA] }, 'all', 'manager');
    assert.deepEqual(ids(ctx), ['eC1', 'eE1', 'eH1', 'eL1', 'eM1', 'eM2', 'eR1', 'eY1']);
    assert.ok(!ctx.includes('eFree'), 'unplaced employees are outside every node subtree');
  });

  it('GA ≠ System Owner: the GA user is NOT unrestricted — only admin is', () => {
    const ctx = resolve({ userId: 'uGa', orgBoundaryNodeIds: [GA] }, 'all', 'manager');
    assert.equal(ctx.isUnrestricted, false);
  });

  it('assignment-derived GA boundary: managing the GA root resolves it too', () => {
    const { orgNodes, employees } = fixture();
    const managedGa = orgNodes.map((n) => (n.id === GA ? { ...n, managerUserId: 'uGaMgr' } : n));
    const ctx = resolveEmployeeScope(
      { userId: 'uGaMgr', role: 'manager', linkedEmployeeId: null, orgBoundaryNodeIds: null },
      'employees', mapWithScope('manager', 'all'), { orgNodes: managedGa, employees },
    );
    assert.equal(ctx.boundary.source, 'assignment');
    assert.ok(ctx.includes('eY1'));
    assert.ok(ctx.includes('eM1'));
    assert.equal(ctx.isUnrestricted, false);
  });
});

// ── §11/§13.Ex6 EMPLOYEE boundary + OWN ─────────────────────────

describe('§11 employee-level boundary — OWN stays OWN', () => {
  it('EMP-067 case: own linked record only, regardless of placement', () => {
    const ctx = resolve({ userId: 'uEmp67', linkedEmployeeId: 'eM1' }, 'own', 'user');
    assert.deepEqual(ids(ctx), ['eM1']);
  });

  it('OWN without linkage fails closed (empty)', () => {
    const ctx = resolve({ userId: 'uNoLink' }, 'own', 'user');
    assert.deepEqual(ids(ctx), []);
  });

  it('a user placed in a central GA department: TEAM scope has no team anchor (fail-closed)', () => {
    const ctx = resolve({ userId: 'uCentral', linkedEmployeeId: 'eC1' }, 'team', 'user');
    assert.deepEqual(ids(ctx), ['eC1']);
  });
});

// ── Admin bypass + explanation contract ─────────────────────────

describe('admin bypass + explainability (§21/§33)', () => {
  it('admin is the ONLY truly unrestricted viewer', () => {
    const ctx = resolve({ userId: 'admin1' }, 'own', 'admin');
    assert.equal(ctx.isUnrestricted, true);
    assert.equal(ctx.boundary.source, 'admin');
  });

  it('explainOrgBoundary mirrors the enforced resolution (display = enforcement)', () => {
    const { orgNodes, employees } = fixture();
    const explanation = explainOrgBoundary(
      { userId: 'uMostafa', role: 'manager', linkedEmployeeId: 'eM1', orgBoundaryNodeIds: null },
      { orgNodes, employees },
    );
    assert.equal(explanation.source, 'assignment');
    assert.deepEqual(explanation.nodes.map((n) => n.id), [MOSTAFA]);
    assert.equal(explanation.nodes[0].level, 'subteam');
  });

  it('an override whose node vanished stays explicit (never silently falls back to assignment)', () => {
    const { orgNodes, employees } = fixture();
    const boundary = resolveOrgBoundary(
      { userId: 'uX', role: 'manager', linkedEmployeeId: 'eM1', orgBoundaryNodeIds: ['deleted-node'] },
      { orgNodes, employees },
    );
    assert.equal(boundary.source, 'override');
    assert.deepEqual(boundary.nodeIds, []);
  });
});
