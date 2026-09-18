// ══════════════════════════════════════════════════════════════
//  §PROFILE-TEAM — responsible-team canonical view model
//
//  Regression coverage for the profile page count/duplicate fix:
//    • each employee appears EXACTLY once (dedup by employee id,
//      deepest managed ancestor wins)
//    • DIRECT = attached to a node the user manages themselves —
//      never inferred from subtree co-membership
//    • counts derive from ONE canonical collection:
//      Σ group.memberCount === totalCount, group.directCount ===
//      the direct rows actually inside that group
//    • deterministic ordering (tree order → direct first → Arabic
//      name) — stable across repeated builds
//    • archived employees excluded, cap keeps numbers consistent
//
//  Run: npx tsx --test src/lib/organization/__tests__/responsible-team.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrgIndex,
  buildResponsibleTeamViewModel,
  type OrgNode,
} from '@/lib/organization';

function node(id: string, name: string, type: OrgNode['type'], parentId: string | null, extra: Partial<OrgNode> = {}): OrgNode {
  return {
    id, name, type, parentId,
    managerUserId: null, managerUserName: null,
    status: 'active', order: 0, description: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

interface EmployeeLike {
  id: string;
  name: string | null;
  code: string | null;
  orgNodeId: string | null;
  status?: 'active' | 'inactive' | 'archived';
}

function emp(id: string, name: string, orgNodeId: string | null, extra: Partial<EmployeeLike> = {}): EmployeeLike {
  return { id, name, code: id.toUpperCase(), orgNodeId, status: 'active', ...extra };
}

/** Reference fixture — ONE user (uBoss) manages sales, teamA and hr:
 *  company
 *  ├── sales (department, manager: uBoss)
 *  │   ├── teamA (team, manager: uBoss)         ← nested managed node
 *  │   │   └── [سارة]
 *  │   ├── teamC (team, NO manager)             ← unmanaged branch
 *  │   │   └── [هدى]
 *  │   └── [كريم]                                ← direct on the department
 *  └── hr (department, manager: uBoss)
 *      └── [منى, نور]
 */
function fixture() {
  const nodes: OrgNode[] = [
    node('company', 'ARM', 'company', null),
    node('sales', 'المبيعات', 'department', 'company', { managerUserId: 'uBoss' }),
    node('teamA', 'الفريق أ', 'team', 'sales', { managerUserId: 'uBoss' }),
    node('teamC', 'الفريق ج', 'team', 'sales'),
    node('hr', 'الموارد البشرية', 'department', 'company', { managerUserId: 'uBoss', order: 1 }),
  ];
  const employees: EmployeeLike[] = [
    emp('eSara', 'سارة', 'teamA'),
    emp('eHoda', 'هدى', 'teamC'),
    emp('eKarim', 'كريم', 'sales'),
    emp('eMona', 'منى', 'hr'),
    emp('eNour', 'نور', 'hr'),
    emp('eGhost', 'شبح', 'teamA', { status: 'archived' }),
    emp('eDangling', 'معلق', 'missingNode'),
    emp('eNone', 'بلا عقدة', null),
  ];
  return { nodes, employees };
}

const MANAGED = ['sales', 'teamA', 'hr'];

function build(employees: EmployeeLike[] = fixture().employees, maxMembers = Number.MAX_SAFE_INTEGER) {
  const { nodes } = fixture();
  const index = buildOrgIndex(nodes);
  const managed = nodes.filter((n) => MANAGED.includes(n.id));
  return buildResponsibleTeamViewModel(index, managed, employees, maxMembers);
}

describe('responsible-team view model — §PROFILE-TEAM', () => {
  it('deduplicates employees reached through nested managed relationships (deepest managed node wins)', () => {
    const vm = build();

    // سارة sits on teamA (managed) nested inside sales (managed) —
    // the OLD flat-set + per-team-subtree rendering showed her twice.
    const saraRows = vm.members.filter((m) => m.ref.id === 'eSara');
    assert.equal(saraRows.length, 1, 'each employee appears exactly once');
    assert.equal(saraRows[0].nodeId, 'teamA', 'grouped under the deepest managed node');
    assert.equal(saraRows[0].isDirect, true, 'attached to a node the user manages themselves');
  });

  it('groups unmanaged-branch employees under the enclosing managed node without marking them direct', () => {
    const vm = build();

    const hoda = vm.members.find((m) => m.ref.id === 'eHoda')!;
    assert.equal(hoda.nodeId, 'sales', 'teamC is unmanaged → rolls up to the managed department');
    assert.equal(hoda.isDirect, false, 'subtree co-membership is NOT direct management');

    const karim = vm.members.find((m) => m.ref.id === 'eKarim')!;
    assert.equal(karim.nodeId, 'sales');
    assert.equal(karim.isDirect, true, 'attached to the managed department itself');
  });

  it('derives every count from the ONE canonical collection (headline = Σ groups = rows)', () => {
    const vm = build();

    assert.equal(vm.members.length, 5, 'archived/dangling/unassigned employees excluded');
    assert.equal(vm.totalCount, vm.members.length);
    assert.equal(vm.groups.reduce((sum, g) => sum + g.memberCount, 0), vm.totalCount);
    assert.equal(vm.groups.reduce((sum, g) => sum + g.directCount, 0), vm.totalDirectCount);

    for (const g of vm.groups) {
      const rows = vm.members.filter((m) => m.nodeId === g.node.id);
      assert.equal(g.memberCount, rows.length, `group ${g.node.id} count equals rendered rows`);
      assert.equal(g.directCount, rows.filter((m) => m.isDirect).length);
    }
    // sales = كريم (direct) + هدى (indirect); teamA = سارة; hr = منى + نور
    assert.deepEqual(vm.groups.map((g) => [g.node.id, g.memberCount, g.directCount]), [
      ['sales', 2, 1],
      ['teamA', 1, 1],
      ['hr', 2, 2],
    ]);
  });

  it('orders groups by the canonical Organization Tree and members direct-first then Arabic name', () => {
    const vm = build();

    assert.deepEqual(vm.groups.map((g) => g.node.id), ['sales', 'teamA', 'hr']);

    const salesRows = vm.members.filter((m) => m.nodeId === 'sales');
    assert.deepEqual(salesRows.map((m) => m.ref.id), ['eKarim', 'eHoda'], 'direct report first');

    const hrNames = vm.members.filter((m) => m.nodeId === 'hr').map((m) => m.ref.name);
    assert.deepEqual(hrNames, ['منى', 'نور'], 'Arabic locale-aware ascending');
  });

  it('excludes archived employees but keeps inactive ones listed', () => {
    const { nodes } = fixture();
    const index = buildOrgIndex(nodes);
    const managed = nodes.filter((n) => MANAGED.includes(n.id));
    const employees: EmployeeLike[] = [
      emp('eActive', 'فعال', 'teamA'),
      emp('eInactive', 'موقوف', 'teamA', { status: 'inactive' }),
      emp('eArchived', 'مؤرشف', 'teamA', { status: 'archived' }),
    ];
    const vm = buildResponsibleTeamViewModel(index, managed, employees);
    assert.deepEqual(vm.members.map((m) => m.ref.id), ['eActive', 'eInactive']);
    assert.equal(vm.totalCount, 2);
  });

  it('keeps all numbers consistent with the rows when the member cap applies', () => {
    const vm = build(undefined, 3);
    assert.equal(vm.members.length, 3);
    assert.equal(vm.totalCount, 3);
    assert.equal(vm.groups.reduce((sum, g) => sum + g.memberCount, 0), 3);
  });

  it('is deterministic — the same inputs produce the identical view model', () => {
    assert.deepEqual(build(), build());
  });

  it('handles a user with no managed nodes', () => {
    const { nodes } = fixture();
    const index = buildOrgIndex(nodes);
    const vm = buildResponsibleTeamViewModel(index, [], fixture().employees);
    assert.equal(vm.totalCount, 0);
    assert.equal(vm.totalDirectCount, 0);
    assert.deepEqual(vm.groups, []);
  });
});
