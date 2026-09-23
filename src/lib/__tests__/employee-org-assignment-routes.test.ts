// ══════════════════════════════════════════════════════════════
//  Employee ↔ Organization assignment — ROUTE contracts
//  (Qnlys milestone)
//
//  The REAL route handlers run against the in-memory db stubs:
//    • POST /api/employees accepts a VALIDATED orgNodeId — stores the
//      canonical pointer + the node-derived display department, and
//      appends the 'joined' membership ledger event.
//    • Unknown / archived nodes are REJECTED (server authoritative —
//      client labels are never trusted, no silent node creation).
//    • Legacy creation (no orgNodeId) keeps the free-text department
//      contract (Excel upload / API consumers unchanged).
//    • PUT /api/employees/[id] still REFUSES orgNodeId changes
//      (M0.4 organizational-assignment separation preserved).
//    • POST /api/organization/employees/move remains the privileged
//      transfer path: touches ONLY the pointer, never the display
//      strings; rejects archived targets; stays organization-
//      permission-gated.
//    • GET /api/organization derives CURRENT workforce strength from
//      active employees only; GET /api/employees/org-nodes exposes
//      the minimal selector list.
// ══════════════════════════════════════════════════════════════

import './m01-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerFixtures,
  resetTestData,
  setTable,
  bearerHeaders,
  createdRecords,
  dbStubs,
} from './m01-test-support';
import type { OrgNode } from '@/lib/organization';

function orgNode(
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

function orgFixture(): OrgNode[] {
  // §ORG-LEVELS — GA root mirrors the registerFixtures HR boundary
  // ('ga'); the company hangs beneath it per the canonical structure.
  return [
    orgNode('ga', 'GA', 'general_administration', null),
    orgNode('company', 'ARM', 'company', 'ga'),
    orgNode('quality', 'قسم مراقبة الجودة', 'department', 'company'),
    orgNode('qaTeam', 'فريق ضمان الجودة', 'team', 'quality'),
    orgNode('archivedDept', 'قسم مؤرشف', 'department', 'company', { status: 'archived' }),
  ];
}

interface PostRoute { POST: (req: Request) => Promise<Response> }
interface PutRoute { PUT: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> }
interface MoveRoute { POST: (req: Request) => Promise<Response> }
interface OrgRoute { GET: (req: Request) => Promise<Response> }
interface OrgNodesRoute { GET: (req: Request) => Promise<Response> }

const employeesRoute = {} as PostRoute;
const employeeIdRoute = {} as PutRoute;
const moveRoute = {} as MoveRoute;
const organizationRoute = {} as OrgRoute;
const orgNodesRoute = {} as OrgNodesRoute;

function postEmployee(body: unknown, token: string): Promise<Response> {
  return employeesRoute.POST(
    new Request('http://localhost/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearerHeaders(token) },
      body: JSON.stringify(body),
    }),
  );
}

function putEmployee(id: string, body: unknown, token: string): Promise<Response> {
  return employeeIdRoute.PUT(
    new Request(`http://localhost/api/employees/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...bearerHeaders(token) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function postMove(body: unknown, token: string): Promise<Response> {
  return moveRoute.POST(
    new Request('http://localhost/api/organization/employees/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearerHeaders(token) },
      body: JSON.stringify(body),
    }),
  );
}

function employeeWrites(): Array<Record<string, any>> {
  return createdRecords.filter((r) => r.table === 'employees').map((r) => r.data);
}
function membershipEvents(): Array<Record<string, any>> {
  return createdRecords.filter((r) => r.table === 'membershipEvents').map((r) => r.data);
}

interface Tokens { adminToken: string; hrToken: string; userToken: string }

async function freshWorld(): Promise<Tokens> {
  resetTestData();
  setTable('orgNodes', orgFixture());
  const t = await registerFixtures();
  return { adminToken: t.adminToken, hrToken: t.hrToken, userToken: t.userToken };
}

let tokens: Tokens;
before(async () => {
  Object.assign(employeesRoute, await import('@/app/api/employees/route'));
  Object.assign(employeeIdRoute, await import('@/app/api/employees/[id]/route'));
  Object.assign(moveRoute, await import('@/app/api/organization/employees/move/route'));
  Object.assign(organizationRoute, await import('@/app/api/organization/route'));
  Object.assign(orgNodesRoute, await import('@/app/api/employees/org-nodes/route'));
});
// Fresh world per test — resets the in-memory tables AND the write
// log (same rule the capa suite follows).
beforeEach(async () => {
  tokens = await freshWorld();
});

// ════════════════ POST /api/employees — creation ════════════════
describe('POST /api/employees — organization assignment at creation', () => {
  it('valid team node → 201; stores canonical orgNodeId + node-derived department display + membership joined event', async () => {
    const res = await postEmployee(
      { name: 'أحمد الجديد', position: 'فني', orgNodeId: 'qaTeam' },
      tokens.hrToken,
    );
    assert.equal(res.status, 201);
    const created = employeeWrites().at(-1)!;
    assert.equal(created.orgNodeId, 'qaTeam');
    // Display string derives from the NODE (nearest department
    // ancestor) — not from any client-supplied label.
    assert.equal(created.department, 'قسم مراقبة الجودة');
    const event = membershipEvents().at(-1)!;
    assert.equal(event.kind, 'joined');
    assert.equal(event.employeeId, created.id);
    assert.equal(event.nodeId, 'qaTeam');
    assert.equal(event.previousNodeId, null);
  });

  it('department node → department-only assignment (canonical node = the department)', async () => {
    await postEmployee({ name: 'قسم فقط', orgNodeId: 'quality' }, tokens.hrToken);
    const created = employeeWrites().at(-1)!;
    assert.equal(created.orgNodeId, 'quality');
    assert.equal(created.department, 'قسم مراقبة الجودة');
    assert.equal(membershipEvents().at(-1)!.kind, 'joined');
  });

  it('unknown node → 400 rejection, nothing written (no silent node creation)', async () => {
    const res = await postEmployee({ name: 'شبح', orgNodeId: 'ghost-node' }, tokens.hrToken);
    assert.equal(res.status, 400);
    assert.equal(employeeWrites().length, 0);
    assert.equal(membershipEvents().length, 0);
  });

  it('archived node → 400 rejection, nothing written', async () => {
    const res = await postEmployee({ name: 'مؤرشف', orgNodeId: 'archivedDept' }, tokens.hrToken);
    assert.equal(res.status, 400);
    assert.equal(employeeWrites().length, 0);
  });

  it('non-string orgNodeId → 400 rejection', async () => {
    const res = await postEmployee({ name: 'غريب', orgNodeId: 42 }, tokens.hrToken);
    assert.equal(res.status, 400);
    assert.equal(employeeWrites().length, 0);
  });

  it('legacy contract preserved: no orgNodeId → free-text department stored, no membership event', async () => {
    const res = await postEmployee(
      { name: 'قديم', department: 'قسم حر' },
      tokens.hrToken,
    );
    assert.equal(res.status, 201);
    const created = employeeWrites().at(-1)!;
    assert.equal(created.department, 'قسم حر');
    assert.equal(created.orgNodeId, null);
    assert.equal(membershipEvents().length, 0);
  });
});

// ════════════════ PUT /api/employees/[id] — M0.4 separation ════════════════
describe('PUT /api/employees/[id] — organizational assignment separation preserved', () => {
  it('changing orgNodeId through the generic edit route → 403 and nothing changed', async () => {
    setTable('employees', [
      { id: 'emp1', code: 'E1', name: 'موظف أول', department: 'قسم مراقبة الجودة', orgNodeId: 'qaTeam', status: 'active' },
    ]);
    const res = await putEmployee(
      'emp1',
      { name: 'اسم معدل', orgNodeId: 'quality' },
      tokens.hrToken,
    );
    assert.equal(res.status, 403);

    const rows = (await dbStubs.getAll('employees')) as Array<Record<string, any>>;
    assert.equal(rows[0].name, 'موظف أول'); // profile fields NOT applied either
    assert.equal(rows[0].orgNodeId, 'qaTeam');
  });
});

// ════════════════ POST /api/organization/employees/move ════════════════
describe('POST /api/organization/employees/move — privileged transfer', () => {
  it('admin move team → team: ONLY the pointer changes, department string untouched, transferred event appended', async () => {
    setTable('employees', [
      { id: 'emp2', code: 'E2', name: 'موظف منقول', department: 'قسم مراقبة الجودة', orgNodeId: 'qaTeam', status: 'active' },
    ]);
    const res = await postMove({ employeeId: 'emp2', orgNodeId: 'company' }, tokens.adminToken);
    assert.equal(res.status, 200);

    const rows = (await dbStubs.getAll('employees')) as Array<Record<string, any>>;
    assert.equal(rows[0].orgNodeId, 'company');
    assert.equal(rows[0].department, 'قسم مراقبة الجودة'); // historical integrity
    const event = membershipEvents().at(-1)!;
    assert.equal(event.kind, 'transferred');
    assert.equal(event.previousNodeId, 'qaTeam');
    assert.equal(event.nodeId, 'company');
  });

  it('archived target node → 400 rejection', async () => {
    setTable('employees', [
      { id: 'emp3', code: 'E3', name: 'موظف ثالث', orgNodeId: null, status: 'active' },
    ]);
    const res = await postMove({ employeeId: 'emp3', orgNodeId: 'archivedDept' }, tokens.adminToken);
    assert.equal(res.status, 400);
  });

  it('unknown target node → 404 rejection', async () => {
    setTable('employees', [
      { id: 'emp4', code: 'E4', name: 'موظف رابع', orgNodeId: null, status: 'active' },
    ]);
    const res = await postMove({ employeeId: 'emp4', orgNodeId: 'ghost' }, tokens.adminToken);
    assert.equal(res.status, 404);
  });

  it('non-admin without organization permission (HR preset) → 403', async () => {
    setTable('employees', [
      { id: 'emp5', code: 'E5', name: 'موظف خامس', orgNodeId: null, status: 'active' },
    ]);
    const res = await postMove({ employeeId: 'emp5', orgNodeId: 'qaTeam' }, tokens.hrToken);
    assert.equal(res.status, 403);
  });
});

// ════════════════ GET /api/organization — workforce strength ════════════════
describe('GET /api/organization — current workforce strength from canonical assignments', () => {
  it('counts ACTIVE employees only; archived/inactive never inflate; DTO carries status/position', async () => {
    setTable('employees', [
      { id: 'e1', code: '1', name: 'أحمد', position: 'فني', orgNodeId: 'qaTeam', status: 'active' },
      { id: 'e2', code: '2', name: 'محمد', position: 'فني', orgNodeId: 'qaTeam', status: 'archived' },
      { id: 'e3', code: '3', name: 'علي', position: 'مفتش', orgNodeId: 'quality', status: 'active' },
      { id: 'e4', code: '4', name: 'بلا عقدة', position: null, orgNodeId: null, status: 'active' },
    ]);
    setTable('users', []);
    setTable('positions', []);
    const res = await organizationRoute.GET(
      new Request('http://localhost/api/organization', { headers: bearerHeaders(tokens.adminToken) }),
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    // §ORG-LEVELS — tree root is GA; company is its child
    const ga = data.tree.find((n: { id: string }) => n.id === 'ga');
    const company = ga.children.find((n: { id: string }) => n.id === 'company');
    const quality = company.children.find((n: { id: string }) => n.id === 'quality');
    const qaTeam = quality.children.find((n: { id: string }) => n.id === 'qaTeam');
    // archived e2 does not inflate the team or subtree counts
    assert.equal(qaTeam.employeeCount, 1);
    assert.equal(quality.employeeCount, 1); // e3 only (department-only)
    assert.equal(quality.subtreeEmployeeCount, 2); // e1 + e3
    // unassigned counts ACTIVE employees only (e4; archived e2 is not "unassigned workforce")
    assert.equal(data.unassignedEmployeeCount, 1);
    // DTO exposes currency + position for the member-management modal
    const dto = data.employees.find((e: { id: string }) => e.id === 'e2');
    assert.equal(dto.status, 'not-current');
    assert.equal(dto.position, 'فني');
  });
});

// ════════════════ GET /api/employees/org-nodes — selector data ════════════════
describe('GET /api/employees/org-nodes — minimal assignment-selector list', () => {
  it('employees-page viewer gets the minimal node list (no manager/user data)', async () => {
    const res = await orgNodesRoute.GET(
      new Request('http://localhost/api/employees/org-nodes', { headers: bearerHeaders(tokens.hrToken) }),
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.nodes.length, 4);
    const team = data.nodes.find((n: { id: string }) => n.id === 'qaTeam');
    assert.deepEqual(
      Object.keys(team).sort(),
      ['id', 'name', 'order', 'parentId', 'status', 'type'],
    );
    assert.ok(!('managerUserId' in team));
  });

  it('unauthenticated → 401', async () => {
    const res = await orgNodesRoute.GET(new Request('http://localhost/api/employees/org-nodes'));
    assert.equal(res.status, 401);
  });
});
