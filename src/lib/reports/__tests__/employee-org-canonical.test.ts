// ══════════════════════════════════════════════════════════════
//  Org-tree migration — CANONICAL employee organization regression
//  (spec §27: legacy/new parity, rename, transfer, dangling node,
//   fail-closed unavailable state, full organization context)
//
//  Pure resolver tests — the same rules every consuming surface
//  (Employees page, Employee 360, reports, Performance Hub, search,
//  exports) inherits through lib/reports/employee-org.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEmployeeOrgIndex,
  resolveEmployeeOrgLabels,
  resolveEmployeeOrgLabelsMap,
  resolveEmployeeOrganizationContext,
} from '../employee-org';
import type { OrgNode } from '@/lib/organization/types';

const node = (overrides: Partial<OrgNode> & { id: string; name: string; type: OrgNode['type'] }): OrgNode =>
  ({
    parentId: null,
    managerUserId: null,
    managerUserName: null,
    status: 'active',
    order: 0,
    description: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }) as OrgNode;

// GA-rooted tree (the production shape: company-typed GA root whose
// subtree holds the real company) + a root-hung team for edge cases.
const TREE: OrgNode[] = [
  node({ id: 'ga', name: 'الإدارة العامة', type: 'company', order: 0 }),
  node({ id: 'companyA', name: 'شركة أ', type: 'company', parentId: 'ga', order: 1 }),
  node({ id: 'deptSales', name: 'قسم المبيعات', type: 'department', parentId: 'companyA', managerUserId: 'mgr-ayman', managerUserName: 'أيمن', order: 2 }),
  node({ id: 'teamAyman', name: "فريق أيمن", type: 'team', parentId: 'deptSales', managerUserId: 'mgr-ayman', managerUserName: 'أيمن', order: 3 }),
  node({ id: 'subAyman', name: 'الفريق الفرعي', type: 'subteam', parentId: 'teamAyman', order: 4 }),
  node({ id: 'rootHungTeam', name: 'فريق معلق بالجذر', type: 'team', parentId: 'ga', order: 5 }),
];

const index = () => buildEmployeeOrgIndex(TREE);

const employee = (overrides: { id?: string; department?: string | null; orgNodeId?: string | null }) => ({
  id: overrides.id ?? 'e1',
  name: 'موظف',
  code: '001',
  department: overrides.department ?? null,
  orgNodeId: overrides.orgNodeId ?? null,
});

describe('§27 canonical organization resolution', () => {
  it('legacy employee with a MISMATCHED stored string shows the tree node', () => {
    const labels = resolveEmployeeOrgLabels(index(), employee({ department: 'قسم قديم', orgNodeId: 'teamAyman' }));
    assert.equal(labels.department, 'قسم المبيعات');
    assert.equal(labels.team, 'فريق أيمن');
    assert.equal(labels.orgUnavailable, false);
  });

  it('new employee (no stored string) resolves purely from the tree', () => {
    const labels = resolveEmployeeOrgLabels(index(), employee({ department: null, orgNodeId: 'teamAyman' }));
    assert.equal(labels.department, 'قسم المبيعات');
    assert.equal(labels.team, 'فريق أيمن');
  });

  it('legacy + new employees on the SAME node display IDENTICAL labels', () => {
    const legacy = resolveEmployeeOrgLabels(index(), employee({ department: 'أي فريق قديم', orgNodeId: 'subAyman' }));
    const fresh = resolveEmployeeOrgLabels(index(), employee({ department: null, orgNodeId: 'subAyman' }));
    assert.deepEqual(legacy, fresh);
    // subteam rolls up to the team label
    assert.equal(legacy.team, 'فريق أيمن');
    assert.equal(legacy.department, 'قسم المبيعات');
  });

  it('RENAMING a node updates every employee display without touching records', () => {
    const renamed = TREE.map((n) => (n.id === 'teamAyman' ? { ...n, name: 'فريق أيمن المعدل' } : n));
    const labels = resolveEmployeeOrgLabels(buildEmployeeOrgIndex(renamed), employee({ department: 'فريق أيمن', orgNodeId: 'teamAyman' }));
    assert.equal(labels.team, 'فريق أيمن المعدل');
    assert.equal(labels.department, 'قسم المبيعات');
  });

  it('TRANSFER: changing orgNodeId moves the display immediately', () => {
    const before = resolveEmployeeOrgLabels(index(), employee({ department: 'قسم المبيعات', orgNodeId: 'teamAyman' }));
    const after = resolveEmployeeOrgLabels(index(), employee({ department: 'قسم المبيعات', orgNodeId: 'rootHungTeam' }));
    assert.equal(before.team, 'فريق أيمن');
    assert.equal(after.team, 'فريق معلق بالجذر');
  });

  it('node WITHOUT a department ancestor falls back to the node itself (creation rule)', () => {
    const labels = resolveEmployeeOrgLabels(index(), employee({ department: null, orgNodeId: 'rootHungTeam' }));
    assert.equal(labels.department, 'فريق معلق بالجذر');
    assert.equal(labels.team, 'فريق معلق بالجذر');
  });

  it('DANGLING orgNodeId → controlled unavailable state, never the legacy string', () => {
    const labels = resolveEmployeeOrgLabels(index(), employee({ department: 'قسم قديم', orgNodeId: 'deleted-node' }));
    assert.equal(labels.department, null);
    assert.equal(labels.team, null);
    assert.equal(labels.orgUnavailable, true);
  });

  it('unassigned employee keeps the stored string (legacy compatibility)', () => {
    const labels = resolveEmployeeOrgLabels(index(), employee({ department: 'المبيعات', orgNodeId: null }));
    assert.equal(labels.department, 'المبيعات');
    assert.equal(labels.team, null);
    assert.equal(labels.orgUnavailable, false);
  });

  it('batch map resolves the same labels as single resolution', () => {
    const employees = [
      employee({ id: 'a', department: 'قسم قديم', orgNodeId: 'teamAyman' }),
      employee({ id: 'b', department: 'قسم قديم', orgNodeId: 'deleted-node' }),
      employee({ id: 'c', department: 'المبيعات', orgNodeId: null }),
    ];
    const map = resolveEmployeeOrgLabelsMap(index(), employees);
    assert.equal(map.get('a')?.department, 'قسم المبيعات');
    assert.equal(map.get('b')?.orgUnavailable, true);
    assert.equal(map.get('c')?.department, 'المبيعات');
  });
});

describe('§27 organization context (headers: 360 / Performance Hub)', () => {
  it('company resolves from the DERIVED level — a GA root is not "the company"', () => {
    const ctx = resolveEmployeeOrganizationContext(index(), employee({ orgNodeId: 'teamAyman' }));
    // nearest semantic company under the GA root
    assert.equal(ctx.company, 'شركة أ');
    assert.equal(ctx.department, 'قسم المبيعات');
    assert.equal(ctx.team, 'فريق أيمن');
    assert.equal(ctx.subteam, null);
    assert.equal(ctx.nodeLevel, 'team');
    assert.equal(ctx.managerUserId, 'mgr-ayman');
    assert.equal(ctx.managerUserName, 'أيمن');
    assert.deepEqual(ctx.path, ['الإدارة العامة', 'شركة أ', 'قسم المبيعات', 'فريق أيمن']);
  });

  it('subteam level and subteam label resolve from tree metadata', () => {
    const ctx = resolveEmployeeOrganizationContext(index(), employee({ orgNodeId: 'subAyman' }));
    assert.equal(ctx.nodeLevel, 'subteam');
    assert.equal(ctx.subteam, 'الفريق الفرعي');
    assert.equal(ctx.team, 'فريق أيمن');
    assert.equal(ctx.company, 'شركة أ');
  });

  it('unassigned context keeps the legacy string and reports no node', () => {
    const ctx = resolveEmployeeOrganizationContext(index(), employee({ department: 'المبيعات', orgNodeId: null }));
    assert.equal(ctx.orgNodeId, null);
    assert.equal(ctx.node, null);
    assert.equal(ctx.company, null);
    assert.equal(ctx.department, 'المبيعات');
    assert.equal(ctx.orgUnavailable, false);
  });

  it('dangling context is unavailable without weakening anything', () => {
    const ctx = resolveEmployeeOrganizationContext(index(), employee({ department: 'قسم قديم', orgNodeId: 'ghost' }));
    assert.equal(ctx.orgUnavailable, true);
    assert.equal(ctx.department, null);
    assert.equal(ctx.company, null);
    assert.deepEqual(ctx.path, []);
  });
});
