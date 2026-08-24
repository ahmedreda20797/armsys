// ══════════════════════════════════════════════════════════════
//  M0.4 — Scoped Write Paths & Per-Route Scope Adoption
//
//  The central rule under test:
//    A user having permission to perform an action does NOT
//    automatically mean that the user can perform that action on
//    every record.
//
//  Flow enforced by every adopted route:
//    authenticate → verifyPermission (page action) → resolve
//    target employee (stored record / body) → resolveEmployeeScope
//    (canonical engine, employees-page entry) → ctx.includes →
//    mutate.
//
//  Test-matrix numbering (M0.4 spec, items 1–35) is referenced in
//  each test title. Integration tests run the REAL route handlers
//    against the in-memory db stubs (m01-test-support) with REAL
//    JWTs — no client-side enforcement is involved.
//
//  Run: npx tsx --test src/lib/__tests__/m04-scoped-write-paths.test.ts
// ══════════════════════════════════════════════════════════════

import './m01-test-support';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  registerFixtures,
  registerUser,
  mintToken,
  resetTestData,
  setTable,
  bearerHeaders,
  tamperToken,
  jsonRequest,
  xlsxBlob,
  dbStubs,
  calls,
} from './m01-test-support';

// ─────────────────────────────────────────────────────────────
//  Extended in-memory db stubs — the routes adopted by M0.4 also
//  call findWhere / findWhereContains / deleteWhere / deleteByIds
//  / getEmployeeMap. The base harness stubs the core I/O; these
//  patches route the remaining reads through the stubbed getAll
//  (same in-memory tables) and record delete calls. Patched ONLY
//  in this test file's process (each test file runs isolated).
// ─────────────────────────────────────────────────────────────
dbStubs.findWhere = async (t: string, filters: Record<string, unknown>) => {
  const all = await dbStubs.getAll(t);
  return all.filter((r: Record<string, unknown>) =>
    Object.entries(filters).every(([k, v]) => r[k] === v));
};
dbStubs.findWhereContains = async (t: string, field: string, substring: string) => {
  const all = await dbStubs.getAll(t);
  return all.filter((r: Record<string, unknown>) =>
    typeof r[field] === 'string' && (r[field] as string).includes(substring));
};
dbStubs.findWhereIn = async (t: string, field: string, values: unknown[]) => {
  const all = await dbStubs.getAll(t);
  const set = new Set(values.map(String));
  return all.filter((r: Record<string, unknown>) => set.has(String(r[field])));
};
dbStubs.deleteWhere = async (t: string, filters: Record<string, unknown>) => {
  const rows = await dbStubs.findWhere(t, filters);
  for (const row of rows) await dbStubs.deleteRecord(t, (row as { id: string }).id);
  return rows.length;
};
dbStubs.deleteByIds = async (t: string, ids: string[]) => {
  for (const id of ids) await dbStubs.deleteRecord(t, id);
  return ids.length;
};
dbStubs.getEmployeeMap = async () => {
  const employees = await dbStubs.getAll('employees');
  return new Map(employees.map((e: Record<string, any>) => [
    e.id,
    { id: e.id, name: e.name, department: e.department || null, position: e.position || null, shiftStart: e.shiftStart || null },
  ]));
};

// ─────────────────────────────────────────────────────────────
//  Fixtures — org graph, employees, records, users/tokens
// ─────────────────────────────────────────────────────────────
//
//  company
//  ├── teamA (managed by u-mgr-a) — empA1, empA2
//  └── teamB (managed by u-mgr-b) — empB1, empB2
//  empFree — org-unassigned
//
//  Viewers:
//    admin            → bypass 'all'
//    hr / quality     → employees 'all' preset
//    u-mgr-a          → manager preset subtree = {empA1, empA2}
//    u-mgr-write      → manager + stored employees update/delete
//                       (scope INHERITS preset 'subtree' — M0.3)
//    u-writer-team    → custom user, write actions on every adopted
//                       page, employees scope 'team' + linked empA1
//                       → {empA1, empA2}
//    u-writer-noscope → same permissions, NO employees scope, no
//                       linkage → fail-closed EMPTY set (M0.3)
function orgNode(id: string, managerUserId: string | null) {
  return {
    id, name: id, type: 'team', parentId: 'company', managerUserId,
    managerUserName: null, status: 'active', order: 0, description: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  };
}

function seedOrgGraph(): void {
  setTable('orgNodes', [
    orgNode('company', null),
    orgNode('teamA', 'u-mgr-a'),
    orgNode('teamB', 'u-mgr-b'),
  ]);
  setTable('employees', [
    { id: 'empA1', code: 'A1', name: 'موظف أ1', department: 'المبيعات', orgNodeId: 'teamA' },
    { id: 'empA2', code: 'A2', name: 'موظف أ2', department: 'المبيعات', orgNodeId: 'teamA' },
    { id: 'empB1', code: 'B1', name: 'موظف ب1', department: 'المبيعات', orgNodeId: 'teamB' },
    { id: 'empB2', code: 'B2', name: 'موظف ب2', department: 'المبيعات', orgNodeId: 'teamB' },
    { id: 'empFree', code: 'F1', name: 'موظف حر', department: null, orgNodeId: null },
  ]);
}

function seedRecords(): void {
  setTable('attendance', [
    { id: 'attA1', employeeId: 'empA1', date: '05/07/2026', status: 'present' },
    { id: 'attB1', employeeId: 'empB1', date: '05/07/2026', status: 'present' },
  ]);
  setTable('requests', [
    { id: 'reqLeaveA1', employeeId: 'empA1', type: 'leave', date: '05/07/2026', status: 'pending' },
    { id: 'reqExcuseA2', employeeId: 'empA2', type: 'excuse', date: '06/07/2026', status: 'pending' },
    { id: 'reqExcuseB1', employeeId: 'empB1', type: 'excuse', date: '07/07/2026', status: 'pending' },
  ]);
  setTable('travelDeals', [
    { id: 'trvA1', employeeId: 'empA1', destination: 'القاهرة', departureDate: '10/07/2026' },
    { id: 'trvB1', employeeId: 'empB1', destination: 'الإسكندرية', departureDate: '11/07/2026' },
  ]);
  setTable('followUps', [
    { id: 'fuA1', employeeId: 'empA1', date: '05/07/2026', followUpType: 'quality' },
    { id: 'fuB1', employeeId: 'empB1', date: '05/07/2026', followUpType: 'quality' },
  ]);
  setTable('hrDeductions', [
    { id: 'hrA1', employeeId: 'empA1', type: 'late', amount: 1, unit: 'day', month: '2026-07', status: 'pending' },
    { id: 'hrB1', employeeId: 'empB1', type: 'late', amount: 1, unit: 'day', month: '2026-07', status: 'pending' },
  ]);
  setTable('qualityObservations', [
    {
      id: 'obsA1', employeeId: 'empA1', employeeName: 'موظف أ1', month: '2026-07',
      applyPointDeduction: true, points: 5, approvalStatus: 'pending',
      approvalHistory: [], auditLog: [],
    },
    {
      id: 'obsB1', employeeId: 'empB1', employeeName: 'موظف ب1', month: '2026-07',
      applyPointDeduction: true, points: 5, approvalStatus: 'pending',
      approvalHistory: [], auditLog: [],
    },
  ]);
  setTable('qualityDeductions', [
    { id: 'qdA1', employeeId: 'empA1', date: '05/07/2026', type: 'جودة', description: '', deductionDays: 1, deductionAmount: 0, month: '2026-07' },
    { id: 'qdB1', employeeId: 'empB1', date: '06/07/2026', type: 'جودة', description: '', deductionDays: 2, deductionAmount: 0, month: '2026-07' },
  ]);
  setTable('complaints', [
    { id: 'cmpA1', employeeId: 'empA1', customerName: 'عميل ١', complaintType: 'تأخير', description: 'وصف' },
    { id: 'cmpB1', employeeId: 'empB1', customerName: 'عميل ٢', complaintType: 'تأخير', description: 'وصف' },
    { id: 'cmpFree', employeeId: null, customerName: 'عميل ٣', complaintType: 'تأخير', description: 'وصف' },
  ]);
  setTable('capaCases', [
    { id: 'capaA1', capaId: 'CAPA-2026-001', employeeId: 'empA1', title: 'حالة أ', relatedEmployeeIds: [], status: 'open' },
    { id: 'capaB1', capaId: 'CAPA-2026-002', employeeId: 'empB1', title: 'حالة ب', relatedEmployeeIds: [], status: 'open' },
    { id: 'capaFree', capaId: 'CAPA-2026-003', employeeId: null, title: 'حالة حرة', relatedEmployeeIds: [], status: 'open' },
  ]);
  setTable('biometrics', [
    { id: 'bioA1', employeeId: 'empA1', date: '05/07/2026', month: '2026-07' },
    { id: 'bioB1', employeeId: 'empB1', date: '05/07/2026', month: '2026-07' },
  ]);
  setTable('observationCategories', [
    { id: 'cat1', name: 'تصنيف ١', weight: 1, isBonusDefault: false },
  ]);
  setTable('attendanceResults', [
    {
      id: '2026-07_empA1', month: '2026-07', employeeId: 'empA1', employeeName: 'موظف أ1',
      department: 'المبيعات', presentDays: 20, lateDays: 1, absentDays: 0, exemptDays: 0,
      lateDeductionDays: 0, absenceDeductionDays: 0, attendanceDeductionDays: 0, compliance: 90,
    },
    {
      id: '2026-07_empB1', month: '2026-07', employeeId: 'empB1', employeeName: 'موظف ب1',
      department: 'المبيعات', presentDays: 18, lateDays: 3, absentDays: 1, exemptDays: 0,
      lateDeductionDays: 1, absenceDeductionDays: 2, attendanceDeductionDays: 3, compliance: 70,
    },
  ]);
}

/** Write-everything stored map for the custom scoped writers. */
const WRITER_PAGES = [
  'attendance', 'requests', 'travel', 'followUps', 'hrDeductions',
  'observations', 'quality', 'biometric', 'capa', 'complaints',
] as const;
function writerPermissions(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const page of WRITER_PAGES) {
    map[page] = {
      level: 'edit',
      actions: {
        create: true, update: true, delete: true,
        approve: page === 'requests' || page === 'hrDeductions' || page === 'observations',
        upload: page === 'biometric',
      },
    };
  }
  return { ...map, ...extra };
}

interface M04Tokens {
  adminToken: string;
  hrToken: string;
  qualityToken: string;
  managerToken: string;      // u-mgr-a — stock manager preset (subtree teamA)
  mgrWriteToken: string;     // u-mgr-write — manager + stored employees write
  writerTeamToken: string;   // u-writer-team — team scope {empA1, empA2}
  writerNoscopeToken: string;// u-writer-noscope — fail-closed empty set
  userToken: string;
}

async function m04Fixtures(): Promise<M04Tokens> {
  const base = await registerFixtures(); // admin/user/hr/manager/quality

  // Stock-manager fixtures bound to the org graph (u-mgr-a manages teamA).
  registerUser({ id: 'u-mgr-a', email: 'mgra@test.local', name: 'مدير أ', role: 'manager' });
  registerUser({ id: 'u-mgr-b', email: 'mgrb@test.local', name: 'مدير ب', role: 'manager' });
  // Manager + stored employees WRITE grant — scope inherits the
  // preset 'subtree' (M0.3 tier inheritance, never widened). Its
  // subtree anchor is its own linked record (empA2): managed nodes ∪ own.
  registerUser({
    id: 'u-mgr-write', email: 'mgrw@test.local', name: 'مدير كاتب', role: 'manager',
    linkedEmployeeId: 'empA2',
    permissions: { employees: { level: 'edit', actions: { update: true, delete: true } } },
  });
  // Custom scoped writer: team scope anchored at linked empA1.
  registerUser({
    id: 'u-writer-team', email: 'wteam@test.local', name: 'كاتب فريق', role: 'user',
    linkedEmployeeId: 'empA1',
    permissions: writerPermissions({
      employees: { level: 'edit', actions: { update: true, delete: true, create: true }, scope: 'team' },
    }),
  });
  // Same write grants, NO employees scope, no linkage → fail-closed.
  registerUser({
    id: 'u-writer-noscope', email: 'wnoscope@test.local', name: 'كاتب بلا نطاق', role: 'user',
    permissions: writerPermissions({
      employees: { level: 'edit', actions: { update: true, delete: true, create: true } },
    }),
  });

  const [mgrA, mgrWrite, writerTeam, writerNoscope] = await Promise.all([
    mintToken({ userId: 'u-mgr-a', email: 'mgra@test.local', role: 'manager' }),
    mintToken({ userId: 'u-mgr-write', email: 'mgrw@test.local', role: 'manager' }),
    mintToken({ userId: 'u-writer-team', email: 'wteam@test.local', role: 'user' }),
    mintToken({ userId: 'u-writer-noscope', email: 'wnoscope@test.local', role: 'user' }),
  ]);

  return {
    adminToken: base.adminToken,
    hrToken: base.hrToken,
    qualityToken: base.qualityToken,
    managerToken: mgrA,
    mgrWriteToken: mgrWrite,
    writerTeamToken: writerTeam,
    writerNoscopeToken: writerNoscope,
    userToken: base.userToken,
  };
}

/** Reset + reseed everything for a describe block. */
async function freshWorld(): Promise<M04Tokens> {
  resetTestData();
  const t = await m04Fixtures();
  seedOrgGraph();
  seedRecords();
  return t;
}

function idRequest(url: string, method: string, body: unknown, token?: string): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? bearerHeaders(token) : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
}

// Route module shapes
interface IdRoute {
  PUT?: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  DELETE?: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  PATCH?: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  POST?: (req: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
  GET?: (req: Request, ctx?: unknown) => Promise<Response>;
}
interface PostRoute { POST: (req: Request) => Promise<Response>; }
interface GetRoute { GET: (req: Request, ctx?: unknown) => Promise<Response>; }
const p = (id: string) => ({ params: Promise.resolve({ id }) });
function deletedIdsFor(table: string): string[] {
  return calls
    .filter((c) => c.fn === 'deleteRecord' && c.args[0] === table)
    .map((c) => c.args[1] as string);
}

// ══════════════════════════════════════════════════════════════
//  A. EMPLOYEE MUTATIONS (matrix 1–10)
// ══════════════════════════════════════════════════════════════
describe('M0.4 A — employees PUT/DELETE write-scope', () => {
  let route: IdRoute;
  let t: M04Tokens;
  const BASE = 'http://localhost/api/employees';

  before(async () => {
    route = (await import('@/app/api/employees/[id]/route')) as unknown as IdRoute;
    t = await freshWorld();
  });

  it('[1] admin updates an employee → 200', async () => {
    const res = await route.PUT!(idRequest(`${BASE}/empA1`, 'PUT', { name: 'موظف أ1 معدل' }, t.adminToken), p('empA1'));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).name, 'موظف أ1 معدل');
  });

  it('[2] admin deletes an employee → 200 (existing cascade preserved)', async () => {
    const res = await route.DELETE!(idRequest(`${BASE}/empB2`, 'DELETE', {}, t.adminToken), p('empB2'));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).message, 'Employee deleted successfully');
  });

  it('[3] manager WITH stored update grant updates an IN-SCOPE employee (subtree) → 200', async () => {
    const res = await route.PUT!(idRequest(`${BASE}/empA2`, 'PUT', { name: 'موظف أ2 معدل' }, t.mgrWriteToken), p('empA2'));
    assert.equal(res.status, 200);
  });

  it('[4] same manager updates an OUT-OF-SCOPE employee → 404 identical to missing', async () => {
    const denied = await route.PUT!(idRequest(`${BASE}/empB1`, 'PUT', { name: 'x' }, t.mgrWriteToken), p('empB1'));
    const missing = await route.PUT!(idRequest(`${BASE}/empMissing`, 'PUT', { name: 'x' }, t.mgrWriteToken), p('empMissing'));
    assert.equal(denied.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(await denied.json(), await missing.json()); // anti-enumeration
  });

  it('[5] manager deletes OUT-OF-SCOPE employee → 404; IN-SCOPE delete → 200', async () => {
    assert.equal(
      (await route.DELETE!(idRequest(`${BASE}/empB1`, 'DELETE', {}, t.mgrWriteToken), p('empB1'))).status,
      404,
    );
    assert.equal(
      (await route.DELETE!(idRequest(`${BASE}/empA2`, 'DELETE', {}, t.mgrWriteToken), p('empA2'))).status,
      200,
    );
  });

  it('[6] permission none → 403 (scope never grants permission)', async () => {
    const res = await route.PUT!(idRequest(`${BASE}/empA1`, 'PUT', { name: 'x' }, t.userToken), p('empA1'));
    assert.equal(res.status, 403);
  });

  it('[7–10] scope cannot be expanded by client-supplied identity fields', async () => {
    // Spoofed authorization-relevant fields ride the body; the URL
    // id stays the authorization target.
    const res = await route.PUT!(
      idRequest(`${BASE}/empB1`, 'PUT', { employeeId: 'empA1', userId: 'u-mgr-a', role: 'admin', scope: 'all' }, t.mgrWriteToken),
      p('empB1'),
    );
    assert.equal(res.status, 404); // still out of scope
  });

  it('orgNodeId CHANGE via employees PUT is refused (separate privileged operation)', async () => {
    const res = await route.PUT!(
      idRequest(`${BASE}/empA1`, 'PUT', { orgNodeId: 'teamB' }, t.hrToken),
      p('empA1'),
    );
    assert.equal(res.status, 403);
  });

  it('orgNodeId no-op (same value) is ignored, not refused — other fields update', async () => {
    const res = await route.PUT!(
      idRequest(`${BASE}/empA1`, 'PUT', { orgNodeId: 'teamA', name: 'موظف أ1 مرة أخرى' }, t.hrToken),
      p('empA1'),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.name, 'موظف أ1 مرة أخرى');
    assert.equal(body.orgNodeId, 'teamA'); // unchanged by this route
  });

  it('scoped viewer cannot UPDATE an unassigned employee (never in a restricted scope)', async () => {
    const res = await route.PUT!(idRequest(`${BASE}/empFree`, 'PUT', { name: 'x' }, t.writerTeamToken), p('empFree'));
    assert.equal(res.status, 404);
  });
});

describe('M0.4 A — employees POST create-scope', () => {
  let route: PostRoute;
  let t: M04Tokens;

  before(async () => {
    route = (await import('@/app/api/employees/route')) as unknown as PostRoute;
    t = await freshWorld();
  });

  it('HR (employees scope all) creates → 201', async () => {
    const res = await route.POST(idRequest('http://localhost/api/employees', 'POST', { name: 'موظف جديد' }, t.hrToken));
    assert.equal(res.status, 201);
  });

  it('scoped viewer with the create ACTION is denied fail-closed → 403', async () => {
    const res = await route.POST(idRequest('http://localhost/api/employees', 'POST', { name: 'موظف جديد' }, t.writerTeamToken));
    assert.equal(res.status, 403);
  });

  it('M0.3 fail-closed writer (permission, no scope) is denied → 403', async () => {
    const res = await route.POST(idRequest('http://localhost/api/employees', 'POST', { name: 'موظف جديد' }, t.writerNoscopeToken));
    assert.equal(res.status, 403);
  });

  it('admin creates → 201 (unchanged)', async () => {
    const res = await route.POST(idRequest('http://localhost/api/employees', 'POST', { name: 'موظف إداري' }, t.adminToken));
    assert.equal(res.status, 201);
  });
});

// ══════════════════════════════════════════════════════════════
//  B. CREATE OPERATIONS on employee-linked records (matrix 11–13)
// ══════════════════════════════════════════════════════════════
describe('M0.4 B — employee-linked creates respect scope', () => {
  let attendance: PostRoute;
  let requests: PostRoute;
  let travel: PostRoute;
  let followUps: PostRoute;
  let hrDeductions: PostRoute;
  let quality: PostRoute;
  let observations: PostRoute;
  let t: M04Tokens;

  before(async () => {
    attendance = (await import('@/app/api/attendance/route')) as unknown as PostRoute;
    requests = (await import('@/app/api/requests/route')) as unknown as PostRoute;
    travel = (await import('@/app/api/travel/route')) as unknown as PostRoute;
    followUps = (await import('@/app/api/follow-ups/route')) as unknown as PostRoute;
    hrDeductions = (await import('@/app/api/hr-deductions/route')) as unknown as PostRoute;
    quality = (await import('@/app/api/quality/route')) as unknown as PostRoute;
    observations = (await import('@/app/api/quality-observations/route')) as unknown as PostRoute;
    t = await freshWorld();
  });

  it('[11] create for an IN-SCOPE employee → 201 (attendance)', async () => {
    const res = await attendance.POST(idRequest('http://localhost/api/attendance', 'POST', {
      employeeId: 'empA1', date: '08/07/2026', status: 'present',
    }, t.writerTeamToken));
    assert.equal(res.status, 201);
  });

  it('[12] create for an OUT-OF-SCOPE employee → 403 — every employee-linked resource', async () => {
    const cases: Array<[string, Promise<Response>]> = [
      ['attendance', attendance.POST(idRequest('http://localhost/api/attendance', 'POST', { employeeId: 'empB1', date: '08/07/2026' }, t.writerTeamToken))],
      ['requests', requests.POST(idRequest('http://localhost/api/requests', 'POST', { employeeId: 'empB1', type: 'leave', date: '08/07/2026' }, t.writerTeamToken))],
      ['travel', travel.POST(idRequest('http://localhost/api/travel', 'POST', { employeeId: 'empB1', destination: 'x', departureDate: '10/07/2026' }, t.writerTeamToken))],
      ['follow-ups', followUps.POST(idRequest('http://localhost/api/follow-ups', 'POST', { employeeId: 'empB1', date: '08/07/2026', followUpType: 'quality', subject: 's' }, t.writerTeamToken))],
      ['hr-deductions', hrDeductions.POST(idRequest('http://localhost/api/hr-deductions', 'POST', { employeeId: 'empB1', type: 'late', amount: 1, unit: 'day', month: '2026-07' }, t.writerTeamToken))],
      ['quality', quality.POST(idRequest('http://localhost/api/quality', 'POST', { employeeId: 'empB1', date: '08/07/2026', type: 'جودة', month: '2026-07' }, t.writerTeamToken))],
      ['quality-observations', observations.POST(idRequest('http://localhost/api/quality-observations', 'POST', { employeeId: 'empB1', observationDate: '08/07/2026', type: 'positive', categoryId: 'cat1' }, t.writerTeamToken))],
    ];
    for (const [name, promise] of cases) {
      const res = await promise;
      assert.equal(res.status, 403, `${name} out-of-scope create must be 403`);
    }
  });

  it('[13] client cannot spoof ownership with a duplicate employeeId field', async () => {
    const res = await attendance.POST(idRequest('http://localhost/api/attendance', 'POST', {
      employeeId: 'empB1', date: '08/07/2026',
      linkedEmployeeId: 'empA1', employeeRef: 'empA1', userId: 'u-writer-team',
    }, t.writerTeamToken));
    assert.equal(res.status, 403); // body.employeeId (empB1) is the target — out of scope
  });

  it('scope denial happens BEFORE existence validation (no existence oracle)', async () => {
    const res = await attendance.POST(idRequest('http://localhost/api/attendance', 'POST', {
      employeeId: 'empGhost', date: '08/07/2026',
    }, t.writerTeamToken));
    assert.equal(res.status, 403); // not the 400 "Employee not found" validation error
  });

  it('M0.3 fail-closed doctrine carried into writes: permission WITHOUT resolvable scope → 403', async () => {
    const res = await attendance.POST(idRequest('http://localhost/api/attendance', 'POST', {
      employeeId: 'empA1', date: '08/07/2026',
    }, t.writerNoscopeToken));
    assert.equal(res.status, 403);
  });

  it('[34-adjacent] HR (unrestricted) creates a record for an unassigned employee unchanged → 201', async () => {
    const res = await attendance.POST(idRequest('http://localhost/api/attendance', 'POST', {
      employeeId: 'empFree', date: '08/07/2026',
    }, t.hrToken));
    assert.equal(res.status, 201);
  });
});

// ══════════════════════════════════════════════════════════════
//  C. REQUESTS — approve/reject/update/delete (matrix 14–19)
// ══════════════════════════════════════════════════════════════
describe('M0.4 C — attendance REQUEST mutations (requests domain)', () => {
  let route: IdRoute;
  let t: M04Tokens;
  const BASE = 'http://localhost/api/requests';

  before(async () => {
    route = (await import('@/app/api/requests/[id]/route')) as unknown as IdRoute;
    t = await freshWorld();
  });

  it('[14] manager (subtree) approves an IN-SCOPE request → 200', async () => {
    const res = await route.PATCH!(
      idRequest(`${BASE}/reqLeaveA1`, 'PATCH', { status: 'approved' }, t.managerToken),
      p('reqLeaveA1'),
    );
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'approved');
  });

  it('[15] manager approves an OUT-OF-SCOPE request → 404 identical to missing', async () => {
    const denied = await route.PATCH!(idRequest(`${BASE}/reqExcuseB1`, 'PATCH', { status: 'approved' }, t.managerToken), p('reqExcuseB1'));
    const missing = await route.PATCH!(idRequest(`${BASE}/reqGhost`, 'PATCH', { status: 'approved' }, t.managerToken), p('reqGhost'));
    assert.equal(denied.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(await denied.json(), await missing.json());
  });

  it('[16] manager rejects an IN-SCOPE request → 200', async () => {
    const res = await route.PATCH!(
      idRequest(`${BASE}/reqLeaveA1`, 'PATCH', { status: 'rejected' }, t.managerToken),
      p('reqLeaveA1'),
    );
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'rejected');
  });

  it('[17] manager rejects an OUT-OF-SCOPE request → 404', async () => {
    const res = await route.PATCH!(idRequest(`${BASE}/reqExcuseB1`, 'PATCH', { status: 'rejected' }, t.managerToken), p('reqExcuseB1'));
    assert.equal(res.status, 404);
  });

  it('[18] requestId resolves the AUTHORITATIVE stored employee — spoofed body employeeId cannot retarget', async () => {
    const res = await route.PATCH!(
      idRequest(`${BASE}/reqExcuseB1`, 'PATCH', { status: 'approved', employeeId: 'empA1' }, t.managerToken),
      p('reqExcuseB1'),
    );
    assert.equal(res.status, 404); // stored employeeId empB1 governs
  });

  it('[19] a denied approval writes NOTHING — no attendance deduction record appears', async () => {
    const before = (await dbStubs.getAll('attendance')).length;
    await route.PATCH!(idRequest(`${BASE}/reqExcuseB1`, 'PATCH', { status: 'approved' }, t.managerToken), p('reqExcuseB1'));
    const after = (await dbStubs.getAll('attendance')).length;
    assert.equal(after, before); // the excuse deduction path never ran
  });

  it('BUSINESS RULE PRESERVED: in-scope excuse approval still creates the deduction attendance record', async () => {
    const before = (await dbStubs.getAll('attendance')).length;
    const res = await route.PATCH!(
      idRequest(`${BASE}/reqExcuseA2`, 'PATCH', { status: 'approved' }, t.managerToken),
      p('reqExcuseA2'),
    );
    assert.equal(res.status, 200);
    const after = (await dbStubs.getAll('attendance')).length;
    assert.equal(after, before + 1); // 1-day deduction record (approved excuse) — unchanged rule
  });

  it('update (non-approve) of an out-of-scope request → 404; delete → 404', async () => {
    assert.equal(
      (await route.PATCH!(idRequest(`${BASE}/reqExcuseB1`, 'PATCH', { reason: 'x' }, t.writerTeamToken), p('reqExcuseB1'))).status,
      404,
    );
    assert.equal(
      (await route.DELETE!(idRequest(`${BASE}/reqExcuseB1`, 'DELETE', {}, t.writerTeamToken), p('reqExcuseB1'))).status,
      404,
    );
  });

  it('[34] admin approves any request unchanged → 200', async () => {
    const res = await route.PATCH!(idRequest(`${BASE}/reqExcuseB1`, 'PATCH', { status: 'approved' }, t.adminToken), p('reqExcuseB1'));
    assert.equal(res.status, 200);
  });
});

// ══════════════════════════════════════════════════════════════
//  D. ATTENDANCE record mutations (matrix 20–23)
// ══════════════════════════════════════════════════════════════
describe('M0.4 D — attendance record mutations', () => {
  let route: IdRoute;
  let t: M04Tokens;
  const BASE = 'http://localhost/api/attendance';

  before(async () => {
    route = (await import('@/app/api/attendance/[id]/route')) as unknown as IdRoute;
    t = await freshWorld();
  });

  it('[20] in-scope attendance mutation → allowed (PUT 200, DELETE 200)', async () => {
    const put = await route.PUT!(idRequest(`${BASE}/attA1`, 'PUT', { status: 'late' }, t.writerTeamToken), p('attA1'));
    assert.equal(put.status, 200);
    assert.equal((await put.json()).status, 'late');
    const del = await route.DELETE!(idRequest(`${BASE}/attA1`, 'DELETE', {}, t.writerTeamToken), p('attA1'));
    assert.equal(del.status, 200);
  });

  it('[21] out-of-scope attendance mutation → 404 identical to missing (PUT and DELETE)', async () => {
    const putDenied = await route.PUT!(idRequest(`${BASE}/attB1`, 'PUT', { status: 'late' }, t.writerTeamToken), p('attB1'));
    const putMissing = await route.PUT!(idRequest(`${BASE}/attGhost`, 'PUT', { status: 'late' }, t.writerTeamToken), p('attGhost'));
    assert.equal(putDenied.status, 404);
    assert.deepEqual(await putDenied.json(), await putMissing.json());
    assert.equal(
      (await route.DELETE!(idRequest(`${BASE}/attB1`, 'DELETE', {}, t.writerTeamToken), p('attB1'))).status,
      404,
    );
  });

  it('[21b] reassigning an attendance record to an OUT-OF-SCOPE employee → 404', async () => {
    const res = await route.PUT!(idRequest(`${BASE}/attA1`, 'PUT', { employeeId: 'empB1' }, t.writerTeamToken), p('attA1'));
    assert.equal(res.status, 404);
  });

  it('[23] denied mutations never reach the db write layer', async () => {
    resetTestData();
    const t2 = await freshWorld();
    await route.PUT!(idRequest(`${BASE}/attB1`, 'PUT', { status: 'late' }, t2.writerTeamToken), p('attB1'));
    await route.DELETE!(idRequest(`${BASE}/attB1`, 'DELETE', {}, t2.writerTeamToken), p('attB1'));
    const wroteAttB1 = calls.some(
      (c) => (c.fn === 'updateRecord' || c.fn === 'deleteRecord') && c.args[1] === 'attB1',
    );
    assert.equal(wroteAttB1, false);
  });
});

// ══════════════════════════════════════════════════════════════
//  E. BIOMETRIC (matrix 24–26)
// ══════════════════════════════════════════════════════════════
describe('M0.4 E — biometric mutations', () => {
  let clear: PostRoute;
  let upload: PostRoute;
  let t: M04Tokens;

  before(async () => {
    clear = (await import('@/app/api/biometric/clear/route')) as unknown as PostRoute;
    upload = (await import('@/app/api/biometric/upload/route')) as unknown as PostRoute;
    t = await freshWorld();
  });

  it('[24-adjacent] HR (unrestricted) clears the whole month unchanged → both records', async () => {
    const res = await clear.POST(idRequest('http://localhost/api/biometric/clear', 'POST', { month: '2026-07' }, t.hrToken));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).deleted, 2);
    assert.deepEqual(deletedIdsFor('biometrics').sort(), ['bioA1', 'bioB1']);
  });

  it('[24/25] a SCOPED viewer clears ONLY in-scope biometric records (intersection)', async () => {
    resetTestData();
    const t2 = await freshWorld();
    const res = await clear.POST(idRequest('http://localhost/api/biometric/clear', 'POST', { month: '2026-07' }, t2.writerTeamToken));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).deleted, 1); // bioA1 only
    assert.deepEqual(deletedIdsFor('biometrics'), ['bioA1']); // bioB1 untouched
  });

  it('[26] biometric upload requires an UNRESTRICTED scope — scoped viewer (with the upload action) → 403', async () => {
    const blob = await xlsxBlob([
      ['الاسم', 'التاريخ', 'الحضور', 'الانصراف'],
      ['موظف أ1', '05/07/2026', '08:00', '16:00'],
    ]);
    const fd = new FormData();
    fd.append('file', blob, 'bio.xlsx');
    const req = new Request('http://localhost/api/biometric/upload', {
      method: 'POST',
      headers: bearerHeaders(t.writerTeamToken),
      body: fd,
    });
    const res = await upload.POST(req);
    assert.equal(res.status, 403);
  });

  it('[26b] the authenticated operator is NEVER assumed to be the biometric target', async () => {
    // Admin operator (the stock role that holds biometric 'upload')
    // uploads a row for empB1 — the TARGET is resolved from the
    // sheet's employee record, and the unrestricted admin scope
    // authorizes it (target ≠ operator).
    const blob = await xlsxBlob([
      ['الاسم', 'التاريخ', 'الحضور', 'الانصراف'],
      ['موظف ب1', '05/07/2026', '08:00', '16:00'],
    ]);
    const fd = new FormData();
    fd.append('file', blob, 'bio.xlsx');
    const req = new Request('http://localhost/api/biometric/upload', {
      method: 'POST',
      headers: bearerHeaders(t.adminToken),
      body: fd,
    });
    const res = await upload.POST(req);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).imported, 1);
  });
});

// ══════════════════════════════════════════════════════════════
//  B2. [id]-resource mutations across the remaining families
//      (travel / follow-ups / hr-deductions / quality /
//       observations / complaints / capa)
// ══════════════════════════════════════════════════════════════
describe('M0.4 B2 — [id] mutations across employee-linked families', () => {
  let travel: IdRoute;
  let followUps: IdRoute;
  let hrDeductions: IdRoute;
  let quality: IdRoute;
  let observations: IdRoute;
  let approve: IdRoute;
  let reject: IdRoute;
  let complaints: IdRoute;
  let capa: IdRoute;
  let t: M04Tokens;

  before(async () => {
    travel = (await import('@/app/api/travel/[id]/route')) as unknown as IdRoute;
    followUps = (await import('@/app/api/follow-ups/[id]/route')) as unknown as IdRoute;
    hrDeductions = (await import('@/app/api/hr-deductions/[id]/route')) as unknown as IdRoute;
    quality = (await import('@/app/api/quality/[id]/route')) as unknown as IdRoute;
    observations = (await import('@/app/api/quality-observations/[id]/route')) as unknown as IdRoute;
    approve = (await import('@/app/api/quality-observations/[id]/approve/route')) as unknown as IdRoute;
    reject = (await import('@/app/api/quality-observations/[id]/reject/route')) as unknown as IdRoute;
    complaints = (await import('@/app/api/complaints/[id]/route')) as unknown as IdRoute;
    capa = (await import('@/app/api/capa-cases/[id]/route')) as unknown as IdRoute;
    t = await freshWorld();
  });

  async function assertInAndOut(
    name: string,
    fn: (id: string) => Promise<Response>,
    inId: string,
    outId: string,
  ): Promise<void> {
    const ok = await fn(inId);
    assert.equal(ok.status, 200, `${name}: in-scope must succeed`);
    const denied = await fn(outId);
    const missing = await fn(`${outId}-ghost`);
    assert.equal(denied.status, 404, `${name}: out-of-scope must be denied`);
    assert.deepEqual(await denied.json(), await missing.json(), `${name}: denied must equal missing`);
  }

  it('travel PUT/DELETE scope (in 200 / out 404 same-body)', async () => {
    await assertInAndOut('travel PUT', async (id) =>
      travel.PUT!(idRequest(`http://localhost/api/travel/${id}`, 'PUT', { destination: 'أسوان' }, t.writerTeamToken), p(id)), 'trvA1', 'trvB1');
    await assertInAndOut('travel DELETE', async (id) =>
      travel.DELETE!(idRequest(`http://localhost/api/travel/${id}`, 'DELETE', {}, t.writerTeamToken), p(id)), 'trvA1', 'trvB1');
  });

  it('travel reassignment to an out-of-scope employee → 404', async () => {
    const res = await travel.PUT!(
      idRequest('http://localhost/api/travel/trvA1', 'PUT', { employeeId: 'empB1' }, t.writerTeamToken),
      p('trvA1'),
    );
    assert.equal(res.status, 404);
  });

  it('follow-ups PUT/DELETE scope', async () => {
    await assertInAndOut('followUps PUT', async (id) =>
      followUps.PUT!(idRequest(`http://localhost/api/follow-ups/${id}`, 'PUT', { subject: 'محدث' }, t.writerTeamToken), p(id)), 'fuA1', 'fuB1');
    await assertInAndOut('followUps DELETE', async (id) =>
      followUps.DELETE!(idRequest(`http://localhost/api/follow-ups/${id}`, 'DELETE', {}, t.writerTeamToken), p(id)), 'fuA1', 'fuB1');
  });

  it('follow-ups reassignment to an out-of-scope employee → 404', async () => {
    const res = await followUps.PUT!(
      idRequest('http://localhost/api/follow-ups/fuA1', 'PUT', { employeeId: 'empB1' }, t.writerTeamToken),
      p('fuA1'),
    );
    assert.equal(res.status, 404);
  });

  it('hr-deductions PATCH approve/update + DELETE scope (HR deduction rules untouched)', async () => {
    const okApprove = await hrDeductions.PATCH!(
      idRequest('http://localhost/api/hr-deductions/hrA1', 'PATCH', { status: 'approved' }, t.writerTeamToken),
      p('hrA1'),
    );
    assert.equal(okApprove.status, 200);
    const deniedApprove = await hrDeductions.PATCH!(
      idRequest('http://localhost/api/hr-deductions/hrB1', 'PATCH', { status: 'approved' }, t.writerTeamToken),
      p('hrB1'),
    );
    assert.equal(deniedApprove.status, 404);
    await assertInAndOut('hrDeductions update', async (id) =>
      hrDeductions.PATCH!(idRequest(`http://localhost/api/hr-deductions/${id}`, 'PATCH', { reason: 'سبب' }, t.writerTeamToken), p(id)), 'hrA1', 'hrB1');
    await assertInAndOut('hrDeductions delete', async (id) =>
      hrDeductions.DELETE!(idRequest(`http://localhost/api/hr-deductions/${id}`, 'DELETE', {}, t.writerTeamToken), p(id)), 'hrA1', 'hrB1');
  });

  it('quality deductions PUT/DELETE scope', async () => {
    await assertInAndOut('quality PUT', async (id) =>
      quality.PUT!(idRequest(`http://localhost/api/quality/${id}`, 'PUT', { description: 'محدث' }, t.writerTeamToken), p(id)), 'qdA1', 'qdB1');
    await assertInAndOut('quality DELETE', async (id) =>
      quality.DELETE!(idRequest(`http://localhost/api/quality/${id}`, 'DELETE', {}, t.writerTeamToken), p(id)), 'qdA1', 'qdB1');
  });

  it('quality observations PUT + approve/reject scope (workflow preserved)', async () => {
    const put = await observations.PUT!(
      idRequest('http://localhost/api/quality-observations/obsA1', 'PUT', { notes: 'محدث' }, t.writerTeamToken),
      p('obsA1'),
    );
    assert.equal(put.status, 200);
    const putDenied = await observations.PUT!(
      idRequest('http://localhost/api/quality-observations/obsB1', 'PUT', { notes: 'x' }, t.writerTeamToken),
      p('obsB1'),
    );
    assert.equal(putDenied.status, 404);

    // Reassignment target out of scope → 404 (before its validation).
    const reassign = await observations.PUT!(
      idRequest('http://localhost/api/quality-observations/obsA1', 'PUT', { employeeId: 'empB1' }, t.writerTeamToken),
      p('obsA1'),
    );
    assert.equal(reassign.status, 404);

    const okApprove = await approve.POST!(
      idRequest('http://localhost/api/quality-observations/obsA1/approve', 'POST', {}, t.writerTeamToken),
      p('obsA1'),
    );
    assert.equal(okApprove.status, 200);
    const deniedApprove = await approve.POST!(
      idRequest('http://localhost/api/quality-observations/obsB1/approve', 'POST', {}, t.writerTeamToken),
      p('obsB1'),
    );
    assert.equal(deniedApprove.status, 404);

    const okReject = await reject.POST!(
      idRequest('http://localhost/api/quality-observations/obsA1/reject', 'POST', { reason: 'سبب' }, t.writerTeamToken),
      p('obsA1'),
    );
    assert.equal(okReject.status, 200);
    const deniedReject = await reject.POST!(
      idRequest('http://localhost/api/quality-observations/obsB1/reject', 'POST', { reason: 'سبب' }, t.writerTeamToken),
      p('obsB1'),
    );
    assert.equal(deniedReject.status, 404);
  });

  it('a denied observation approval writes NO audit/approval events', async () => {
    await approve.POST!(
      idRequest('http://localhost/api/quality-observations/obsB1/approve', 'POST', {}, t.writerTeamToken),
      p('obsB1'),
    );
    const obs = (await dbStubs.getById('qualityObservations', 'obsB1')) as { approvalStatus?: string };
    assert.equal(obs.approvalStatus, 'pending'); // untouched
  });

  it('observations DELETE scope (in 200 / out 404)', async () => {
    assert.equal(
      (await observations.DELETE!(idRequest('http://localhost/api/quality-observations/obsA1', 'DELETE', {}, t.writerTeamToken), p('obsA1'))).status,
      200,
    );
    assert.equal(
      (await observations.DELETE!(idRequest('http://localhost/api/quality-observations/obsB1', 'DELETE', {}, t.writerTeamToken), p('obsB1'))).status,
      404,
    );
  });

  it('complaints (OPTIONAL link): linked out-of-scope → 404; unlinked → permission only', async () => {
    const unlinked = await complaints.PUT!(
      idRequest('http://localhost/api/complaints/cmpFree', 'PUT', { description: 'محدث' }, t.writerTeamToken),
      p('cmpFree'),
    );
    assert.equal(unlinked.status, 200); // no employee target → permission gate only
    const denied = await complaints.PUT!(
      idRequest('http://localhost/api/complaints/cmpB1', 'PUT', { description: 'x' }, t.writerTeamToken),
      p('cmpB1'),
    );
    assert.equal(denied.status, 404);
    // Linking an unlinked complaint to an out-of-scope employee is refused.
    const linkDenied = await complaints.PUT!(
      idRequest('http://localhost/api/complaints/cmpFree', 'PUT', { employeeId: 'empB1' }, t.writerTeamToken),
      p('cmpFree'),
    );
    assert.equal(linkDenied.status, 404);
  });

  it('capa (OPTIONAL link): stored out-of-scope → 404; unlinked + quality (all) → allowed', async () => {
    const scopedDenied = await capa.PUT!(
      idRequest('http://localhost/api/capa-cases/capaB1', 'PUT', { title: 'x' }, t.writerTeamToken),
      p('capaB1'),
    );
    assert.equal(scopedDenied.status, 404);
    const unlinked = await capa.PUT!(
      idRequest('http://localhost/api/capa-cases/capaFree', 'PUT', { title: 'عنوان محدث' }, t.writerTeamToken),
      p('capaFree'),
    );
    assert.equal(unlinked.status, 200); // no employee target → permission gate only
    const qualityOk = await capa.PUT!(
      idRequest('http://localhost/api/capa-cases/capaB1', 'PUT', { title: 'من الجودة' }, t.qualityToken),
      p('capaB1'),
    );
    assert.equal(qualityOk.status, 200); // quality preset employees scope 'all'
  });

  it('capa create with out-of-scope relatedEmployeeIds → 403; in-scope create → 201', async () => {
    const route = (await import('@/app/api/capa-cases/route')) as unknown as PostRoute;
    const denied = await route.POST(idRequest('http://localhost/api/capa-cases', 'POST', {
      title: 'حالة جديدة', employeeId: 'empA1', relatedEmployeeIds: ['empB1'],
    }, t.writerTeamToken));
    assert.equal(denied.status, 403);
    const ok = await route.POST(idRequest('http://localhost/api/capa-cases', 'POST', {
      title: 'حالة جديدة', employeeId: 'empA1', relatedEmployeeIds: ['empA2'],
    }, t.writerTeamToken));
    assert.equal(ok.status, 201);
  });
});

// ══════════════════════════════════════════════════════════════
//  F. REPORT / AGGREGATE ADOPTION (matrix 27–29)
// ══════════════════════════════════════════════════════════════
describe('M0.4 F — per-employee aggregates respect scope', () => {
  let kpiOne: GetRoute;
  let kpiMonth: GetRoute;
  let resultsOne: GetRoute;
  let resultsMonth: GetRoute;
  let hrPerf: GetRoute;
  let empPerf: GetRoute;
  let employeeDetail: PostRoute;
  let run: PostRoute;
  let t: M04Tokens;

  before(async () => {
    kpiOne = (await import('@/app/api/attendance-kpi/[month]/[employeeId]/route')) as unknown as GetRoute;
    kpiMonth = (await import('@/app/api/attendance-kpi/[month]/route')) as unknown as GetRoute;
    resultsOne = (await import('@/app/api/attendance-results/[month]/[employeeId]/route')) as unknown as GetRoute;
    resultsMonth = (await import('@/app/api/attendance-results/[month]/route')) as unknown as GetRoute;
    hrPerf = (await import('@/app/api/hr-performance/[month]/[employeeId]/route')) as unknown as GetRoute;
    empPerf = (await import('@/app/api/employee-performance/[employeeId]/route')) as unknown as GetRoute;
    employeeDetail = (await import('@/app/api/reports/employee-detail/route')) as unknown as PostRoute;
    run = (await import('@/app/api/reports/run/route')) as unknown as PostRoute;
    t = await freshWorld();
  });

  const ctx2 = (month: string, employeeId: string) => ({ params: Promise.resolve({ month, employeeId }) });
  const ctxEmp = (employeeId: string) => ({ params: Promise.resolve({ employeeId }) });
  const ctxMonth = (month: string) => ({ params: Promise.resolve({ month }) });

  it('[27] employee-specific aggregates: in-scope → data; out-of-scope → not_generated 404', async () => {
    const ok = await kpiOne.GET(idRequest('http://localhost/x', 'GET', null, t.managerToken), ctx2('2026-07', 'empA1'));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).employeeId, 'empA1');

    const denied = await kpiOne.GET(idRequest('http://localhost/x', 'GET', null, t.managerToken), ctx2('2026-07', 'empB1'));
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { status: 'not_generated', month: '2026-07', employeeId: 'empB1' });

    const hrDenied = await hrPerf.GET(idRequest('http://localhost/x', 'GET', null, t.managerToken), ctx2('2026-07', 'empB1'));
    assert.equal(hrDenied.status, 404);

    const perfDenied = await empPerf.GET(idRequest('http://localhost/x', 'GET', null, t.managerToken), ctxEmp('empB1'));
    assert.equal(perfDenied.status, 404);
    assert.deepEqual(await perfDenied.json(), { error: 'الموظف غير موجود' });
  });

  it('[27b] month lists return ONLY in-scope rows for scoped viewers (row filtering)', async () => {
    const kpis = await kpiMonth.GET(idRequest('http://localhost/x', 'GET', null, t.managerToken), ctxMonth('2026-07'));
    assert.equal(kpis.status, 200);
    const kpiBody = await kpis.json();
    assert.deepEqual(kpiBody.kpis.map((k: { employeeId: string }) => k.employeeId), ['empA1']);
    assert.equal(kpiBody.meta.total, 1);

    const results = await resultsMonth.GET(idRequest('http://localhost/x', 'GET', null, t.managerToken), ctxMonth('2026-07'));
    const resBody = await results.json();
    assert.deepEqual(resBody.results.map((r: { employeeId: string }) => r.employeeId), ['empA1']);
  });

  it('[27c] stored detail results: in-scope 200 / out-of-scope not_generated 404', async () => {
    const ok = await resultsOne.GET(idRequest('http://localhost/x', 'GET', null, t.managerToken), ctx2('2026-07', 'empA1'));
    assert.equal(ok.status, 200);
    const denied = await resultsOne.GET(idRequest('http://localhost/x', 'GET', null, t.managerToken), ctx2('2026-07', 'empB1'));
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { status: 'not_generated', month: '2026-07', employeeId: 'empB1' });
  });

  it('[27d] reports/employee-detail: out-of-scope → 404 identical to unknown employee', async () => {
    const denied = await employeeDetail.POST(idRequest('http://localhost/api/reports/employee-detail', 'POST', { employeeId: 'empB1', month: '2026-07' }, t.managerToken));
    const missing = await employeeDetail.POST(idRequest('http://localhost/api/reports/employee-detail', 'POST', { employeeId: 'empGhost', month: '2026-07' }, t.managerToken));
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), await missing.json());
  });

  it('[28] scoped report selection CANNOT expand authorization (single out-of-scope id → 403)', async () => {
    const res = await run.POST(idRequest('http://localhost/api/reports/run', 'POST', {
      reportId: 'quality-deductions', employeeId: 'empB1',
    }, t.managerToken));
    assert.equal(res.status, 403);
  });

  it('[29] requested selection INTERSECTS the authorized scope (all → subtree only; mixed list → in-scope only)', async () => {
    const allRes = await run.POST(idRequest('http://localhost/api/reports/run', 'POST', {
      reportId: 'quality-deductions', employeeScope: 'all', monthKey: '2026-07',
    }, t.managerToken));
    assert.equal(allRes.status, 200);
    const allBody = await allRes.json();
    const allIds = [...new Set((allBody.rows as Array<{ employeeId: string }>).map((r) => r.employeeId))];
    assert.deepEqual(allIds, ['empA1']); // only subtree rows — empB1's deduction never appears

    const mixedRes = await run.POST(idRequest('http://localhost/api/reports/run', 'POST', {
      reportId: 'quality-deductions', employeeIds: ['empA1', 'empB1'], monthKey: '2026-07',
    }, t.managerToken));
    assert.equal(mixedRes.status, 200);
    const mixedBody = await mixedRes.json();
    const mixedIds = [...new Set((mixedBody.rows as Array<{ employeeId: string }>).map((r) => r.employeeId))];
    assert.deepEqual(mixedIds, ['empA1']); // intersection — empB1 silently dropped
  });

  it('[29b] fail-closed viewer (empty authorized set) cannot run employee reports → 403', async () => {
    registerUser({
      id: 'u-reports-noscope', email: 'rn@test.local', name: 'تقارير بلا نطاق', role: 'user',
      permissions: { reports: { level: 'edit', actions: { export: true } } },
    });
    const token = await mintToken({ userId: 'u-reports-noscope', email: 'rn@test.local', role: 'user' });
    const res = await run.POST(idRequest('http://localhost/api/reports/run', 'POST', {
      reportId: 'quality-deductions', employeeScope: 'all',
    }, token));
    assert.equal(res.status, 403);
  });

  it('[34] HR (unrestricted) runs the workforce report unchanged', async () => {
    const res = await run.POST(idRequest('http://localhost/api/reports/run', 'POST', {
      reportId: 'quality-deductions', employeeScope: 'all', monthKey: '2026-07',
    }, t.hrToken));
    assert.equal(res.status, 200);
    const body = await res.json();
    const ids = [...new Set((body.rows as Array<{ employeeId: string }>).map((r) => r.employeeId))];
    assert.deepEqual(ids.sort(), ['empA1', 'empB1']);
  });
});

describe('M0.4 F2 — waive-deduction mutation scope', () => {
  interface WaiveRoute {
    POST: (req: Request) => Promise<Response>;
    DELETE: (req: Request) => Promise<Response>;
  }
  let route: WaiveRoute;
  let t: M04Tokens;

  before(async () => {
    route = (await import('@/app/api/reports/waive-deduction/route')) as unknown as WaiveRoute;
    t = await freshWorld();
  });

  it('in-scope waive → 200; out-of-scope waive → 403 (before any write)', async () => {
    registerUser({
      id: 'u-waiver', email: 'wv@test.local', name: 'مُعفي', role: 'user',
      linkedEmployeeId: 'empA1',
      permissions: {
        reports: { level: 'edit', actions: { export: true } },
        employees: { level: 'read', scope: 'team' },
      },
    });
    const token = await mintToken({ userId: 'u-waiver', email: 'wv@test.local', role: 'user' });

    const ok = await route.POST(jsonRequest('http://localhost/api/reports/waive-deduction', {
      employeeId: 'empA1', date: '05/07/2026', month: '2026-07',
    }, bearerHeaders(token)));
    assert.equal(ok.status, 200);

    const denied = await route.POST(jsonRequest('http://localhost/api/reports/waive-deduction', {
      employeeId: 'empB1', date: '05/07/2026', month: '2026-07',
    }, bearerHeaders(token)));
    assert.equal(denied.status, 403);

    const deniedDelete = await route.DELETE(jsonRequest('http://localhost/api/reports/waive-deduction', {
      employeeId: 'empB1', date: '05/07/2026', month: '2026-07',
    }, bearerHeaders(token)));
    assert.equal(deniedDelete.status, 403);
  });
});

// ══════════════════════════════════════════════════════════════
//  G. SECURITY (matrix 30–35)
// ══════════════════════════════════════════════════════════════
describe('M0.4 G — security semantics', () => {
  let employeesId: IdRoute;
  let attendancePost: PostRoute;
  let t: M04Tokens;

  before(async () => {
    employeesId = (await import('@/app/api/employees/[id]/route')) as unknown as IdRoute;
    attendancePost = (await import('@/app/api/attendance/route')) as unknown as PostRoute;
    t = await freshWorld();
  });

  it('[30/31] unauthenticated / invalid token → the PRE-EXISTING verifyPermission semantics (403), unchanged by M0.4', async () => {
    // These routes are gated solely by verifyPermission (M0.2/M0.2.1
    // approved surface): a missing/garbage bearer produces the
    // permission-denied 403 — M0.4 must not alter that contract.
    const noAuth = await employeesId.PUT!(
      idRequest('http://localhost/api/employees/empA1', 'PUT', { name: 'x' }),
      p('empA1'),
    );
    assert.equal(noAuth.status, 403);
    const garbage = await employeesId.PUT!(
      idRequest('http://localhost/api/employees/empA1', 'PUT', { name: 'x' }, 'garbage-token'),
      p('empA1'),
    );
    assert.equal(garbage.status, 403);
    const tampered = await employeesId.PUT!(
      idRequest('http://localhost/api/employees/empA1', 'PUT', { name: 'x' }, tamperToken(t.hrToken)),
      p('empA1'),
    );
    assert.equal(tampered.status, 403);
  });

  it('[30b] attendance POST unauthenticated → 403 (pre-existing verifyPermission gate)', async () => {
    const res = await attendancePost.POST(idRequest('http://localhost/api/attendance', 'POST', {
      employeeId: 'empA1', date: '08/07/2026',
    }));
    assert.equal(res.status, 403);
  });

  it('[32] permission denied → 403', async () => {
    const res = await attendancePost.POST(idRequest('http://localhost/api/attendance', 'POST', {
      employeeId: 'empA1', date: '08/07/2026',
    }, t.userToken));
    assert.equal(res.status, 403);
  });

  it('[33] scope denied → existing safe semantics (404 same-body on [id] resources)', async () => {
    const denied = await employeesId.PUT!(
      idRequest('http://localhost/api/employees/empB1', 'PUT', { name: 'x' }, t.mgrWriteToken),
      p('empB1'),
    );
    const missing = await employeesId.PUT!(
      idRequest('http://localhost/api/employees/nope', 'PUT', { name: 'x' }, t.mgrWriteToken),
      p('nope'),
    );
    assert.deepEqual(await denied.json(), await missing.json());
  });

  it('[34] admin behavior unchanged across mutations', async () => {
    const put = await employeesId.PUT!(
      idRequest('http://localhost/api/employees/empB1', 'PUT', { name: 'admin edit' }, t.adminToken),
      p('empB1'),
    );
    assert.equal(put.status, 200);
    const att = await attendancePost.POST(idRequest('http://localhost/api/attendance', 'POST', {
      employeeId: 'empFree', date: '08/07/2026',
    }, t.adminToken));
    assert.equal(att.status, 201);
  });

  it('[35] M0.3 fail-closed behavior unchanged: generic user GET /api/employees → 200 + EMPTY list', async () => {
    const list = (await import('@/app/api/employees/route')) as unknown as GetRoute;
    const res = await list.GET(idRequest('http://localhost/api/employees', 'GET', null, t.userToken));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });
});

// ══════════════════════════════════════════════════════════════
//  H. STATIC / SOURCE-LEVEL SECURITY REGRESSIONS
// ══════════════════════════════════════════════════════════════
describe('M0.4 H — static source guards', () => {
  const PROJECT_ROOT = join(__dirname, '..', '..', '..');

  function toPosix(absPath: string): string {
    return relative(PROJECT_ROOT, absPath).split(sep).join('/');
  }
  function collectRoutes(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) collectRoutes(path, out);
      else if (entry.name === 'route.ts') out.push(path);
    }
    return out;
  }
  function collectTsx(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) collectTsx(path, out);
      else if (entry.name.endsWith('.tsx')) out.push(path);
    }
    return out;
  }
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }
  const read = (rel: string) => stripComments(readFileSync(join(PROJECT_ROOT, rel), 'utf8'));

  /** The routes M0.4 adopted (relative posix paths). */
  const ADOPTED = [
    'src/app/api/attendance/route.ts',
    'src/app/api/attendance/[id]/route.ts',
    'src/app/api/attendance-results/generate/route.ts',
    'src/app/api/attendance-kpi/[month]/route.ts',
    'src/app/api/attendance-kpi/[month]/[employeeId]/route.ts',
    'src/app/api/attendance-results/[month]/route.ts',
    'src/app/api/attendance-results/[month]/[employeeId]/route.ts',
    'src/app/api/biometric/clear/route.ts',
    'src/app/api/biometric/upload/route.ts',
    'src/app/api/capa-cases/route.ts',
    'src/app/api/capa-cases/[id]/route.ts',
    'src/app/api/complaints/route.ts',
    'src/app/api/complaints/[id]/route.ts',
    'src/app/api/employee-performance/[employeeId]/route.ts',
    'src/app/api/employees/[id]/route.ts',
    'src/app/api/employees/upload/route.ts',
    'src/app/api/follow-ups/route.ts',
    'src/app/api/follow-ups/[id]/route.ts',
    'src/app/api/hr-deductions/route.ts',
    'src/app/api/hr-deductions/[id]/route.ts',
    'src/app/api/hr-performance/[month]/[employeeId]/route.ts',
    'src/app/api/quality/route.ts',
    'src/app/api/quality/[id]/route.ts',
    'src/app/api/quality/upload/route.ts',
    'src/app/api/quality-observations/route.ts',
    'src/app/api/quality-observations/[id]/route.ts',
    'src/app/api/quality-observations/[id]/approve/route.ts',
    'src/app/api/quality-observations/[id]/reject/route.ts',
    'src/app/api/reports/employee-detail/route.ts',
    'src/app/api/reports/run/route.ts',
    'src/app/api/reports/waive-deduction/route.ts',
    'src/app/api/requests/route.ts',
    'src/app/api/requests/[id]/route.ts',
    'src/app/api/travel/route.ts',
    'src/app/api/travel/[id]/route.ts',
  ];

  it('every adopted route exists', () => {
    for (const rel of ADOPTED) {
      assert.ok(existsSync(join(PROJECT_ROOT, rel)), `${rel} must exist`);
    }
  });

  it('adopted routes consume the CANONICAL server guard — never a private scope engine', () => {
    for (const rel of ADOPTED) {
      const code = read(rel);
      assert.match(
        code,
        /employeeInScope|hasUnrestrictedEmployeeScope|resolveEmployeeScopeFromDb/,
        `${rel} must consume the canonical guard from @/lib/scope/server`,
      );
    }
  });

  it('the server guard delegates to the canonical engine — no second scope logic', () => {
    const server = read('src/lib/scope/server.ts');
    assert.match(server, /resolvePageScope/);
    assert.match(server, /resolveEmployeeScope\(/);
    // The guard never re-implements anchor semantics.
    assert.doesNotMatch(server, /managerUserId\s*===/);
    assert.doesNotMatch(server, /findAncestorOfType/);
  });

  it('scope checks precede mutations in every adopted mutation route', () => {
    const GUARD = /employeeInScope|hasUnrestrictedEmployeeScope|resolveEmployeeScopeFromDb/;
    const WRITE = /await (updateRecord|deleteRecord|createRecord|deleteWhere|deleteByIds)\(/;
    for (const rel of ADOPTED) {
      const code = read(rel);
      const guardIndex = code.search(GUARD);
      const writeIndex = code.search(WRITE);
      if (writeIndex === -1) continue; // read-only adopted route
      assert.ok(guardIndex >= 0, `${rel} must contain a scope guard`);
      assert.ok(guardIndex < writeIndex, `${rel}: scope guard must precede the first write`);
    }
  });

  it('no ADOPTED route trusts body role/userId or duplicates the admin bypass', () => {
    for (const rel of ADOPTED) {
      const code = read(rel);
      assert.doesNotMatch(code, /role\s*===?\s*['"]admin['"]/, `${rel} must not duplicate the admin bypass`);
      assert.doesNotMatch(code, /verifyPermission\([^)]*body\./, `${rel} must not feed body values to verifyPermission`);
      assert.doesNotMatch(code, /body\.(role|userId)\s*===/, `${rel} must not compare body identity fields`);
    }
  });

  it('employees PUT refuses orgNodeId changes (organizational separation)', () => {
    const code = read('src/app/api/employees/[id]/route.ts');
    assert.match(code, /orgNodeId/);
    assert.match(code, /organization\/employees\/move|الهيكل التنظيمي/);
  });

  it('only the two M0.3 read routes use the raw engine — new adoption goes through @/lib/scope/server', () => {
    const M03_DIRECT = [
      'src/app/api/employee-360/[id]/route.ts',
      'src/app/api/employees/route.ts',
    ];
    const routeFiles = collectRoutes(join(PROJECT_ROOT, 'src', 'app', 'api'));
    for (const file of routeFiles) {
      const rel = toPosix(file);
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/resolveEmployeeScope\(|filterEmployeesByScope\(/.test(code)) {
        assert.ok(
          M03_DIRECT.includes(rel),
          `${rel} uses the raw engine — M0.4 adoption must consume @/lib/scope/server instead`,
        );
      }
    }
  });

  it('client-side filtering is never the enforcement: no server-scope helpers in components', () => {
    const components = collectTsx(join(PROJECT_ROOT, 'src', 'components'));
    for (const file of components) {
      const code = stripComments(readFileSync(file, 'utf8'));
      assert.doesNotMatch(
        code,
        /employeeInScope|hasUnrestrictedEmployeeScope|resolveEmployeeScopeFromDb/,
        `${toPosix(file)} must not enforce server scope client-side`,
      );
    }
  });
});
