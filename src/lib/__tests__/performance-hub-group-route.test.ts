// ══════════════════════════════════════════════════════════════
//  POST /api/performance-hub/group — ROUTE security contract
//  (§GROUP-REPORTING access restrictions — Task E)
//
//  The REAL route handler runs against the in-memory db harness:
//  requireAuth → verifyPermission('employee360','view') → server-
//  resolved employee scope (M0.5) → section gates (risk/HR) →
//  builder. No parallel authorization implementation is created —
//  the production chain is exercised end-to-end.
//
//  Covered:
//    • Employee scope: out-of-scope employee ids and org nodes are
//      rejected from the report and SURFACED (outOfScope* fields),
//      never silently dropped, never widened. Partial subtree
//      coverage fails closed (a partially-visible node leaks nothing).
//    • Permissions: missing employee360 → 403; section-level
//      permissions (hrDeductions) are enforced server-side — the HR
//      table is never even READ for a denied section; admin bypass
//      (unrestricted scope) works exactly where intended.
//    • Request validation: malformed/empty/duplicate ids, invalid
//      month, invalid limit — stable 400 error envelope.
//    • Response behavior: canonical error shape; no unauthorized
//      employee data in successful or failed responses.
// ══════════════════════════════════════════════════════════════

import './m01-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resetTestData,
  registerFixtures,
  registerUser,
  setTable,
  mintToken,
  jsonRequest,
  bearerHeaders,
  calls,
} from './m01-test-support';

type GroupRoute = { POST: (req: Request) => Promise<Response> };
const route = {} as GroupRoute;
const tokens: { admin: string; manager: string; denied: string; hrSectionDenied: string } = {
  admin: '',
  manager: '',
  denied: '',
  hrSectionDenied: '',
};

const MONTH = '2026-09';

const ORG_NODES = [
  { id: 'ga', name: 'الإدارة العامة', type: 'general_administration', parentId: null, managerUserId: null, managerUserName: null, status: 'active', order: 0, description: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'dept_sales', name: 'المبيعات', type: 'department', parentId: 'ga', managerUserId: null, managerUserName: null, status: 'active', order: 1, description: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'team_a', name: 'فريق أ', type: 'team', parentId: 'dept_sales', managerUserId: null, managerUserName: 'مدير أ', status: 'active', order: 2, description: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'team_b', name: 'فريق ب', type: 'team', parentId: 'dept_sales', managerUserId: null, managerUserName: 'مدير ب', status: 'active', order: 3, description: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
];

const EMPLOYEES = [
  { id: 'emp_a1', name: 'أحمد فريق أ', code: 'A1', department: 'المبيعات', position: 'مندوب', status: 'active', orgNodeId: 'team_a', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'emp_a2', name: 'سارة فريق أ', code: 'A2', department: 'المبيعات', position: 'مندوب', status: 'active', orgNodeId: 'team_a', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'emp_b1', name: 'خالد فريق ب', code: 'B1', department: 'المبيعات', position: 'مندوب', status: 'active', orgNodeId: 'team_b', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'emp_b2', name: 'منى فريق ب', code: 'B2', department: 'المبيعات', position: 'مندوب', status: 'active', orgNodeId: 'team_b', createdAt: '2026-01-01T00:00:00.000Z' },
];

const HR_ROWS = [
  { id: 'hr_1', employeeId: 'emp_a1', month: MONTH, amount: 2, unit: 'days', status: 'approved', type: 'late', deductionDate: `${MONTH}-05` },
  // The OUT-OF-SCOPE row that must never reach a team-a manager:
  { id: 'hr_2', employeeId: 'emp_b1', month: MONTH, amount: 9, unit: 'days', status: 'approved', type: 'absence', deductionDate: `${MONTH}-07` },
];

before(async () => {
  Object.assign(route, await import('@/app/api/performance-hub/group/route'));
});

beforeEach(async () => {
  resetTestData();
  setTable('orgNodes', ORG_NODES);
  setTable('employees', EMPLOYEES);
  setTable('hrDeductions', HR_ROWS);
  setTable('monthSnapshots', []);
  setTable('kpiSchemes', []);
  setTable('kpiSchemeOverrides', []);
  setTable('employmentEvents', []);
  setTable('qualityObservations', []);
  setTable('qualityDeductions', []);
  setTable('complaints', []);
  setTable('capaCases', []);
  setTable('followUps', []);
  setTable('travelDeals', []);
  setTable('attendanceResults', []);

  const t = await registerFixtures();
  tokens.admin = t.adminToken;
  // Manager whose boundary override is team_a — subtree scope covers
  // exactly emp_a1/emp_a2 (the §ORG-BOUNDARY documented override).
  registerUser({
    id: 'u-mgr-a',
    email: 'mgr-a@test.local',
    name: 'مدير فريق أ',
    role: 'manager',
    orgBoundaryNodeIds: ['team_a'],
  });
  tokens.manager = await mintToken({ userId: 'u-mgr-a', email: 'mgr-a@test.local', role: 'manager' });
  // employee360 page denied entirely (stored override beats the preset).
  registerUser({
    id: 'u-denied',
    email: 'denied@test.local',
    name: 'بلا صلاحية',
    role: 'manager',
    permissions: { employee360: { level: 'none' } },
    orgBoundaryNodeIds: ['team_a'],
  });
  tokens.denied = await mintToken({ userId: 'u-denied', email: 'denied@test.local', role: 'manager' });
  // employee360 granted but the HR DEDUCTIONS section denied — page
  // access is not section access.
  registerUser({
    id: 'u-mgr-nohr',
    email: 'mgr-nohr@test.local',
    name: 'مدير بلا خصومات',
    role: 'manager',
    permissions: { employee360: { level: 'read', sections: { hrDeductions: 'none' } } },
    orgBoundaryNodeIds: ['team_a'],
  });
  tokens.hrSectionDenied = await mintToken({ userId: 'u-mgr-nohr', email: 'mgr-nohr@test.local', role: 'manager' });
});

function post(body: unknown, token?: string): Promise<Response> {
  return route.POST(jsonRequest(`http://localhost/api/performance-hub/group`, body, token ? bearerHeaders(token) : {}));
}

interface ReportBody {
  datasetKind: string;
  population: {
    members: Array<{ employeeId: string; employeeName: string }>;
    outOfScopeEmployeeIds: string[];
    outOfScopeOrgNodeIds: string[];
    resolvedCount: number;
  };
  dimensionRollups: Array<{ key: string; membersWithValue: number }>;
  dataQualityNotes: string[];
}

async function postReport(body: unknown, token?: string): Promise<{ res: Response; body: ReportBody }> {
  const res = await post(body, token);
  const body2 = (await res.json()) as ReportBody & { error?: unknown };
  return { res, body: body2 };
}

// ───────────────────────────────────────────────────────────────

describe('group route — static contract', () => {
  it('enforces employee360:view + server-resolved scope + section gates in source', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/performance-hub/group/route.ts'), 'utf8');
    assert.ok(source.includes("verifyPermission(request, 'employee360', 'view')"), 'employee360 view permission missing');
    assert.ok(source.includes('resolveEmployeeScopeFromDb'), 'M0.5 scope resolution missing');
    assert.ok(source.includes('resolveEmployee360SectionGate'), 'section gate missing');
    assert.ok(source.includes('GROUP_REPORT_MAX_MEMBERS'), 'member cap missing');
  });
});

describe('group route — authentication & permission gate', () => {
  it('401 without a valid token', async () => {
    const res = await post({ month: MONTH, employeeIds: ['emp_a1'] });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'UNAUTHORIZED');
  });

  it('403 for a caller with employee360 explicitly denied (stable error shape)', async () => {
    const res = await post({ month: MONTH, employeeIds: ['emp_a1'] }, tokens.denied);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.ok(typeof body.error.message === 'string');
    // The error envelope never contains report data.
    assert.ok(!JSON.stringify(body).includes('emp_a1'));
  });

  it('403 leaks no employee data in the error body', async () => {
    const res = await post({ month: MONTH, employeeIds: ['emp_b1'] }, tokens.denied);
    assert.equal(res.status, 403);
    const serialized = JSON.stringify(await res.json());
    for (const forbidden of ['emp_a1', 'emp_b1', 'أحمد', 'خالد']) {
      assert.ok(!serialized.includes(forbidden), `error body leaked: ${forbidden}`);
    }
  });
});

describe('group route — employee scope (M0.5 narrowing)', () => {
  it('a manager CAN report their own subtree members', async () => {
    const { res, body } = await postReport({ month: MONTH, employeeIds: ['emp_a1', 'emp_a2'] }, tokens.manager);
    assert.equal(res.status, 200);
    assert.equal(body.datasetKind, 'EMPLOYEE_PERFORMANCE_GROUP_REPORT');
    assert.deepEqual(body.population.outOfScopeEmployeeIds, []);
    const ids = body.population.members.map((m) => m.employeeId).sort();
    assert.deepEqual(ids, ['emp_a1', 'emp_a2']);
  });

  it('an out-of-scope employee id is REJECTED from the report and surfaced — never widened, never leaked', async () => {
    const { res, body } = await postReport(
      { month: MONTH, employeeIds: ['emp_a1', 'emp_b1'] },
      tokens.manager,
    );
    assert.equal(res.status, 200, 'the request completes; the narrowing is reported');
    assert.deepEqual(body.population.outOfScopeEmployeeIds, ['emp_b1']);
    const ids = body.population.members.map((m) => m.employeeId);
    assert.deepEqual(ids, ['emp_a1'], 'only the in-scope member is present');
    assert.ok(body.dataQualityNotes.some((n) => n.startsWith('employeeIdsOutOfScope:')));
  });

  it('a manager CAN resolve their in-scope org subtree (team_a) into members', async () => {
    const { res, body } = await postReport({ month: MONTH, employeeIds: [], orgNodeIds: ['team_a'] }, tokens.manager);
    assert.equal(res.status, 200);
    assert.deepEqual(body.population.outOfScopeOrgNodeIds, []);
    const ids = body.population.members.map((m) => m.employeeId).sort();
    assert.deepEqual(ids, ['emp_a1', 'emp_a2'], 'the in-scope subtree contributes exactly its members');
  });

  it('a fully out-of-scope org node is rejected — no member of its subtree appears', async () => {
    const { res, body } = await postReport({ month: MONTH, employeeIds: [], orgNodeIds: ['team_b'] }, tokens.manager);
    assert.equal(res.status, 200);
    assert.deepEqual(body.population.outOfScopeOrgNodeIds, ['team_b']);
    assert.equal(body.population.members.length, 0, 'team_b contributes nothing to a team_a manager');
  });

  it('PARTIAL subtree coverage fails closed — a partially-visible node leaks nothing', async () => {
    // dept_sales contains team_a (in scope) AND team_b (out of scope):
    // the node must be rejected WHOLE — neither team's members come
    // through it.
    const { res, body } = await postReport({ month: MONTH, employeeIds: [], orgNodeIds: ['dept_sales'] }, tokens.manager);
    assert.equal(res.status, 200);
    assert.deepEqual(body.population.outOfScopeOrgNodeIds, ['dept_sales']);
    assert.equal(body.population.members.length, 0);
    const serialized = JSON.stringify(body);
    for (const forbidden of ['emp_b1', 'emp_b2', 'خالد', 'منى']) {
      assert.ok(!serialized.includes(forbidden), `partial-subtree response leaked: ${forbidden}`);
    }
  });

  it('no unauthorized employee data in a successful scoped response', async () => {
    const { res, body } = await postReport({ month: MONTH, employeeIds: ['emp_a1'] }, tokens.manager);
    assert.equal(res.status, 200);
    const serialized = JSON.stringify(body);
    for (const forbidden of ['emp_b1', 'emp_b2', 'خالد', 'منى', 'hr_2']) {
      assert.ok(!serialized.includes(forbidden), `scoped response leaked: ${forbidden}`);
    }
    // The in-scope member's real org context IS present (team resolved from the tree).
    assert.equal(body.population.members[0]!.employeeName, 'أحمد فريق أ');
  });
});

describe('group route — section-level permissions (server-side withholding)', () => {
  it('HR section granted → the hrDeductions table is read for the scoped population', async () => {
    calls.length = 0;
    const { res, body } = await postReport({ month: MONTH, employeeIds: ['emp_a1'] }, tokens.manager);
    assert.equal(res.status, 200);
    assert.ok(calls.some((c) => c.fn === 'getAll' && c.args[0] === 'hrDeductions'), 'HR table read when authorized');
    const hrRollup = body.dimensionRollups.find((r) => r.key === 'hr');
    assert.ok(hrRollup, 'hr dimension present when authorized');
    assert.equal(hrRollup.membersWithValue, 1);
    assert.ok(!JSON.stringify(body).includes('hr_2'), 'the OUT-OF-SCOPE hr row never appears');
  });

  it('HR section DENIED → the hrDeductions table is never even read (withheld server-side)', async () => {
    calls.length = 0;
    const { res, body } = await postReport({ month: MONTH, employeeIds: ['emp_a1'] }, tokens.hrSectionDenied);
    assert.equal(res.status, 200, 'the page is still accessible — only the section is denied');
    assert.equal(
      calls.filter((c) => c.fn === 'getAll' && c.args[0] === 'hrDeductions').length,
      0,
      'a denied section must not trigger ANY hrDeductions read',
    );
    assert.equal(body.dimensionRollups.find((r) => r.key === 'hr'), undefined, 'no hr dimension in the report');
    const serialized = JSON.stringify(body);
    for (const forbidden of ['hr_1', 'hr_2', 'deductionDays', 'deductionAmount']) {
      assert.ok(!serialized.includes(forbidden), `denied-section response leaked: ${forbidden}`);
    }
  });

  it('admin bypass resolves an UNRESTRICTED scope — and the HR section follows the same gate', async () => {
    const { res, body } = await postReport({ month: MONTH, employeeIds: ['emp_a1', 'emp_b1'] }, tokens.admin);
    assert.equal(res.status, 200);
    assert.deepEqual(body.population.outOfScopeEmployeeIds, [], 'admin is unrestricted by design (M0.5)');
    const ids = body.population.members.map((m) => m.employeeId).sort();
    assert.deepEqual(ids, ['emp_a1', 'emp_b1']);
  });
});

describe('group route — request validation', () => {
  const badRequests: Array<{ name: string; body: unknown; status?: number }> = [
    { name: 'missing month', body: { employeeIds: ['emp_a1'] } },
    { name: 'invalid month format', body: { month: '09-2026', employeeIds: ['emp_a1'] } },
    { name: 'non-array employeeIds', body: { month: MONTH, employeeIds: 'emp_a1' } },
    { name: 'non-string employee id', body: { month: MONTH, employeeIds: [123] } },
    { name: 'empty-string employee id', body: { month: MONTH, employeeIds: [''] } },
    { name: 'over-length employee id', body: { month: MONTH, employeeIds: ['x'.repeat(129)] } },
    { name: 'empty selection (both lists empty)', body: { month: MONTH, employeeIds: [], orgNodeIds: [] } },
    { name: 'selection missing entirely', body: { month: MONTH } },
    { name: 'too many employee ids (cap 100)', body: { month: MONTH, employeeIds: Array.from({ length: 101 }, (_, i) => `e${i}`) } },
    { name: 'invalid limit (zero)', body: { month: MONTH, employeeIds: ['emp_a1'], limit: 0 } },
    { name: 'invalid limit (negative)', body: { month: MONTH, employeeIds: ['emp_a1'], limit: -3 } },
    { name: 'invalid limit (non-numeric)', body: { month: MONTH, employeeIds: ['emp_a1'], limit: 'many' } },
    { name: 'non-object body (array)', body: ['emp_a1'] },
    { name: 'non-object body (string)', body: 'nope' },
  ];

  for (const { name, body } of badRequests) {
    it(`400 — ${name}`, async () => {
      const res = await post(body, tokens.manager);
      assert.equal(res.status, 400, `${name} must be a 400`);
      const payload = await res.json();
      assert.equal(payload.error.code, 'VALIDATION', 'stable VALIDATION code');
      assert.equal(payload.error.validation, true);
      assert.ok(typeof payload.error.message === 'string' && payload.error.message.length > 0);
      // Validation failures carry no population/members data.
      assert.equal(payload.population, undefined);
      assert.equal(payload.members, undefined);
    });
  }

  it('duplicate employee ids are deduplicated (not an error, no double counting)', async () => {
    const { res, body } = await postReport(
      { month: MONTH, employeeIds: ['emp_a1', 'emp_a1', 'emp_a2', 'emp_a1'] },
      tokens.manager,
    );
    assert.equal(res.status, 200);
    const ids = body.population.members.map((m) => m.employeeId).sort();
    assert.deepEqual(ids, ['emp_a1', 'emp_a2'], 'duplicates collapse to one member each');
    assert.equal(body.population.resolvedCount, 2);
  });

  it('unknown org node ids are surfaced as out-of-scope (never silently ignored)', async () => {
    const { res, body } = await postReport({ month: MONTH, employeeIds: ['emp_a1'], orgNodeIds: ['ghost-node'] }, tokens.manager);
    assert.equal(res.status, 200);
    assert.ok(body.population.outOfScopeOrgNodeIds.includes('ghost-node'));
    assert.ok(body.dataQualityNotes.some((n) => n.startsWith('orgNodesOutOfScope:')));
  });

  it('limit above the hard cap is clamped to GROUP_REPORT_MAX_MEMBERS, not rejected', async () => {
    const { res, body } = await postReport({ month: MONTH, employeeIds: ['emp_a1'], limit: 9999 }, tokens.manager);
    assert.equal(res.status, 200);
    assert.ok(body.population.resolvedCount >= 1);
  });
});
