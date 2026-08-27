// ══════════════════════════════════════════════════════════════
//  M0.6-A — Organization lifecycle & relationship normalization
//
//  Covers the phase test plan:
//    • employee lifecycle vocabulary (legacy default = active)
//    • membership event derivation (joined/transferred/unassigned)
//    • integrity classifiers: employee→node, user↔employee links,
//      duplicate claims, dangling parents, cycle quarantine
//    • legacy department-name dry-run mapping (unique/ambiguous/
//      unresolved — ambiguous is NEVER auto-resolved)
//    • historical reference integrity (no fabricated identities)
//    • fail-closed scope doctrine UNCHANGED by the new fields
//
//  Run: npx tsx --test src/lib/organization/__tests__/m06-organization.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EMPLOYEE_STATUS,
  isValidEmployeeStatus,
  normalizeEmployeeStatus,
  MEMBERSHIP_EVENT_KINDS,
  buildMembershipEvent,
  deriveMembershipKind,
  classifyEmployeeNodeReferences,
  classifyUserEmployeeLinks,
  findDuplicateEmployeeLinks,
  findDanglingNodeParents,
  findCycleQuarantinedNodes,
  buildLegacyDepartmentNameMapping,
  classifyHistoricalEmployeeReferences,
  buildOrgIndex,
  type OrgNode,
} from '@/lib/organization';
import { resolveEmployeeScope } from '@/lib/scope';

function node(
  id: string,
  name: string,
  type: OrgNode['type'],
  parentId: string | null,
  extra: Partial<OrgNode> = {},
): OrgNode {
  return {
    id,
    name,
    type,
    parentId,
    managerUserId: null,
    managerUserName: null,
    status: 'active',
    order: 0,
    description: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

describe('M0.6-A employee lifecycle vocabulary', () => {
  it('accepts exactly the three canonical states and rejects everything else', () => {
    assert.equal(isValidEmployeeStatus('active'), true);
    assert.equal(isValidEmployeeStatus('inactive'), true);
    assert.equal(isValidEmployeeStatus('archived'), true);
    assert.equal(isValidEmployeeStatus('Active'), false); // case-sensitive
    assert.equal(isValidEmployeeStatus('deleted'), false);
    assert.equal(isValidEmployeeStatus(null), false);
    assert.equal(isValidEmployeeStatus(undefined), false);
    assert.equal(isValidEmployeeStatus(42), false);
  });

  it('legacy employees (absent/garbage status) read as active — no migration needed', () => {
    assert.equal(normalizeEmployeeStatus(undefined), 'active');
    assert.equal(normalizeEmployeeStatus(null), 'active');
    assert.equal(normalizeEmployeeStatus(''), 'active');
    assert.equal(normalizeEmployeeStatus('zombie'), 'active');
    assert.equal(normalizeEmployeeStatus('inactive'), 'inactive');
    assert.equal(normalizeEmployeeStatus('archived'), 'archived');
  });

  it('the creation default is active', () => {
    assert.equal(DEFAULT_EMPLOYEE_STATUS, 'active');
  });
});

describe('M0.6-A membership events (append-only ledger)', () => {
  it('derives joined / transferred / unassigned from the before-after pair', () => {
    assert.equal(deriveMembershipKind(null, 'teamA'), 'joined');
    assert.equal(deriveMembershipKind('teamA', 'teamB'), 'transferred');
    assert.equal(deriveMembershipKind('teamA', null), 'unassigned');
    assert.equal(deriveMembershipKind(null, null), 'unassigned'); // defensive
  });

  it('builds an immutable event carrying both endpoints and the actor', () => {
    const event = buildMembershipEvent({
      employeeId: 'emp1',
      employeeName: 'أحمد',
      previousNodeId: 'teamA',
      nextNodeId: 'teamB',
      actorUserId: 'admin1',
    });
    assert.equal(event.kind, 'transferred');
    assert.equal(event.employeeId, 'emp1');
    assert.equal(event.previousNodeId, 'teamA');
    assert.equal(event.nodeId, 'teamB');
    assert.equal(event.actorUserId, 'admin1');
    assert.ok(typeof event.createdAt === 'string' && event.createdAt.length > 0);
    assert.ok(MEMBERSHIP_EVENT_KINDS.includes(event.kind));
  });

  it('never fabricates an employee identity', () => {
    assert.throws(() =>
      buildMembershipEvent({
        employeeId: '',
        previousNodeId: null,
        nextNodeId: 'teamA',
      }),
    );
  });
});

describe('M0.6-A integrity — employee → org node', () => {
  const nodes = new Map<string, { id: string; status: string }>([
    { id: 'teamA', status: 'active' },
    { id: 'teamZ', status: 'archived' },
  ].map((n) => [n.id, n as any]));

  it('classifies VALID / ORPHAN / MISSING / INACTIVE_REFERENCE', () => {
    const findings = classifyEmployeeNodeReferences(
      [
        { id: 'e1', orgNodeId: 'teamA' },
        { id: 'e2', orgNodeId: null },
        { id: 'e3', orgNodeId: 'ghost' },
        { id: 'e4', orgNodeId: 'teamZ' },
      ],
      nodes as Map<string, any>,
    );
    const by = Object.fromEntries(findings.map((f) => [f.subjectId, f.status]));
    assert.equal(by.e1, 'VALID');
    assert.equal(by.e2, 'ORPHAN');
    assert.equal(by.e3, 'MISSING');
    assert.equal(by.e4, 'INACTIVE_REFERENCE');
  });
});

describe('M0.6-A integrity — user ↔ employee link', () => {
  const employeeIds = new Set(['emp1', 'emp2']);

  it('dangling links classify MISSING; unlinked accounts are legitimate (not findings)', () => {
    const findings = classifyUserEmployeeLinks(
      [
        { id: 'u1', linkedEmployeeId: 'emp1' },
        { id: 'u2', linkedEmployeeId: 'ghost' },
        { id: 'u3', linkedEmployeeId: null },
      ],
      employeeIds,
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].subjectId, 'u2');
    assert.equal(findings[0].status, 'MISSING');
  });

  it('duplicate claims on one employee surface as AMBIGUOUS candidates', () => {
    const dupes = findDuplicateEmployeeLinks([
      { id: 'u1', linkedEmployeeId: 'emp1' },
      { id: 'u2', linkedEmployeeId: 'emp1' },
      { id: 'u3', linkedEmployeeId: 'emp2' },
    ]);
    assert.equal(dupes.length, 1);
    assert.deepEqual(dupes[0].holderUserIds.sort(), ['u1', 'u2']);
  });
});

describe('M0.6-A integrity — structure', () => {
  it('detects dangling parent references', () => {
    const nodesById = new Map<string, any>([
      ['a', { id: 'a', parentId: null }],
      ['b', { id: 'b', parentId: 'ghost' }],
    ]);
    const dangling = findDanglingNodeParents(nodesById);
    assert.equal(dangling.length, 1);
    assert.equal(dangling[0].nodeId, 'b');
  });

  it('reports cycle members as AMBIGUOUS instead of traversing forever', () => {
    const cyclic = [
      node('a', 'أ', 'team', 'b'),
      node('b', 'ب', 'team', 'a'),
      node('ok', 'سليم', 'team', null),
    ];
    const index = buildOrgIndex(cyclic);
    const members = findCycleQuarantinedNodes(cyclic, index);
    assert.deepEqual(members.sort(), ['a', 'b']);
    // healthy node untouched
    assert.equal(index.depthOf.get('ok'), 0);
  });
});

describe('M0.6-A legacy department-name dry run', () => {
  const departmentNodes = [
    { id: 'd1', name: 'المبيعات' },
    { id: 'd2', name: 'الجودة' },
    { id: 'd3', name: 'الجودة' }, // duplicate name → ambiguity source
  ];

  it('maps exact-unique names, marks duplicates AMBIGUOUS, leaves unmatched UNRESOLVED', () => {
    const report = buildLegacyDepartmentNameMapping(
      [
        { id: 'e1', department: 'المبيعات' },
        { id: 'e2', department: 'الجودة' },
        { id: 'e3', department: 'الدعم' },
        { id: 'e4', department: '' },
        { id: 'e5', department: null },
      ],
      departmentNodes,
    );
    assert.deepEqual(
      report.proposed.map((p) => p.departmentName),
      ['المبيعات'],
    );
    assert.equal(report.proposed[0].nodeId, 'd1');
    assert.deepEqual(
      report.ambiguous.map((a) => a.departmentName),
      ['الجودة'],
    );
    assert.equal(report.ambiguous[0].candidateNodeIds.length, 2); // never auto-picked
    assert.deepEqual(
      report.unresolved.map((u) => u.departmentName),
      ['الدعم'],
    );
    assert.equal(report.blankCount, 2);
  });
});

describe('M0.6-A historical reference integrity', () => {
  it('reports dangling employee references per table without inventing identities', () => {
    const report = classifyHistoricalEmployeeReferences(
      {
        attendance: [{ employeeId: 'emp1' }, { employeeId: 'ghost' }],
        complaints: [{ employeeId: 'ghost' }, { employeeId: null }, {}],
        travelDeals: [{ employeeId: 'emp2' }],
      },
      new Set(['emp1', 'emp2']),
    );
    assert.equal(report.totalMissingDistinct, 1);
    assert.equal(report.missingByTable.length, 2);
    const tables = report.missingByTable.map((t) => t.table).sort();
    assert.deepEqual(tables, ['attendance', 'complaints']);
  });
});

describe('M0.6-A — canonical scope doctrine unchanged', () => {
  const orgNodes = [
    node('company', 'ARM', 'company', null),
    node('sales', 'المبيعات', 'department', 'company', { managerUserId: 'uManager' }),
    node('teamA', 'الفريق أ', 'team', 'sales'),
  ];
  const employees = [
    // M0.6-A: status field present — must not alter scope membership
    { id: 'empActive', orgNodeId: 'teamA' },
    { id: 'empInactive', orgNodeId: 'teamA' },
    { id: 'empOutside', orgNodeId: null },
  ];

  const resolve = (viewer: { userId: string; role: string; linkedEmployeeId?: string | null }) =>
    resolveEmployeeScope(
      viewer,
      'employees',
      { employees: { level: 'read', scope: 'subtree' } } as any,
      { orgNodes, employees },
    );

  it('a manager subtree still includes every employee in managed nodes (status-blind by design)', () => {
    const ctx = resolve({ userId: 'uManager', role: 'manager' });
    assert.equal(ctx.isUnrestricted, false);
    assert.equal(ctx.includes('empActive'), true);
    assert.equal(ctx.includes('empInactive'), true); // documented M0.6-A limitation
    assert.equal(ctx.includes('empOutside'), false);
  });

  it('unconfigured managers still resolve an empty set (no managed nodes, no link = invisible)', () => {
    const ctx = resolve({ userId: 'uNobody', role: 'user' });
    assert.equal(ctx.isUnrestricted, false);
    assert.equal(ctx.employeeIds.size, 0);
    assert.equal(ctx.includes('empActive'), false);
  });

  it('own scope still resolves through the linked employee anchor', () => {
    const ctx = resolve({ userId: 'uSelf', role: 'user', linkedEmployeeId: 'empActive' });
    assert.equal(ctx.scope, 'subtree');
    assert.equal(ctx.includes('empActive'), true);
    assert.equal(ctx.includes('empOutside'), false);
  });
});
