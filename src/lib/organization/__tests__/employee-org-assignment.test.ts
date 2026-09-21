// ══════════════════════════════════════════════════════════════
//  Employee ↔ Organization assignment — pure helper contract
//  (Qnlys milestone: org-aware employee form + workforce strength)
//
//  Covers the focused test plan §20 items that are pure graph
//  semantics:
//    • department suggestions come from existing department nodes
//    • team suggestions are restricted to the department's subtree
//      (nested subteams preserved — never flattened)
//    • archived org nodes are rejected as assignment targets
//    • department-only assignment is a first-class outcome
//    • display names derive from the organization node
//    • archived/inactive employees never inflate workforce strength
//    • an employee is counted ONCE (single canonical orgNodeId —
//      dedup is by record identity, never by name)
//    • restoring an employee returns them to the current roster
//      automatically (orgNodeId untouched by lifecycle)
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOrgAssignmentTarget,
  resolveDepartmentDisplayName,
  teamNodeIdsInDepartment,
  isTeamInDepartment,
  projectAssignmentForPicker,
  buildNodePathLabel,
  buildOrgIndex,
  buildOrgTree,
  groupEmployeesByNode,
  filterCurrentEmployees,
  type OrgNode,
} from '@/lib/organization';

function node(
  id: string,
  name: string,
  type: OrgNode['type'],
  parentId: string | null,
  extra: Partial<OrgNode> = {},
): OrgNode {
  return {
    id, name, type, parentId,
    managerUserId: null, managerUserName: null,
    status: 'active', order: 0, description: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

/** Reference fixture:
 *  company (ARM)
 *  └── quality (department "قسم مراقبة الجودة")
 *      ├── qaTeam (team "فريق ضمان الجودة")
 *      │   └── qaSub (subteam "الفريق الفرعي للجودة")
 *      └── qcTeam (team "فريق مراقبة الجودة")
 *  └── sales (department "المبيعات")
 *      └── salesTeam (team "فريق المبيعات")
 *  orphanTeam — team hanging directly off nothing resolvable (root)
 */
function fixture(): OrgNode[] {
  return [
    node('company', 'ARM', 'company', null),
    node('quality', 'قسم مراقبة الجودة', 'department', 'company'),
    node('qaTeam', 'فريق ضمان الجودة', 'team', 'quality'),
    node('qaSub', 'الفريق الفرعي للجودة', 'subteam', 'qaTeam'),
    node('qcTeam', 'فريق مراقبة الجودة', 'team', 'quality'),
    node('sales', 'المبيعات', 'department', 'company'),
    node('salesTeam', 'فريق المبيعات', 'team', 'sales'),
    node('archivedDept', 'قسم مؤرشف', 'department', 'company', { status: 'archived' }),
    node('orphanTeam', 'فريق يتيم', 'team', null),
  ];
}

// ── §20.1 — department suggestions come from existing org nodes ──
describe('assignment targets (validateOrgAssignmentTarget)', () => {
  it('accepts an existing active node and returns it', () => {
    const result = validateOrgAssignmentTarget(fixture(), 'qaTeam');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.node.id, 'qaTeam');
  });

  it('rejects a node that does not exist (server authoritative — no silent creation)', () => {
    const result = validateOrgAssignmentTarget(fixture(), 'does-not-exist');
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /غير موجودة/);
  });

  it('rejects an archived node as an assignment target', () => {
    const result = validateOrgAssignmentTarget(fixture(), 'archivedDept');
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /مؤرشفة/);
  });
});

// ── §20.2 — team suggestions restricted to department descendants ──
describe('dependent team options (teamNodeIdsInDepartment / isTeamInDepartment)', () => {
  it('lists only team/subteam nodes inside the department subtree — nested subteams preserved', () => {
    const ids = teamNodeIdsInDepartment(fixture(), 'quality');
    assert.deepEqual(ids.sort(), ['qaSub', 'qaTeam', 'qcTeam'].sort());
  });

  it('excludes the department itself and other departments', () => {
    const ids = teamNodeIdsInDepartment(fixture(), 'quality');
    assert.ok(!ids.includes('quality'));
    assert.ok(!ids.includes('sales'));
    assert.ok(!ids.includes('salesTeam'));
  });

  it('unknown department → empty options', () => {
    assert.deepEqual(teamNodeIdsInDepartment(fixture(), 'nope'), []);
  });

  it('a team from ANOTHER department is not a valid team for this department', () => {
    assert.equal(isTeamInDepartment(fixture(), 'quality', 'salesTeam'), false);
  });

  it('a team inside the department subtree is valid', () => {
    assert.equal(isTeamInDepartment(fixture(), 'quality', 'qaSub'), true);
  });

  it('department-only assignment: the department id counts as its own "team" target', () => {
    assert.equal(isTeamInDepartment(fixture(), 'quality', 'quality'), true);
  });
});

// ── display names derive from the organization node ──
describe('display name derivation (resolveDepartmentDisplayName)', () => {
  it('department node → its own name', () => {
    assert.equal(resolveDepartmentDisplayName(fixture(), 'quality'), 'قسم مراقبة الجودة');
  });

  it('team node → the parent department name', () => {
    assert.equal(resolveDepartmentDisplayName(fixture(), 'qaTeam'), 'قسم مراقبة الجودة');
  });

  it('nested subteam → the nearest DEPARTMENT ancestor (not the intermediate team)', () => {
    assert.equal(resolveDepartmentDisplayName(fixture(), 'qaSub'), 'قسم مراقبة الجودة');
  });

  it('team without a department ancestor falls back to its own name', () => {
    assert.equal(resolveDepartmentDisplayName(fixture(), 'orphanTeam'), 'فريق يتيم');
  });

  it('unknown node → null', () => {
    assert.equal(resolveDepartmentDisplayName(fixture(), 'nope'), null);
  });
});

// ── edit-dialog projection of the canonical pointer ──
describe('picker projection (projectAssignmentForPicker)', () => {
  it('null orgNodeId → empty picker (unassigned)', () => {
    assert.deepEqual(projectAssignmentForPicker(fixture(), null), { departmentId: null, teamNodeId: null });
  });

  it('team assignment → (department, team) pair', () => {
    assert.deepEqual(projectAssignmentForPicker(fixture(), 'qaTeam'), {
      departmentId: 'quality',
      teamNodeId: 'qaTeam',
    });
  });

  it('department-only assignment → (department, no team)', () => {
    assert.deepEqual(projectAssignmentForPicker(fixture(), 'quality'), {
      departmentId: 'quality',
      teamNodeId: null,
    });
  });

  it('company node projects no department (assigned outside any department)', () => {
    assert.deepEqual(projectAssignmentForPicker(fixture(), 'company'), {
      departmentId: null,
      teamNodeId: null,
    });
  });
});

describe('suggestion path labels (buildNodePathLabel)', () => {
  it('joins the department → team → subteam chain (nearest-first display, capped)', () => {
    assert.equal(
      buildNodePathLabel(fixture(), 'qaSub'),
      'قسم مراقبة الجودة › فريق ضمان الجودة › الفريق الفرعي للجودة',
    );
  });
});

// ── §20.10/§20.11/§20.12 — workforce strength semantics ──
describe('workforce strength from canonical assignments', () => {
  const employees = [
    { id: 'e1', name: 'أحمد', orgNodeId: 'qaTeam', status: 'active' },
    { id: 'e2', name: 'محمد', orgNodeId: 'qaTeam', status: 'active' },
    { id: 'e3', name: 'علي', orgNodeId: 'qaSub', status: 'active' },
    { id: 'e4', name: 'عمر', orgNodeId: 'quality', status: 'active' }, // department-only
    { id: 'e5', name: 'مؤرشف', orgNodeId: 'qaTeam', status: 'archived' }, // must NOT inflate
    { id: 'e6', name: 'غير نشط', orgNodeId: 'quality', status: 'inactive' }, // must NOT inflate
    { id: 'e7', name: 'بلا عقدة', orgNodeId: null, status: 'active' },
  ];

  it('archived/inactive employees are excluded from current node counts', () => {
    const byNode = groupEmployeesByNode(filterCurrentEmployees(employees));
    assert.equal((byNode.get('qaTeam') ?? []).length, 2); // e5 archived excluded
    assert.equal((byNode.get('quality') ?? []).length, 1); // e4 only (e6 inactive excluded)
  });

  it('each employee is counted exactly once — at its own canonical node', () => {
    const byNode = groupEmployeesByNode(filterCurrentEmployees(employees));
    const total = [...byNode.values()].reduce((sum, ids) => sum + ids.length, 0);
    const assignedCurrent = employees.filter((e) => e.orgNodeId && e.status === 'active').length;
    assert.equal(total, assignedCurrent);
    // Identity-based: the same human appearing twice under DIFFERENT
    // records would be two employees; one record can only appear once
    // because the map buckets by its single orgNodeId.
    const allIds = [...byNode.values()].flat();
    assert.equal(new Set(allIds).size, allIds.length);
  });

  it('subtree counts roll up through nested subteams without double counting', () => {
    const index = buildOrgIndex(fixture());
    const byNode = groupEmployeesByNode(filterCurrentEmployees(employees));
    const tree = buildOrgTree(index, byNode);
    const company = tree.find((n) => n.id === 'company')!;
    const quality = company.children.find((n) => n.id === 'quality')!;
    // direct: e4 (department-only) — archived e5 and inactive e6 excluded
    assert.equal(quality.employeeCount, 1);
    // subtree: e1,e2 (qaTeam) + e3 (qaSub) + e4 (quality)
    assert.equal(quality.subtreeEmployeeCount, 4);
    const qaTeam = quality.children.find((c) => c.id === 'qaTeam')!;
    assert.equal(qaTeam.employeeCount, 2);
    assert.equal(qaTeam.subtreeEmployeeCount, 3); // e1,e2 + e3 in qaSub
  });

  it('restoring an archived employee returns them to the current roster automatically (orgNodeId untouched)', () => {
    const restored = employees.map((e) =>
      e.id === 'e5' ? { ...e, status: 'active' } : e,
    );
    const byNode = groupEmployeesByNode(filterCurrentEmployees(restored));
    assert.equal((byNode.get('qaTeam') ?? []).length, 3);
  });
});
