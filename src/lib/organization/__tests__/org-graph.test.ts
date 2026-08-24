// ══════════════════════════════════════════════════════════════
//  Milestone 10 — Organization graph engine
//
//  Covers (milestone test plan A + G):
//    • parent/child structure and nesting
//    • subtree / ancestor resolution
//    • move validation (cycle, self, archived parent, depth)
//    • manager chain (reporting hierarchy)
//    • employee membership + movement between nodes
//    • impact preview counts
//    • HISTORICAL INTEGRITY: an employee move patch touches ONLY
//      the relationship pointer
//
//  Run: npx tsx --test src/lib/organization/__tests__/org-graph.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrgIndex, subtreeIds, ancestorIds, isDescendantOf, findAncestorOfType,
  validateMoveNode, resolveManagerChain, groupEmployeesByNode,
  employeeIdsInSubtree, previewOrgImpact, buildOrgTree, buildEmployeeMovePatch,
  MAX_ORG_DEPTH, type OrgNode, type OrgEmployeeRef,
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

/** Reference fixture:
 *  company
 *  └── sales (department, manager: uSales)
 *      ├── teamA (team)
 *      │   ├── subA1 (subteam)
 *      │   └── [emp Ahmed, emp Mohamed]
 *      └── teamB (team, manager: uTeamB)
 *          └── [emp Ali, emp Omar]
 *  └── quality (department)
 *      └── qualityTeam (team, manager: uQuality)
 */
function fixture() {
  const nodes: OrgNode[] = [
    node('company', 'ARM', 'company', null),
    node('sales', 'المبيعات', 'department', 'company', { managerUserId: 'uSales' }),
    node('teamA', 'الفريق أ', 'team', 'sales'),
    node('subA1', 'فريق فرعي', 'subteam', 'teamA'),
    node('teamB', 'الفريق ب', 'team', 'sales', { managerUserId: 'uTeamB' }),
    node('quality', 'الجودة', 'department', 'company'),
    node('qualityTeam', 'فريق الجودة', 'team', 'quality', { managerUserId: 'uQuality' }),
  ];
  const employees: OrgEmployeeRef[] = [
    { id: 'empAhmed', name: 'أحمد', orgNodeId: 'teamA' },
    { id: 'empMohamed', name: 'محمد', orgNodeId: 'subA1' },
    { id: 'empAli', name: 'علي', orgNodeId: 'teamB' },
    { id: 'empOmar', name: 'عمر', orgNodeId: 'teamB' },
    { id: 'empUnassigned', name: 'بدون عقدة', orgNodeId: null },
  ];
  return { nodes, employees };
}

describe('organization graph — structure', () => {
  it('builds parent/child index with ordered traversal', () => {
    const { nodes } = fixture();
    const index = buildOrgIndex(nodes);
    assert.equal(index.byId.size, 7);
    assert.deepEqual(index.childrenOf.get(null), ['company']);
    assert.deepEqual(index.childrenOf.get('sales'), ['teamA', 'teamB']);
    assert.equal(index.depthOf.get('company'), 0);
    assert.equal(index.depthOf.get('subA1'), 3);
    // preorder: company before sales before teamA before subA1
    assert.ok(index.orderedIds.indexOf('company') < index.orderedIds.indexOf('sales'));
    assert.ok(index.orderedIds.indexOf('teamA') < index.orderedIds.indexOf('subA1'));
  });

  it('subtreeIds includes self and all descendants', () => {
    const index = buildOrgIndex(fixture().nodes);
    assert.deepEqual([...subtreeIds(index, 'sales')].sort(), ['sales', 'subA1', 'teamA', 'teamB']);
    assert.deepEqual([...subtreeIds(index, 'subA1')], ['subA1']);
    assert.equal(subtreeIds(index, 'missing').size, 0);
  });

  it('ancestorIds walks root-first without self', () => {
    const index = buildOrgIndex(fixture().nodes);
    assert.deepEqual(ancestorIds(index, 'subA1'), ['company', 'sales', 'teamA']);
    assert.deepEqual(ancestorIds(index, 'company'), []);
  });

  it('isDescendantOf detects subtree membership both ways', () => {
    const index = buildOrgIndex(fixture().nodes);
    assert.equal(isDescendantOf(index, 'subA1', 'sales'), true);
    assert.equal(isDescendantOf(index, 'sales', 'subA1'), false);
    assert.equal(isDescendantOf(index, 'sales', 'sales'), false);
  });

  it('findAncestorOfType finds nearest typed ancestor (self counts)', () => {
    const index = buildOrgIndex(fixture().nodes);
    assert.equal(findAncestorOfType(index, 'subA1', 'team')?.id, 'teamA');
    assert.equal(findAncestorOfType(index, 'subA1', 'department')?.id, 'sales');
    assert.equal(findAncestorOfType(index, 'qualityTeam', 'department')?.id, 'quality');
    assert.equal(findAncestorOfType(index, 'company', 'department'), null);
  });

  it('quarantines cycles instead of throwing (dirty data safety)', () => {
    const cyclic: OrgNode[] = [
      node('a', 'A', 'department', 'b'),
      node('b', 'B', 'team', 'a'),
    ];
    const index = buildOrgIndex(cyclic);
    // Cycle members stay unreachable: no roots, no traversal, no
    // infinite recursion — the tree always renders without them.
    assert.deepEqual(index.childrenOf.get(null) ?? [], []);
    assert.deepEqual(index.orderedIds, []);
    assert.equal(index.depthOf.size, 0);
  });
});

describe('organization graph — move validation', () => {
  it('rejects moving a node into its own subtree (cycle)', () => {
    const index = buildOrgIndex(fixture().nodes);
    const result = validateMoveNode(index, 'sales', 'subA1');
    assert.equal(result.ok, false);
  });

  it('rejects self-parent, missing and archived parents', () => {
    const nodes = fixture().nodes;
    const index = buildOrgIndex([...nodes, node('arch', 'مؤرشف', 'team', 'company', { status: 'archived' })]);
    assert.equal(validateMoveNode(index, 'teamA', 'teamA').ok, false);
    assert.equal(validateMoveNode(index, 'teamA', 'ghost').ok, false);
    assert.equal(validateMoveNode(index, 'teamA', 'arch').ok, false);
  });

  it('accepts a legal sibling move', () => {
    const index = buildOrgIndex(fixture().nodes);
    assert.deepEqual(validateMoveNode(index, 'teamA', 'quality'), { ok: true });
  });

  it('enforces the depth guard', () => {
    const chain: OrgNode[] = [node('n0', 'r', 'company', null)];
    for (let i = 1; i <= MAX_ORG_DEPTH; i++) {
      chain.push(node(`n${i}`, `n${i}`, 'subteam', `n${i - 1}`));
    }
    const index = buildOrgIndex(chain);
    // moving the deep tail under the deepest node exceeds the limit
    const result = validateMoveNode(index, 'n1', `n${MAX_ORG_DEPTH}`);
    assert.equal(result.ok, false);
  });
});

describe('organization graph — managers & membership', () => {
  it('resolveManagerChain walks nearest-first up the reporting line', () => {
    const index = buildOrgIndex(fixture().nodes);
    assert.deepEqual(resolveManagerChain(index, 'subA1'), ['uSales']);
    assert.deepEqual(resolveManagerChain(index, 'teamB'), ['uTeamB', 'uSales']);
    assert.deepEqual(resolveManagerChain(index, 'qualityTeam'), ['uQuality']);
    assert.deepEqual(resolveManagerChain(index, 'company'), []);
  });

  it('groups employees by node (relationship-based membership)', () => {
    const { nodes, employees } = fixture();
    const index = buildOrgIndex(nodes);
    const byNode = groupEmployeesByNode(employees);
    assert.deepEqual(byNode.get('teamB'), ['empAli', 'empOmar']);
    assert.deepEqual(employeeIdsInSubtree(index, 'sales', byNode).sort(),
      ['empAhmed', 'empAli', 'empMohamed', 'empOmar']);
    assert.ok(!byNode.has('')); // unassigned employees map to nothing
  });

  it('buildOrgTree aggregates direct + subtree employee counts', () => {
    const { nodes, employees } = fixture();
    const tree = buildOrgTree(buildOrgIndex(nodes), groupEmployeesByNode(employees));
    assert.equal(tree.length, 1);
    const sales = tree[0].children.find((c) => c.id === 'sales')!;
    assert.equal(sales.employeeCount, 0);
    assert.equal(sales.subtreeEmployeeCount, 4);
    const teamB = sales.children.find((c) => c.id === 'teamB')!;
    assert.equal(teamB.employeeCount, 2);
  });
});

describe('organization graph — impact preview', () => {
  it('counts nodes, employees and affected managers before a move', () => {
    const { nodes, employees } = fixture();
    const index = buildOrgIndex(nodes);
    const preview = previewOrgImpact(index, 'teamA', groupEmployeesByNode(employees))!;
    assert.equal(preview.subtreeNodeCount, 2); // teamA + subA1
    assert.equal(preview.employeeCount, 2);    // Ahmed + Mohamed
    // Affected managers: none inside the subtree itself, but uSales
    // (the sales department manager up the chain) loses/gains it.
    assert.deepEqual(preview.managerUserIds, ['uSales']);
  });
});

describe('organization graph — historical integrity', () => {
  it('employee move patch touches ONLY orgNodeId (no department/snapshot rewrites)', () => {
    assert.deepEqual(buildEmployeeMovePatch('teamB'), { orgNodeId: 'teamB' });
    assert.deepEqual(buildEmployeeMovePatch(null), { orgNodeId: null });
    // The patch must never carry display strings or historical fields
    const patch = buildEmployeeMovePatch('qualityTeam') as Record<string, unknown>;
    assert.deepEqual(Object.keys(patch), ['orgNodeId']);
  });
});
