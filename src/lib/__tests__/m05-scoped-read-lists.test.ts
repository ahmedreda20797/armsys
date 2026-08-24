// ══════════════════════════════════════════════════════════════
//  M0.5 — Scoped Read / List Adoption
//
//  The central rule under test:
//    A user must not be able to READ employee-linked data that is
//    outside their authorized organizational scope.
//
//  Every adopted read route enforces:
//    authenticate → (page view permission) → resolveEmployeeScope
//    (canonical engine, employees-page entry) → AUTHORIZED_SCOPE ∩
//    FILTER → search/filter/sort/pagination/count → response.
//
//  Test-matrix categories (M0.5 spec):
//    A  list endpoints               F  optional-link rule
//    B  detail endpoints (404 same)  G  relatedEmployeeIds rule
//    C  filter/search/pagination     H  fail-closed (no scope)
//    D  dashboards & aggregates      I  unrestricted fast path
//    E  reports & exports            J  M0.4 gap remediation
//    K  static security checks
//
//  Integration tests run the REAL route handlers against the
//  in-memory db stubs (m01-test-support) with REAL JWTs — no
//  client-side enforcement is involved.
//
//  Run: npx tsx --test src/lib/__tests__/m05-scoped-read-lists.test.ts
// ══════════════════════════════════════════════════════════════

import './m01-test-support';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'path';
import {
  registerFixtures,
  registerUser,
  mintToken,
  resetTestData,
  setTable,
  bearerHeaders,
  jsonRequest,
  xlsxBlob,
  dbStubs,
  calls,
} from './m01-test-support';

// ─────────────────────────────────────────────────────────────
//  Extended in-memory db stubs (same patches as the M0.4 suite —
//  findWhere / findWhereContains route through the stubbed getAll;
//  getEmployeeMap serves the in-memory employees table).
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
dbStubs.getEmployeeMap = async () => {
  const employees = await dbStubs.getAll('employees');
  return new Map(employees.map((e: Record<string, any>) => [
    e.id,
    { id: e.id, name: e.name, department: e.department || null, position: e.position || null, shiftStart: e.shiftStart || null },
  ]));
};
// Enrichment helpers: the REAL implementations call getEmployeeMap via a
// module-internal binding the exports-swap cannot intercept — stub them
// so scoped-list GETs (which enrich AFTER the scope filter) stay offline.
dbStubs.withEmployee = async (records: Array<Record<string, any>>) => {
  const empMap = await dbStubs.getEmployeeMap();
  return records.map((r) => {
    const emp = empMap.get(r.employeeId);
    return { ...r, employeeName: emp?.name || 'غير معروف', employeeDepartment: emp?.department || null };
  });
};
dbStubs.withEmployeeFull = async (records: Array<Record<string, any>>) => {
  const empMap = await dbStubs.getEmployeeMap();
  return records.map((r) => {
    const emp = empMap.get(r.employeeId);
    return {
      ...r,
      employee: emp
        ? { id: emp.id, name: emp.name, department: emp.department, shiftStart: emp.shiftStart }
        : { id: '', name: 'غير معروف', department: null, shiftStart: null },
    };
  });
};

// ─────────────────────────────────────────────────────────────
//  Fixtures — org graph, employees, records, users/tokens
//
//  company
//  ├── teamA (managed by u-mgr-a) — empA1, empA2
//  └── teamB (managed by u-mgr-b) — empB1, empB2
//  empFree — org-unassigned
//
//  Viewers:
//    admin / hr / quality  → 'all' (fast path, zero org reads)
//    managerToken (u-mgr-a) → manager preset subtree = {empA1, empA2}
//    readerTeam  → custom user, read+write on every adopted page,
//                  employees scope 'team' + linked empA1 → {empA1, empA2}
//    readerNoscope → same permissions, no employees scope → empty set
//    userToken   → default role: page read, fail-closed scope
// ─────────────────────────────────────────────────────────────
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
    { id: 'attA2', employeeId: 'empA2', date: '05/07/2026', status: 'late' },
    { id: 'attB1', employeeId: 'empB1', date: '05/07/2026', status: 'present' },
  ]);
  setTable('requests', [
    { id: 'reqLeaveA1', employeeId: 'empA1', type: 'leave', date: '05/07/2026', status: 'pending' },
    { id: 'reqExcuseA2', employeeId: 'empA2', type: 'excuse', date: '06/07/2026', status: 'pending' },
    { id: 'reqExcuseB1', employeeId: 'empB1', type: 'excuse', date: '07/07/2026', status: 'pending' },
  ]);
  setTable('biometrics', [
    { id: 'bioA1', employeeId: 'empA1', date: '05/07/2026', month: '2026-07' },
    { id: 'bioB1', employeeId: 'empB1', date: '05/07/2026', month: '2026-07' },
  ]);
  setTable('travelDeals', [
    { id: 'trvA1', employeeId: 'empA1', destination: 'القاهرة', departureDate: '10/07/2026', status: 'upcoming' },
    { id: 'trvB1', employeeId: 'empB1', destination: 'الإسكندرية', departureDate: '11/07/2026', status: 'upcoming' },
  ]);
  setTable('followUps', [
    { id: 'fuA1', employeeId: 'empA1', date: '2026-07-05', followUpType: 'quality', status: 'open' },
    { id: 'fuB1', employeeId: 'empB1', date: '2026-07-05', followUpType: 'quality', status: 'open' },
  ]);
  setTable('hrDeductions', [
    { id: 'hrA1', employeeId: 'empA1', type: 'late', amount: 1, unit: 'day', month: '2026-07', status: 'pending' },
    { id: 'hrB1', employeeId: 'empB1', type: 'late', amount: 1, unit: 'day', month: '2026-07', status: 'pending' },
  ]);
  setTable('qualityObservations', [
    {
      id: 'obsA1', employeeId: 'empA1', employeeName: 'موظف أ1', department: 'المبيعات',
      month: '2026-07', status: 'open', approvalStatus: 'pending', categoryId: 'cat1',
      applyPointDeduction: true, points: 5, approvalHistory: [], auditLog: [],
    },
    {
      id: 'obsB1', employeeId: 'empB1', employeeName: 'موظف ب1', department: 'المبيعات',
      month: '2026-07', status: 'open', approvalStatus: 'pending', categoryId: 'cat1',
      applyPointDeduction: true, points: 5, approvalHistory: [], auditLog: [],
    },
  ]);
  setTable('qualityDeductions', [
    { id: 'qdA1', employeeId: 'empA1', date: '05/07/2026', type: 'جودة', description: '', deductionDays: 1, deductionAmount: 0, month: '2026-07' },
    { id: 'qdB1', employeeId: 'empB1', date: '06/07/2026', type: 'جودة', description: '', deductionDays: 2, deductionAmount: 0, month: '2026-07' },
  ]);
  setTable('complaints', [
    { id: 'cmpA1', employeeId: 'empA1', employeeName: 'موظف أ1', customerName: 'عميل ١', complaintType: 'تأخير', description: 'وصف' },
    { id: 'cmpB1', employeeId: 'empB1', employeeName: 'موظف ب1', customerName: 'عميل ٢', complaintType: 'تأخير', description: 'وصف' },
    { id: 'cmpFree', employeeId: null, customerName: 'عميل ٣', complaintType: 'تأخير', description: 'وصف' },
  ]);
  setTable('capaCases', [
    { id: 'capaA1', capaId: 'CAPA-2026-001', employeeId: 'empA1', employeeName: 'موظف أ1', title: 'حالة أ', relatedEmployeeIds: [], status: 'open' },
    { id: 'capaB1', capaId: 'CAPA-2026-002', employeeId: 'empB1', employeeName: 'موظف ب1', title: 'حالة ب', relatedEmployeeIds: [], status: 'open' },
    { id: 'capaFree', capaId: 'CAPA-2026-003', employeeId: null, title: 'حالة حرة', relatedEmployeeIds: [], status: 'open' },
    // empA1 in scope BUT relatedEmployeeIds includes out-of-scope empB1 → hidden.
    { id: 'capaMix', capaId: 'CAPA-2026-004', employeeId: 'empA1', employeeName: 'موظف أ1', title: 'حالة مختلطة', relatedEmployeeIds: ['empB1'], status: 'open' },
    // empA1 + related empA2 — every link in scope → visible to teamA manager.
    { id: 'capaRelA2', capaId: 'CAPA-2026-005', employeeId: 'empA1', employeeName: 'موظف أ1', title: 'حالة مرتبطة', relatedEmployeeIds: ['empA2'], status: 'open' },
  ]);
}

/** Closed frozen month snapshot for 2026-07 with scores for 4 employees. */
function seedSnapshot(): void {
  const entry = (
    employeeId: string, name: string, dept: string, score: number,
    deductionPoints: number, observationCount: number,
  ) => ({
    employeeSnapshot: {
      employeeId, employeeName: name, departmentId: dept, departmentName: dept,
      position: '—', supervisorId: null,
    },
    score,
    deductionPoints,
    bonusPoints: 0,
    weightedPoints: deductionPoints,
    observationCount,
    approvedCount: observationCount,
    pendingCount: 0,
    rejectedCount: 0,
    categoryTotals: { cat1: deductionPoints },
    rank: 0,
    dept,
  });

  const employeeScores: Record<string, ReturnType<typeof entry>> = {
    empA1: entry('empA1', 'موظف أ1', 'المبيعات', 90, 10, 2),
    empA2: entry('empA2', 'موظف أ2', 'المبيعات', 100, 0, 0),
    empB1: entry('empB1', 'موظف ب1', 'التشغيل', 60, 40, 4),
    empB2: entry('empB2', 'موظف ب2', 'التشغيل', 95, 5, 1),
  };
  for (const [i, k] of Object.keys(employeeScores)
    .sort((a, b) => employeeScores[b].score - employeeScores[a].score).entries()) {
    employeeScores[k].rank = i + 1;
  }

  const historyEntry = {
    closedAt: '2026-08-01T00:00:00Z',
    closedBy: 'u-admin',
    closedByName: 'مسؤول النظام',
    generatedAt: '2026-08-01T00:00:00Z',
    settingsSnapshot: { defaultScore: 100, minimumScore: 0, allowBonus: true, maximumBonus: 20 },
    employeeScores: { empB1: employeeScores.empB1 },
    departmentScores: { التشغيل: { avgScore: 60, totalEmployees: 1, totalDeductionPoints: 40, totalBonusPoints: 0, totalObservations: 4 } },
    topEmployees: [{ employeeId: 'empB1', employeeName: 'موظف ب1', department: 'التشغيل', score: 60, rank: 1 }],
    bottomEmployees: [{ employeeId: 'empB1', employeeName: 'موظف ب1', department: 'التشغيل', score: 60, rank: 4 }],
    categoryTotals: { cat1: 40 },
    approvalStats: { total: 4, pending: 0, approved: 4, rejected: 0, avgApprovalHours: 2 },
  };

  setTable('monthSnapshots', [
    {
      id: '2026-07', schemaVersion: 1 as const, monthKey: '2026-07', status: 'closed' as const,
      closedAt: '2026-08-01T00:00:00Z', closedBy: 'u-admin', closedByName: 'مسؤول النظام',
      reopenCount: 0, reopenReason: '', auditLog: [], generatedAt: '2026-08-01T00:00:00Z',
      settingsSnapshot: { defaultScore: 100, minimumScore: 0, allowBonus: true, maximumBonus: 20 },
      employeeScores,
      departmentScores: {
        المبيعات: { avgScore: 95, totalEmployees: 2, totalDeductionPoints: 10, totalBonusPoints: 0, totalObservations: 2 },
        التشغيل: { avgScore: 77, totalEmployees: 2, totalDeductionPoints: 45, totalBonusPoints: 0, totalObservations: 5 },
      },
      topEmployees: [
        { employeeId: 'empA2', employeeName: 'موظف أ2', department: 'المبيعات', score: 100, rank: 1 },
        { employeeId: 'empB2', employeeName: 'موظف ب2', department: 'التشغيل', score: 95, rank: 2 },
        { employeeId: 'empA1', employeeName: 'موظف أ1', department: 'المبيعات', score: 90, rank: 3 },
        { employeeId: 'empB1', employeeName: 'موظف ب1', department: 'التشغيل', score: 60, rank: 4 },
      ],
      bottomEmployees: [
        { employeeId: 'empB1', employeeName: 'موظف ب1', department: 'التشغيل', score: 60, rank: 4 },
      ],
      categoryTotals: { cat1: 55 },
      approvalStats: { total: 7, pending: 0, approved: 7, rejected: 0, avgApprovalHours: 2 },
      snapshotHistory: [historyEntry],
    },
  ]);
}

/** Read+write map for the custom scoped readers (every adopted page). */
const READER_PAGES = [
  'attendance', 'requests', 'travel', 'followUps', 'hrDeductions',
  'observations', 'quality', 'biometric', 'capa', 'complaints',
] as const;
function readerPermissions(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const page of READER_PAGES) {
    map[page] = {
      level: 'edit',
      actions: { create: true, update: true, delete: true },
    };
  }
  return {
    ...map,
    home: 'read',
    riskCenter: 'read',
    kpiDashboard: 'read',
    reports: { level: 'edit', actions: { export: true } },
    ...extra,
  };
}

interface M05Tokens {
  adminToken: string;
  userToken: string;
  hrToken: string;
  qualityToken: string;
  managerToken: string;      // u-mgr-a — subtree = {empA1, empA2}
  readerTeamToken: string;   // team scope → {empA1, empA2}
  readerNoscopeToken: string;// fail-closed empty set
}

async function m05Fixtures(): Promise<M05Tokens> {
  const base = await registerFixtures(); // admin/user/hr/manager/quality
  registerUser({ id: 'u-mgr-a', email: 'mgra@test.local', name: 'مدير أ', role: 'manager' });
  registerUser({ id: 'u-mgr-b', email: 'mgrb@test.local', name: 'مدير ب', role: 'manager' });
  registerUser({
    id: 'u-reader-team', email: 'readerteam@test.local', name: 'قارئ فريق', role: 'user',
    linkedEmployeeId: 'empA1',
    permissions: readerPermissions({
      employees: { level: 'read', actions: {}, scope: 'team' },
    }),
  });
  registerUser({
    id: 'u-reader-noscope', email: 'readernoscope@test.local', name: 'قارئ بلا نطاق', role: 'user',
    permissions: readerPermissions({
      employees: { level: 'read', actions: {} },
    }),
  });

  const [mgrA, readerTeam, readerNoscope] = await Promise.all([
    mintToken({ userId: 'u-mgr-a', email: 'mgra@test.local', role: 'manager' }),
    mintToken({ userId: 'u-reader-team', email: 'readerteam@test.local', role: 'user' }),
    mintToken({ userId: 'u-reader-noscope', email: 'readernoscope@test.local', role: 'user' }),
  ]);

  return {
    adminToken: base.adminToken,
    userToken: base.userToken,
    hrToken: base.hrToken,
    qualityToken: base.qualityToken,
    managerToken: mgrA,
    readerTeamToken: readerTeam,
    readerNoscopeToken: readerNoscope,
  };
}

/** Reset + reseed everything for a describe block. */
async function freshWorld(): Promise<M05Tokens> {
  resetTestData();
  const t = await m05Fixtures();
  seedOrgGraph();
  seedRecords();
  seedSnapshot();
  return t;
}

function getRequest(url: string, token?: string): Request {
  return new Request(url, { headers: bearerHeaders(token) });
}
function idRequest(url: string, method: string, body: unknown, token?: string): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? bearerHeaders(token) : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
}

interface IdRoute {
  GET?: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  POST?: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
}
interface SimpleRoute {
  GET?: (req: Request) => Promise<Response>;
  POST?: (req: Request) => Promise<Response>;
}
const p = (id: string) => ({ params: Promise.resolve({ id }) });

const A_IDS = new Set(['empA1', 'empA2']);
function idsOf(rows: Array<{ employeeId?: string | null }>): string[] {
  return [...new Set(rows.map((r) => r.employeeId).filter(Boolean))] as string[];
}
function allInScope(rows: Array<{ employeeId?: string | null }>, scope: Set<string> = A_IDS): boolean {
  return idsOf(rows).every((id) => scope.has(id));
}

// ══════════════════════════════════════════════════════════════
//  A. LIST ENDPOINTS — scoped viewers see only authorized rows
// ══════════════════════════════════════════════════════════════
describe('M0.5 A — list endpoints read-scope', () => {
  let t: M05Tokens;
  const BASE = 'http://localhost/api';

  before(async () => {
    t = await freshWorld();
  });

  it('[A1] attendance: manager (teamA) sees only teamA rows', async () => {
    const route = (await import('@/app/api/attendance/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/attendance`, t.managerToken));
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.ok(Array.isArray(rows));
    assert.ok(allInScope(rows));
    assert.deepEqual(new Set(idsOf(rows)), new Set(['empA1', 'empA2']));
  });

  it('[A2] attendance: admin sees every row (fast path)', async () => {
    const route = (await import('@/app/api/attendance/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/attendance`, t.adminToken));
    const rows = await res.json();
    assert.deepEqual(new Set(idsOf(rows)), new Set(['empA1', 'empA2', 'empB1']));
  });

  it('[A3] requests: manager sees only teamA requests', async () => {
    const route = (await import('@/app/api/requests/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/requests`, t.managerToken));
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.ok(allInScope(rows));
    assert.equal(rows.length, 2);
  });

  it('[A4] biometric: manager sees only teamA biometrics (records describe employees, not the operator)', async () => {
    const route = (await import('@/app/api/biometric/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/biometric`, t.managerToken));
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.ok(allInScope(rows));
    assert.deepEqual(new Set(idsOf(rows)), new Set(['empA1']));
  });

  it('[A5] travel: manager pagination total + page derive from the authorized set only', async () => {
    const route = (await import('@/app/api/travel/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/travel?page=1&pageSize=50`, t.managerToken));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(allInScope(body.data));
    assert.equal(body.pagination.total, 1);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].employeeId, 'empA1');
  });

  it('[A6] follow-ups: manager data + employeeRiskScores derive from authorized rows only', async () => {
    const route = (await import('@/app/api/follow-ups/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/follow-ups`, t.managerToken));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(allInScope(body.data));
    for (const key of Object.keys(body.employeeRiskScores)) {
      assert.ok(A_IDS.has(key), `risk key ${key} out of scope`);
    }
  });

  it('[A7] quality-observations: manager sees only teamA observations', async () => {
    const route = (await import('@/app/api/quality-observations/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/quality-observations`, t.managerToken));
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.ok(allInScope(rows));
    assert.deepEqual(new Set(idsOf(rows)), new Set(['empA1']));
  });

  it('[A8] quality deductions: manager sees only teamA rows', async () => {
    const route = (await import('@/app/api/quality/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/quality?month=2026-07`, t.managerToken));
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.ok(allInScope(rows));
    assert.deepEqual(new Set(idsOf(rows)), new Set(['empA1']));
  });

  it('[A9] hr-deductions: manager sees only teamA rows', async () => {
    const route = (await import('@/app/api/hr-deductions/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/hr-deductions`, t.managerToken));
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.ok(allInScope(rows));
    assert.deepEqual(new Set(idsOf(rows)), new Set(['empA1']));
  });

  it('[A10] complaints: manager sees teamA rows + the unlinked organizational complaint', async () => {
    const route = (await import('@/app/api/complaints/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/complaints`, t.managerToken));
    assert.equal(res.status, 200);
    const rows = await res.json();
    const linked = rows.filter((r: any) => r.employeeId);
    assert.ok(allInScope(linked));
    assert.deepEqual(new Set(linked.map((r: any) => r.id)), new Set(['cmpA1']));
    assert.ok(rows.some((r: any) => r.id === 'cmpFree'), 'unlinked complaint must stay visible');
  });

  it('[A11] capa-cases: manager sees teamA cases + unlinked; related-mixed case hidden', async () => {
    const route = (await import('@/app/api/capa-cases/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/capa-cases`, t.managerToken));
    assert.equal(res.status, 200);
    const body = await res.json();
    const linked = body.data.filter((r: any) => r.employeeId);
    assert.ok(allInScope(linked));
    assert.deepEqual(
      new Set(body.data.map((r: any) => r.id)),
      new Set(['capaA1', 'capaFree', 'capaRelA2']),
    );
    assert.equal(body.total, 3);
  });
});

// ══════════════════════════════════════════════════════════════
//  B. DETAIL ENDPOINTS — out-of-scope = same 404 as unknown id
// ══════════════════════════════════════════════════════════════
describe('M0.5 B — detail endpoints anti-enumeration', () => {
  let t: M05Tokens;
  const BASE = 'http://localhost/api';

  before(async () => {
    t = await freshWorld();
  });

  it('[B1] capa detail out-of-scope → 404 with the SAME body as an unknown id', async () => {
    const route = (await import('@/app/api/capa-cases/[id]/route')) as unknown as IdRoute;
    const denied = await route.GET!(getRequest(`${BASE}/capa-cases/capaB1`, t.managerToken), p('capaB1'));
    const unknown = await route.GET!(getRequest(`${BASE}/capa-cases/nope`, t.managerToken), p('nope'));
    assert.equal(denied.status, 404);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await denied.json(), await unknown.json());
  });

  it('[B2] capa detail in-scope → 200', async () => {
    const route = (await import('@/app/api/capa-cases/[id]/route')) as unknown as IdRoute;
    const res = await route.GET!(getRequest(`${BASE}/capa-cases/capaA1`, t.managerToken), p('capaA1'));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).id, 'capaA1');
  });

  it('[B3] unlinked capa detail → 200 for the scoped manager (optional link)', async () => {
    const route = (await import('@/app/api/capa-cases/[id]/route')) as unknown as IdRoute;
    const res = await route.GET!(getRequest(`${BASE}/capa-cases/capaFree`, t.managerToken), p('capaFree'));
    assert.equal(res.status, 200);
  });

  it('[B4] observation detail out-of-scope → 404 with the SAME body as an unknown id', async () => {
    const route = (await import('@/app/api/quality-observations/[id]/route')) as unknown as IdRoute;
    const denied = await route.GET!(getRequest(`${BASE}/quality-observations/obsB1`, t.managerToken), p('obsB1'));
    const unknown = await route.GET!(getRequest(`${BASE}/quality-observations/nope`, t.managerToken), p('nope'));
    assert.equal(denied.status, 404);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await denied.json(), await unknown.json());
  });

  it('[B5] observation detail in-scope → 200', async () => {
    const route = (await import('@/app/api/quality-observations/[id]/route')) as unknown as IdRoute;
    const res = await route.GET!(getRequest(`${BASE}/quality-observations/obsA1`, t.managerToken), p('obsA1'));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).id, 'obsA1');
  });
});

// ══════════════════════════════════════════════════════════════
//  C. FILTER / SEARCH / PAGINATION — a query can only NARROW
// ══════════════════════════════════════════════════════════════
describe('M0.5 C — filters/search/pagination cannot bypass scope', () => {
  let t: M05Tokens;
  const BASE = 'http://localhost/api';

  before(async () => {
    t = await freshWorld();
  });

  it('[C1] capa search matching an OUT-of-scope title → 0 rows (search runs on the authorized set)', async () => {
    const route = (await import('@/app/api/capa-cases/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/capa-cases?search=${encodeURIComponent('حالة ب')}`, t.managerToken));
    const body = await res.json();
    assert.equal(body.total, 0);
    assert.equal(body.data.length, 0);
  });

  it('[C2] capa search matching an IN-scope title → found', async () => {
    const route = (await import('@/app/api/capa-cases/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/capa-cases?search=${encodeURIComponent('حالة أ')}`, t.managerToken));
    const body = await res.json();
    assert.equal(body.total, 1);
    assert.equal(body.data[0].id, 'capaA1');
  });

  it('[C3] capa employeeId filter for an out-of-scope employee → 0 rows (filter cannot widen scope)', async () => {
    const route = (await import('@/app/api/capa-cases/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/capa-cases?employeeId=empB1`, t.managerToken));
    const body = await res.json();
    assert.equal(body.total, 0);
  });

  it('[C4] observations employeeId filter for an out-of-scope employee → 0 rows', async () => {
    const route = (await import('@/app/api/quality-observations/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/quality-observations?employeeId=empB1`, t.managerToken));
    const rows = await res.json();
    assert.equal(rows.length, 0);
  });

  it('[C5] observations month filter keeps the scope (AUTHORIZED_SCOPE ∩ FILTER)', async () => {
    const route = (await import('@/app/api/quality-observations/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/quality-observations?month=2026-07`, t.managerToken));
    const rows = await res.json();
    assert.ok(allInScope(rows));
    assert.equal(rows.length, 1);
  });

  it('[C6] capa pagination slices the AUTHORIZED set (total = scoped count)', async () => {
    const route = (await import('@/app/api/capa-cases/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/capa-cases?limit=1&offset=0`, t.managerToken));
    const body = await res.json();
    assert.equal(body.total, 3);          // authorized count, not the table count (5)
    assert.equal(body.data.length, 1);   // page slices the authorized set
    assert.ok(['capaA1', 'capaFree', 'capaRelA2'].includes(body.data[0].id));
  });
});

// ══════════════════════════════════════════════════════════════
//  D. DASHBOARDS & EMPLOYEE-DERIVED AGGREGATES
// ══════════════════════════════════════════════════════════════
describe('M0.5 D — dashboard aggregates scoped', () => {
  let t: M05Tokens;
  const BASE = 'http://localhost/api';

  before(async () => {
    t = await freshWorld();
  });

  it('[D1] home/stats: manager totals + every section describe authorized employees only', async () => {
    const route = (await import('@/app/api/home/stats/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/home/stats`, t.managerToken));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.totalEmployees, 2);
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('موظف ب1'), 'out-of-scope name leaked into home/stats');
    assert.ok(!serialized.includes('موظف ب2'), 'out-of-scope name leaked into home/stats');
    for (const req of body.pendingRequestsDetails) assert.ok(A_IDS.has(req.employeeId));
    for (const tr of body.upcomingTravel) assert.ok(A_IDS.has(tr.employeeId));
  });

  it('[D2] home/stats: admin sees the whole workforce', async () => {
    const route = (await import('@/app/api/home/stats/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/home/stats`, t.adminToken));
    const body = await res.json();
    assert.equal(body.totalEmployees, 5);
  });

  it('[D3] home/stats: plain user (fail-closed scope) sees zero employees', async () => {
    const route = (await import('@/app/api/home/stats/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/home/stats`, t.userToken));
    const body = await res.json();
    assert.equal(body.totalEmployees, 0);
  });

  it('[D4] risk-center: manager risk rows + summary + department analysis are scoped', async () => {
    const route = (await import('@/app/api/risk-center/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/risk-center`, t.managerToken));
    assert.equal(res.status, 200);
    const body = await res.json();
    for (const r of body.employees) assert.ok(A_IDS.has(r.employeeId), `risk row ${r.employeeId} out of scope`);
    assert.equal(body.summary.totalEmployees, 2);
    for (const dept of Object.values(body.departmentAnalysis) as any[]) {
      assert.ok(dept.count <= 2, 'department analysis counted out-of-scope employees');
    }
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('موظف ب1'));
  });

  it('[D5] risk-center: admin sees all 5 employees', async () => {
    const route = (await import('@/app/api/risk-center/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/risk-center`, t.adminToken));
    const body = await res.json();
    assert.equal(body.summary.totalEmployees, 5);
  });

  it('[D6] kpi-dashboard: manager totals/leaderboards derive from authorized snapshot entries only', async () => {
    const route = (await import('@/app/api/kpi-dashboard/route')) as unknown as SimpleRoute;
    const res = await route.GET!(
      getRequest(`${BASE}/kpi-dashboard?range=custom&customMonths=2026-07`, t.managerToken),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.totalEmployees, 2);
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('empB1') && !serialized.includes('empB2'));
    assert.ok(!serialized.includes('موظف ب1') && !serialized.includes('موظف ب2'));
    for (const e of [...body.topEmployees, ...body.needsImprovement, ...body.bottomEmployees]) {
      assert.ok(A_IDS.has(e.employeeId));
    }
    // needsImprovement = below baseline 100 → only empA1 (90) for teamA.
    assert.deepEqual(body.needsImprovement.map((e: any) => e.employeeId), ['empA1']);
  });

  it('[D7] kpi-dashboard: admin sees all 4 scored employees', async () => {
    const route = (await import('@/app/api/kpi-dashboard/route')) as unknown as SimpleRoute;
    const res = await route.GET!(
      getRequest(`${BASE}/kpi-dashboard?range=custom&customMonths=2026-07`, t.adminToken),
    );
    const body = await res.json();
    assert.equal(body.totalEmployees, 4);
    assert.equal(body.needsImprovement.length, 3); // empA1 90, empB2 95, empB1 60
  });

  it('[D8] kpi-dashboard: department filter NARROWS the authorized set (∩, not replace)', async () => {
    const route = (await import('@/app/api/kpi-dashboard/route')) as unknown as SimpleRoute;
    const res = await route.GET!(
      getRequest(`${BASE}/kpi-dashboard?range=custom&customMonths=2026-07&department=${encodeURIComponent('التشغيل')}`, t.managerToken),
    );
    const body = await res.json();
    assert.equal(body.totalEmployees, 0, 'out-of-scope department filter must not bypass scope');
  });

  it('[D9] month-snapshot detail: manager gets authorized entries, rebuilt aggregates, filtered leaderboards + history', async () => {
    const route = (await import('@/app/api/month-snapshots/[id]/route')) as unknown as IdRoute;
    const res = await route.GET!(getRequest(`${BASE}/month-snapshots/2026-07`, t.managerToken), p('2026-07'));
    assert.equal(res.status, 200);
    const snap = await res.json();
    assert.deepEqual(new Set(Object.keys(snap.employeeScores)), new Set(['empA1', 'empA2']));
    // Rebuilt from authorized entries: 2 employees, 10 deduction pts, 2 observations.
    assert.equal(snap.departmentScores['المبيعات'].totalEmployees, 2);
    assert.equal(snap.departmentScores['المبيعات'].totalDeductionPoints, 10);
    assert.equal(snap.departmentScores['المبيعات'].totalObservations, 2);
    assert.deepEqual(snap.categoryTotals, { cat1: 10 });
    assert.equal(snap.approvalStats.total, 2);
    for (const e of [...snap.topEmployees, ...snap.bottomEmployees]) {
      assert.ok(A_IDS.has(e.employeeId));
    }
    const hist = snap.snapshotHistory[0];
    assert.deepEqual(new Set(Object.keys(hist.employeeScores)), new Set([])); // history held only empB1
    for (const e of [...hist.topEmployees, ...hist.bottomEmployees]) {
      assert.ok(A_IDS.has(e.employeeId));
    }
  });

  it('[D10] month-snapshot detail: admin gets the frozen snapshot untouched', async () => {
    const route = (await import('@/app/api/month-snapshots/[id]/route')) as unknown as IdRoute;
    const res = await route.GET!(getRequest(`${BASE}/month-snapshots/2026-07`, t.adminToken), p('2026-07'));
    const snap = await res.json();
    assert.equal(Object.keys(snap.employeeScores).length, 4);
    assert.equal(snap.topEmployees.length, 4);
    assert.equal(snap.categoryTotals.cat1, 55);
  });
});

// ══════════════════════════════════════════════════════════════
//  E. REPORTS & EXPORTS
// ══════════════════════════════════════════════════════════════
describe('M0.5 E — reports and exports scoped', () => {
  let t: M05Tokens;
  const BASE = 'http://localhost/api';

  before(async () => {
    t = await freshWorld();
  });

  it('[E1] reports/generate: manager rows + summary + meta describe authorized employees only', async () => {
    const route = (await import('@/app/api/reports/generate/route')) as unknown as SimpleRoute;
    const res = await route.POST!(jsonRequest(`${BASE}/reports/generate`, { month: '2026-07' }, bearerHeaders(t.managerToken)));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.meta.totalEmployees, 2);
    assert.equal(body.summary.totalEmployees, 2);
    for (const row of body.rows) assert.ok(A_IDS.has(row.employeeId));
    assert.equal(body.rows.length, 2);
  });

  it('[E2] reports/generate: admin builds rows for the whole workforce', async () => {
    const route = (await import('@/app/api/reports/generate/route')) as unknown as SimpleRoute;
    const res = await route.POST!(jsonRequest(`${BASE}/reports/generate`, { month: '2026-07' }, bearerHeaders(t.adminToken)));
    const body = await res.json();
    assert.equal(body.meta.totalEmployees, 5);
    assert.equal(body.rows.length, 5);
  });

  it('[E3] reports/capa: every aggregate section derives from authorized cases only', async () => {
    const route = (await import('@/app/api/reports/capa/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/reports/capa`, t.managerToken));
    assert.equal(res.status, 200);
    const body = await res.json();
    // capaA1 + capaFree + capaRelA2 visible; capaB1 + capaMix (mixed links) hidden.
    assert.equal(body.summary.total, 3);
    // byEmployee keys: authorized employees + the 'غير معرّف' bucket that
    // aggregates unlinked organizational cases — never an out-of-scope id.
    for (const empId of Object.keys(body.byEmployee)) {
      assert.ok(
        A_IDS.has(empId) || empId === 'غير معرّف',
        `byEmployee leaked out-of-scope id ${empId}`,
      );
    }
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('حالة ب') && !serialized.includes('حالة مختلطة'));
  });

  it('[E4] reports/capa: admin aggregates every case', async () => {
    const route = (await import('@/app/api/reports/capa/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/reports/capa`, t.adminToken));
    const body = await res.json();
    assert.equal(body.summary.total, 5);
  });

  it('[E5] reports/capa-export (csv): streamed file contains only authorized employees', async () => {
    const route = (await import('@/app/api/reports/capa-export/route')) as unknown as SimpleRoute;
    const res = await route.POST!(jsonRequest(`${BASE}/reports/capa-export`, { format: 'csv' }, bearerHeaders(t.managerToken)));
    assert.equal(res.status, 200);
    const csv = await res.text();
    assert.ok(csv.includes('موظف أ1'), 'in-scope employee missing from export');
    assert.ok(!csv.includes('موظف ب1'), 'out-of-scope employee leaked into export');
    assert.ok(csv.includes('حالة حرة'), 'unlinked capa missing from export');
  });

  it('[E6] reports/export (xlsx): the SERVER re-verifies posted rows — out-of-scope employees are dropped', async () => {
    const route = (await import('@/app/api/reports/export/route')) as unknown as SimpleRoute;
    const posted = [
      { employeeId: 'empA1', employeeName: 'موظف أ1', department: 'المبيعات', totalPresent: 20, totalLate: 0, totalAbsent: 0, totalExempt: 0, totalMinutesLate: 0, attendanceCompliance: 95, totalDeductionDays: 0 },
      { employeeId: 'empB1', employeeName: 'موظف ب1', department: 'المبيعات', totalPresent: 10, totalLate: 5, totalAbsent: 2, totalExempt: 0, totalMinutesLate: 120, attendanceCompliance: 60, totalDeductionDays: 3 },
    ];
    const res = await route.POST!(jsonRequest(`${BASE}/reports/export`, { month: '2026-07', data: posted }, bearerHeaders(t.managerToken)));
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')!.includes('spreadsheetml'));
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await res.arrayBuffer(), { type: 'array' });
    // Real headers sit on sheet row 5 (rows 1–4 are title/section bands).
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { range: 4 });
    const dataRows = rows.filter((r) => r['اسم الموظف']);
    assert.equal(dataRows.length, 1, 'out-of-scope posted row must be dropped server-side');
    assert.equal(dataRows[0]['اسم الموظف'], 'موظف أ1');
  });

  it('[E7] reports/export: admin exports every posted row', async () => {
    const route = (await import('@/app/api/reports/export/route')) as unknown as SimpleRoute;
    const posted = [
      { employeeId: 'empA1', employeeName: 'موظف أ1', department: 'المبيعات', totalPresent: 20, attendanceCompliance: 95 },
      { employeeId: 'empB1', employeeName: 'موظف ب1', department: 'المبيعات', totalPresent: 10, attendanceCompliance: 60 },
    ];
    const res = await route.POST!(jsonRequest(`${BASE}/reports/export`, { month: '2026-07', data: posted }, bearerHeaders(t.adminToken)));
    assert.equal(res.status, 200);
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await res.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { range: 4 });
    assert.equal(rows.filter((r) => r['اسم الموظف']).length, 2);
  });
});

// ══════════════════════════════════════════════════════════════
//  F/G. OPTIONAL-LINK + relatedEmployeeIds RULES
// ══════════════════════════════════════════════════════════════
describe('M0.5 F/G — optional-link and relatedEmployeeIds rules', () => {
  let t: M05Tokens;
  const BASE = 'http://localhost/api';

  before(async () => {
    t = await freshWorld();
  });

  it('[F1] unlinked complaint stays visible to a scoped viewer', async () => {
    const route = (await import('@/app/api/complaints/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/complaints`, t.readerTeamToken));
    const rows = await res.json();
    assert.ok(rows.some((r: any) => r.id === 'cmpFree'));
  });

  it('[F2] unlinked complaint → linked CAPA creation is allowed for a scoped viewer', async () => {
    const route = (await import('@/app/api/complaints/[id]/create-capa/route')) as unknown as IdRoute;
    const res = await route.POST!(idRequest(`${BASE}/complaints/cmpFree/create-capa`, 'POST', {}, t.readerTeamToken), p('cmpFree'));
    assert.ok(res.status < 300, `unlinked complaint escalation must pass (got ${res.status})`);
  });

  it('[G1] CAPA with relatedEmployeeIds outside scope is hidden from the LIST', async () => {
    const route = (await import('@/app/api/capa-cases/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/capa-cases`, t.managerToken));
    const body = await res.json();
    assert.ok(!body.data.some((r: any) => r.id === 'capaMix'), 'mixed-link case leaked into list');
  });

  it('[G2] CAPA with relatedEmployeeIds outside scope 404s on DETAIL (same body as unknown)', async () => {
    const route = (await import('@/app/api/capa-cases/[id]/route')) as unknown as IdRoute;
    const denied = await route.GET!(getRequest(`${BASE}/capa-cases/capaMix`, t.managerToken), p('capaMix'));
    const unknown = await route.GET!(getRequest(`${BASE}/capa-cases/nope`, t.managerToken), p('nope'));
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), await unknown.json());
  });

  it('[G3] CAPA whose every link is in scope stays visible', async () => {
    const route = (await import('@/app/api/capa-cases/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/capa-cases`, t.managerToken));
    const body = await res.json();
    assert.ok(body.data.some((r: any) => r.id === 'capaRelA2'));
  });
});

// ══════════════════════════════════════════════════════════════
//  H. FAIL-CLOSED — no configured scope ⇒ nothing readable
// ══════════════════════════════════════════════════════════════
describe('M0.5 H — fail-closed empty scope', () => {
  let t: M05Tokens;
  const BASE = 'http://localhost/api';

  before(async () => {
    t = await freshWorld();
  });

  it('[H1] no-scope viewer: attendance list is empty (permission alone reads nothing)', async () => {
    const route = (await import('@/app/api/attendance/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/attendance`, t.readerNoscopeToken));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []);
  });

  it('[H2] no-scope viewer: capa list shows only unlinked organizational cases', async () => {
    const route = (await import('@/app/api/capa-cases/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/capa-cases`, t.readerNoscopeToken));
    const body = await res.json();
    assert.deepEqual(body.data.map((r: any) => r.id), ['capaFree']);
  });

  it('[H3] no-scope viewer: in-scope-looking observation detail 404s', async () => {
    const route = (await import('@/app/api/quality-observations/[id]/route')) as unknown as IdRoute;
    const res = await route.GET!(getRequest(`${BASE}/quality-observations/obsA1`, t.readerNoscopeToken), p('obsA1'));
    assert.equal(res.status, 404);
  });

  it('[H4] default user (no employees scope configured): home/stats reports zero employees', async () => {
    const route = (await import('@/app/api/home/stats/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/home/stats`, t.userToken));
    const body = await res.json();
    assert.equal(body.totalEmployees, 0);
    assert.equal(body.pendingRequests, 0);
  });
});

// ══════════════════════════════════════════════════════════════
//  I. UNRESTRICTED FAST PATH — 'all' scope, zero org DB reads
// ══════════════════════════════════════════════════════════════
describe('M0.5 I — unrestricted viewers take the zero-read fast path', () => {
  let t: M05Tokens;
  const BASE = 'http://localhost/api';

  before(async () => {
    t = await freshWorld();
  });

  it('[I1] admin attendance GET resolves scope WITHOUT reading orgNodes/employees', async () => {
    const route = (await import('@/app/api/attendance/route')) as unknown as SimpleRoute;
    const start = calls.length; // only inspect calls issued by THIS request
    const res = await route.GET!(getRequest(`${BASE}/attendance`, t.adminToken));
    assert.equal(res.status, 200);
    // orgNodes is read ONLY when the engine must expand a restricted
    // scope — its absence proves the 'all' fast path (employee reads
    // below are name enrichment, which happens after scoping).
    const tablesRead = calls
      .slice(start)
      .filter((c) => c.fn === 'getAll')
      .map((c) => c.args[0]);
    assert.ok(!tablesRead.includes('orgNodes'), 'fast path must not read orgNodes');
  });

  it('[I2] hr viewer sees the full attendance list (configured all)', async () => {
    const route = (await import('@/app/api/attendance/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/attendance`, t.hrToken));
    const rows = await res.json();
    assert.equal(rows.length, 3);
  });

  it('[I3] quality viewer sees the full observations list (configured all)', async () => {
    const route = (await import('@/app/api/quality-observations/route')) as unknown as SimpleRoute;
    const res = await route.GET!(getRequest(`${BASE}/quality-observations`, t.qualityToken));
    const rows = await res.json();
    assert.equal(rows.length, 2);
  });
});

// ══════════════════════════════════════════════════════════════
//  J. M0.4 GAP REMEDIATION — derived write paths now scoped
// ══════════════════════════════════════════════════════════════
describe('M0.5 J — M0.4 gap remediation (derived CAPA creations + bulk upload)', () => {
  let t: M05Tokens;
  const BASE = 'http://localhost/api';

  before(async () => {
    t = await freshWorld();
  });

  it('[J1] travel/upload with a RESTRICTED scope → 403 (bulk writes need unrestricted)', async () => {
    const route = (await import('@/app/api/travel/upload/route')) as unknown as SimpleRoute;
    const blob = await xlsxBlob([['DEAL', 'NAMES', 'Status'], ['D1', 'عميل', 'upcoming']]);
    const fd = new FormData();
    fd.append('file', blob, 'travel.xlsx');
    const res = await route.POST!(new Request(`${BASE}/travel/upload`, {
      method: 'POST', headers: bearerHeaders(t.readerTeamToken), body: fd,
    }));
    assert.equal(res.status, 403);
  });

  it('[J2] travel/upload as admin proceeds past the scope gate (valid sheet accepted)', async () => {
    const route = (await import('@/app/api/travel/upload/route')) as unknown as SimpleRoute;
    const blob = await xlsxBlob([['DEAL', 'NAMES', 'Status'], ['D1', 'عميل', 'upcoming']]);
    const fd = new FormData();
    fd.append('file', blob, 'travel.xlsx');
    const res = await route.POST!(new Request(`${BASE}/travel/upload`, {
      method: 'POST', headers: bearerHeaders(t.adminToken), body: fd,
    }));
    assert.equal(res.status, 200);
  });

  it('[J3] follow-up escalate-capa OUT of scope → 404 same body as unknown id', async () => {
    const route = (await import('@/app/api/follow-ups/[id]/escalate-capa/route')) as unknown as IdRoute;
    const denied = await route.POST!(idRequest(`${BASE}/follow-ups/fuB1/escalate-capa`, 'POST', {}, t.readerTeamToken), p('fuB1'));
    const unknown = await route.POST!(idRequest(`${BASE}/follow-ups/nope/escalate-capa`, 'POST', {}, t.readerTeamToken), p('nope'));
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), await unknown.json());
  });

  it('[J4] follow-up escalate-capa IN scope → CAPA created', async () => {
    const route = (await import('@/app/api/follow-ups/[id]/escalate-capa/route')) as unknown as IdRoute;
    const res = await route.POST!(idRequest(`${BASE}/follow-ups/fuA1/escalate-capa`, 'POST', {}, t.readerTeamToken), p('fuA1'));
    assert.ok(res.status < 300, `in-scope escalation must pass (got ${res.status})`);
    const createdCapa = (await import('./m01-test-support')).createdRecords;
    assert.ok(createdCapa.some((r) => r.table === 'capaCases' && (r.data as any).relatedFollowUpId === 'fuA1'));
  });

  it('[J5] complaint create-capa OUT of scope (linked) → 404 same body as unknown id', async () => {
    const route = (await import('@/app/api/complaints/[id]/create-capa/route')) as unknown as IdRoute;
    const denied = await route.POST!(idRequest(`${BASE}/complaints/cmpB1/create-capa`, 'POST', {}, t.managerToken), p('cmpB1'));
    const unknown = await route.POST!(idRequest(`${BASE}/complaints/nope/create-capa`, 'POST', {}, t.managerToken), p('nope'));
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), await unknown.json());
  });

  it('[J6] quality deduction create-capa OUT of scope → 404 same body as unknown id', async () => {
    const route = (await import('@/app/api/quality/[id]/create-capa/route')) as unknown as IdRoute;
    const denied = await route.POST!(idRequest(`${BASE}/quality/qdB1/create-capa`, 'POST', {}, t.readerTeamToken), p('qdB1'));
    const unknown = await route.POST!(idRequest(`${BASE}/quality/nope/create-capa`, 'POST', {}, t.readerTeamToken), p('nope'));
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), await unknown.json());
  });

  it('[J7] hr deduction create-capa OUT of scope → 404 same body as unknown id', async () => {
    const route = (await import('@/app/api/hr-deductions/[id]/create-capa/route')) as unknown as IdRoute;
    const denied = await route.POST!(idRequest(`${BASE}/hr-deductions/hrB1/create-capa`, 'POST', {}, t.readerTeamToken), p('hrB1'));
    const unknown = await route.POST!(idRequest(`${BASE}/hr-deductions/nope/create-capa`, 'POST', {}, t.readerTeamToken), p('nope'));
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), await unknown.json());
  });

  it('[J8] quality deduction create-capa IN scope → CAPA created', async () => {
    const route = (await import('@/app/api/quality/[id]/create-capa/route')) as unknown as IdRoute;
    const res = await route.POST!(idRequest(`${BASE}/quality/qdA1/create-capa`, 'POST', {}, t.readerTeamToken), p('qdA1'));
    assert.ok(res.status < 300, `in-scope quality escalation must pass (got ${res.status})`);
  });
});

// ══════════════════════════════════════════════════════════════
//  K. STATIC SECURITY CHECKS — adoption is structural, not ad hoc
// ══════════════════════════════════════════════════════════════
describe('M0.5 K — static security checks', () => {
  const R = (rel: string) => join(process.cwd(), 'src', ...rel.split('/'));

  it('[K1] every employee-linked LIST route applies the canonical row filter', () => {
    const listRoutes = [
      'app/api/attendance/route.ts',
      'app/api/requests/route.ts',
      'app/api/biometric/route.ts',
      'app/api/travel/route.ts',
      'app/api/follow-ups/route.ts',
      'app/api/complaints/route.ts',
      'app/api/capa-cases/route.ts',
      'app/api/quality/route.ts',
      'app/api/quality-observations/route.ts',
      'app/api/hr-deductions/route.ts',
    ];
    for (const rel of listRoutes) {
      const path = R(rel);
      assert.ok(existsSync(path), `${rel} missing`);
      const src = readFileSync(path, 'utf8');
      assert.ok(src.includes('filterRowsByEmployeeScope'), `${rel} must filter rows by employee scope`);
      assert.ok(src.includes('resolveEmployeeScopeFromDb'), `${rel} must resolve scope via the canonical engine`);
    }
  });

  it('[K2] detail routes use the single-record scope decision with 404 masking', () => {
    for (const rel of ['app/api/capa-cases/[id]/route.ts', 'app/api/quality-observations/[id]/route.ts']) {
      const src = readFileSync(R(rel), 'utf8');
      assert.ok(src.includes('linkedRecordInScope'), `${rel} must use linkedRecordInScope`);
    }
  });

  it('[K3] scope runs BEFORE filters in list routes (AUTHORIZED_SCOPE ∩ FILTER, never filter-then-scope)', () => {
    const cases: Array<[string, string]> = [
      ['app/api/capa-cases/route.ts', 'Server-side filters'],
      ['app/api/quality-observations/route.ts', 'Apply filters'],
      ['app/api/reports/capa/route.ts', 'Apply query-param filters'],
      ['app/api/hr-deductions/route.ts', 'if (status)'],
    ];
    for (const [rel, filterMarker] of cases) {
      const src = readFileSync(R(rel), 'utf8');
      const scopeIdx = src.indexOf('filterRowsByEmployeeScope');
      const filterIdx = src.indexOf(filterMarker);
      assert.ok(scopeIdx !== -1 && filterIdx !== -1, `${rel}: markers missing`);
      assert.ok(scopeIdx < filterIdx, `${rel}: scope must run before filters`);
    }
  });

  it('[K4] reports/export re-verifies posted rows SERVER-side', () => {
    const src = readFileSync(R('app/api/reports/export/route.ts'), 'utf8');
    assert.ok(src.includes('filterRowsByEmployeeScope'), 'export must filter posted rows server-side');
  });

  it('[K5] dashboards scope at the aggregate boundary (kpi service + snapshot detail + home + risk)', () => {
    const kpiRoute = readFileSync(R('app/api/kpi-dashboard/route.ts'), 'utf8');
    assert.ok(kpiRoute.includes('authorizedEmployeeIds'), 'kpi-dashboard route must pass the authorized set');
    const kpiSvc = readFileSync(R('lib/kpi-dashboard/index.ts'), 'utf8');
    assert.ok(kpiSvc.includes('restrictSnapshotToEmployees'), 'kpi service must restrict snapshots');
    assert.ok(
      kpiSvc.indexOf('restrictSnapshotToEmployees') < kpiSvc.indexOf('if (!department && !employeeId)'),
      'kpi service: authorization must run before cosmetic filters',
    );
    const snapRoute = readFileSync(R('app/api/month-snapshots/[id]/route.ts'), 'utf8');
    assert.ok(snapRoute.includes('scopeMonthSnapshotToEmployees'));
    const home = readFileSync(R('app/api/home/stats/route.ts'), 'utf8');
    assert.ok(home.includes('filterEmployeesInScope') && home.includes('filterRowsByEmployeeScope'));
    const risk = readFileSync(R('app/api/risk-center/route.ts'), 'utf8');
    assert.ok(risk.includes('filterEmployeesInScope') && risk.includes('filterRowsByEmployeeScope'));
    const gen = readFileSync(R('app/api/reports/generate/route.ts'), 'utf8');
    assert.ok(gen.includes('filterEmployeesInScope'), 'reports/generate must scope the employees array');
  });

  it('[K6] M0.4 gap routes carry the target-employee scope guard', () => {
    const gapRoutes = [
      'app/api/follow-ups/[id]/escalate-capa/route.ts',
      'app/api/complaints/[id]/create-capa/route.ts',
      'app/api/quality/[id]/create-capa/route.ts',
      'app/api/hr-deductions/[id]/create-capa/route.ts',
    ];
    for (const rel of gapRoutes) {
      const src = readFileSync(R(rel), 'utf8');
      assert.ok(src.includes('employeeInScope'), `${rel} must check the stored target employee scope`);
    }
    const upload = readFileSync(R('app/api/travel/upload/route.ts'), 'utf8');
    assert.ok(upload.includes('hasUnrestrictedEmployeeScope'), 'travel/upload must demand unrestricted scope');
  });
});
