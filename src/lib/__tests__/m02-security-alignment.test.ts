// ══════════════════════════════════════════════════════════════
//  M0.2 security tests — authenticated permission alignment
//
//  Every M0.2 target endpoint must enforce the SAME chain the
//  frontend enforces (authentication → effective permission →
//  resource access):
//
//    A. no Authorization header        → 401
//    B. dummy Bearer token             → 401
//    C. tampered token signature       → 401
//    D. authenticated, permission none → 403
//    E. authenticated, read level      → 200 (read is sufficient)
//    F. authenticated, edit level      → 200
//    G. admin                          → 200 (existing bypass)
//
//  Plus the STORED-OVERRIDE regression: the backend must resolve
//  role preset + stored map exactly like the frontend
//  (resolveEffectivePermissions) — stored 'none' beats a role grant,
//  a stored grant beats a role deny.
// ══════════════════════════════════════════════════════════════

import './m01-test-support';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerFixtures,
  registerUser,
  mintToken,
  resetTestData,
  setTable,
  bearerHeaders,
  tamperToken,
  type TestTokens,
} from './m01-test-support';
import { verifyPermission } from '@/lib/verify-permission';
import {
  resolveEffectivePermissions,
  migratePermission,
} from '@/config/permissions';

// Firebase must look UNCONFIGURED so admin-gated Firebase-dependent
// routes can
// deterministically observe the "past the permission gate" outcome
// (503 service-not-configured) without any network access.
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_PRIVATE_KEY;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_DATABASE_URL;

interface GetRoute {
  GET: (req: Request, ctx?: unknown) => Promise<Response>;
}
interface PostRoute {
  POST: (req: Request) => Promise<Response>;
}

const MONTH_SNAP_TABLE = 'monthSnapshots';

function getRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

/** Register the 5 role fixtures + one user per custom stored map. */
async function fixturesWithOverrides(): Promise<TestTokens & {
  qualityRiskNone: string;   // quality role, stored riskCenter:'none' (role grants)
  managerRulesRead: string;  // manager role, stored rulesEngine:'read' (role denies)
  userEmployeesNone: string; // user role, stored employees:'none' (role grants)
  userKpiRead: string;       // user role, stored kpiDashboard:'read' (role denies)
}> {
  const base = await registerFixtures();

  registerUser({
    id: 'u-quality-risknone', email: 'qn@test.local', name: 'جودة مقيّد', role: 'quality',
    permissions: { riskCenter: 'none' },
  });
  registerUser({
    id: 'u-manager-rulesread', email: 'mr@test.local', name: 'مدير موسّع', role: 'manager',
    permissions: { rulesEngine: 'read' },
  });
  registerUser({
    id: 'u-user-empnone', email: 'un@test.local', name: 'مستخدم مقيّد', role: 'user',
    permissions: { employees: 'none' },
  });
  registerUser({
    id: 'u-user-kpiread', email: 'uk@test.local', name: 'مستخدم موسّع', role: 'user',
    permissions: { kpiDashboard: 'read' },
  });

  const [qualityRiskNone, managerRulesRead, userEmployeesNone, userKpiRead] = await Promise.all([
    mintToken({ userId: 'u-quality-risknone', email: 'qn@test.local', role: 'quality' }),
    mintToken({ userId: 'u-manager-rulesread', email: 'mr@test.local', role: 'manager' }),
    mintToken({ userId: 'u-user-empnone', email: 'un@test.local', role: 'user' }),
    mintToken({ userId: 'u-user-kpiread', email: 'uk@test.local', role: 'user' }),
  ]);

  return { ...base, qualityRiskNone, managerRulesRead, userEmployeesNone, userKpiRead };
}

/** Seed every table the target routes read so 200s carry real rows. */
function seedTables(): void {
  setTable('automationRules', [
    { id: 'r1', name: 'قاعدة ١', description: '', module: 'capa', priority: 'medium', status: 'active', triggerType: 'manual', createdAt: '2026-08-01T00:00:00.000Z' },
  ]);
  setTable('ruleExecutionLogs', [
    { id: 'l1', ruleId: 'r1', result: 'success', createdAt: '2026-08-01T00:00:00.000Z' },
  ]);
  setTable('employees', [
    { id: 'e1', code: '001', name: 'موظف اختبار', department: 'الدعم', createdAt: '2026-08-01T00:00:00.000Z' },
  ]);
  setTable('deductionRules', [
    { id: 'd1', key: 'late', label: 'تأخير', amount: 50, unit: 'EGP' },
  ]);
  setTable(MONTH_SNAP_TABLE, [
    {
      id: '2026-07', monthKey: '2026-07', status: 'closed',
      employeeScores: { e1: { score: 90 } }, departmentScores: { 'الدعم': { score: 90 } },
      approvalStats: { approved: 0, pending: 0, rejected: 0 },
      snapshotHistory: [], closedAt: '2026-08-01T00:00:00.000Z',
    },
  ]);
}

// ══════════════════════════════════════════════════════════════
//  1. KPI Dashboard  —  GET /api/kpi-dashboard  ('kpiDashboard' view)
//     stock levels: admin bypass · hr/manager/quality read · user none
// ══════════════════════════════════════════════════════════════
describe('M0.2 — kpi-dashboard GET', () => {
  let route: GetRoute;
  let t: Awaited<ReturnType<typeof fixturesWithOverrides>>;
  const URL = 'http://localhost/api/kpi-dashboard?range=current_month';

  before(async () => {
    route = (await import('@/app/api/kpi-dashboard/route')) as unknown as GetRoute;
    resetTestData();
    t = await fixturesWithOverrides();
    seedTables();
  });

  it('A. no Authorization header → 401', async () => {
    assert.equal((await route.GET(getRequest(URL))).status, 401);
  });
  it('B. dummy Bearer token → 401', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders('x')))).status, 401);
  });
  it('C. tampered token signature → 401', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(tamperToken(t.hrToken))))).status, 401);
  });
  it("D. 'user' role (kpiDashboard none) → 403", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.userToken)))).status, 403);
  });
  it("E. 'hr' role (kpiDashboard read) → 200", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.hrToken)))).status, 200);
  });
  it("F. admin token → 200 (admin bypass)", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.adminToken)))).status, 200);
  });
  it('stored grant: user role + stored kpiDashboard read → 200', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.userKpiRead)))).status, 200);
  });
});

// ══════════════════════════════════════════════════════════════
//  2a. Month Snapshots list — GET /api/month-snapshots
//  2b. Month Snapshots detail — GET /api/month-snapshots/[id]
//     ('kpiDashboard' view — snapshots ARE the dashboard's data)
// ══════════════════════════════════════════════════════════════
describe('M0.2 — month-snapshots GET (list)', () => {
  let route: GetRoute;
  let t: Awaited<ReturnType<typeof fixturesWithOverrides>>;
  const URL = 'http://localhost/api/month-snapshots';

  before(async () => {
    route = (await import('@/app/api/month-snapshots/route')) as unknown as GetRoute;
    resetTestData();
    t = await fixturesWithOverrides();
    seedTables();
  });

  it('A. no Authorization header → 401', async () => {
    assert.equal((await route.GET(getRequest(URL))).status, 401);
  });
  it('B. dummy Bearer token → 401', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders('x')))).status, 401);
  });
  it('C. tampered token signature → 401', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(tamperToken(t.managerToken))))).status, 401);
  });
  it("D. 'user' role (kpiDashboard none) → 403", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.userToken)))).status, 403);
  });
  it("E. 'manager' role (kpiDashboard read) → 200 with the seeded month", async () => {
    const res = await route.GET(getRequest(URL, bearerHeaders(t.managerToken)));
    assert.equal(res.status, 200);
    const list = (await res.json()) as Array<{ monthKey: string }>;
    assert.equal(list[0]?.monthKey, '2026-07');
  });
  it("F. admin token → 200 (admin bypass)", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.adminToken)))).status, 200);
  });
});

describe('M0.2 — month-snapshots/[id] GET (detail)', () => {
  let route: GetRoute;
  let t: Awaited<ReturnType<typeof fixturesWithOverrides>>;
  const URL = 'http://localhost/api/month-snapshots/2026-07';

  before(async () => {
    route = (await import('@/app/api/month-snapshots/[id]/route')) as unknown as GetRoute;
    resetTestData();
    t = await fixturesWithOverrides();
    seedTables();
  });

  it('A. no Authorization header → 401', async () => {
    const res = await route.GET(getRequest(URL), { params: Promise.resolve({ id: '2026-07' }) });
    assert.equal(res.status, 401);
  });
  it('B. dummy Bearer token → 401', async () => {
    const res = await route.GET(getRequest(URL, bearerHeaders('x')), { params: Promise.resolve({ id: '2026-07' }) });
    assert.equal(res.status, 401);
  });
  it("D. 'user' role (kpiDashboard none) → 403", async () => {
    const res = await route.GET(getRequest(URL, bearerHeaders(t.userToken)), { params: Promise.resolve({ id: '2026-07' }) });
    assert.equal(res.status, 403);
  });
  it("E. 'quality' role (kpiDashboard read) → 200 with the frozen month", async () => {
    const res = await route.GET(getRequest(URL, bearerHeaders(t.qualityToken)), { params: Promise.resolve({ id: '2026-07' }) });
    assert.equal(res.status, 200);
    const detail = (await res.json()) as { monthKey?: string; status?: string };
    assert.equal(detail.monthKey, '2026-07');
    assert.equal(detail.status, 'closed');
  });
  it('stored grant: user role + stored kpiDashboard read → 200', async () => {
    const res = await route.GET(getRequest(URL, bearerHeaders(t.userKpiRead)), { params: Promise.resolve({ id: '2026-07' }) });
    assert.equal(res.status, 200);
  });
});

// ══════════════════════════════════════════════════════════════
//  3. Risk Center — GET /api/risk-center  ('riskCenter' view)
//     stock levels: admin bypass · manager/default read · quality
//     edit · hr none
// ══════════════════════════════════════════════════════════════
describe('M0.2 — risk-center GET', () => {
  let route: GetRoute;
  let t: Awaited<ReturnType<typeof fixturesWithOverrides>>;
  const URL = 'http://localhost/api/risk-center';

  before(async () => {
    route = (await import('@/app/api/risk-center/route')) as unknown as GetRoute;
    resetTestData();
    t = await fixturesWithOverrides();
    seedTables();
  });

  it('A. no Authorization header → 401', async () => {
    assert.equal((await route.GET(getRequest(URL))).status, 401);
  });
  it('B. dummy Bearer token → 401', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders('x')))).status, 401);
  });
  it('C. tampered token signature → 401', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(tamperToken(t.userToken))))).status, 401);
  });
  it("D. 'hr' role (riskCenter none) → 403", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.hrToken)))).status, 403);
  });
  it("E. 'user' role (riskCenter read) → 200", async () => {
    const res = await route.GET(getRequest(URL, bearerHeaders(t.userToken)));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { summary?: { totalEmployees?: number } };
    // M0.5: the default user role carries no employees scope, so its
    // read is FAIL-CLOSED — the endpoint answers 200 (permission OK)
    // but every aggregate derives from an empty authorized set.
    assert.equal(body.summary?.totalEmployees, 0);
  });
  it("F. 'quality' role (riskCenter edit) → 200", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.qualityToken)))).status, 200);
  });
  it('stored denial: quality role + stored riskCenter none → 403', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.qualityRiskNone)))).status, 403);
  });
});

// ══════════════════════════════════════════════════════════════
//  4. Rule Log — GET /api/rule-logs  ('rulesEngine' view)
//     stock levels: admin bypass · quality edit · hr/manager/user none
// ══════════════════════════════════════════════════════════════
describe('M0.2 — rule-logs GET', () => {
  let route: GetRoute;
  let t: Awaited<ReturnType<typeof fixturesWithOverrides>>;
  const URL = 'http://localhost/api/rule-logs?limit=50';

  before(async () => {
    route = (await import('@/app/api/rule-logs/route')) as unknown as GetRoute;
    resetTestData();
    t = await fixturesWithOverrides();
    seedTables();
  });

  it('A. no Authorization header → 401', async () => {
    assert.equal((await route.GET(getRequest(URL))).status, 401);
  });
  it('B. dummy Bearer token → 401', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders('x')))).status, 401);
  });
  it("D. 'manager' role (rulesEngine none) → 403", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.managerToken)))).status, 403);
  });
  it("E/F. 'quality' role (rulesEngine edit) → 200 with the seeded log", async () => {
    const res = await route.GET(getRequest(URL, bearerHeaders(t.qualityToken)));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data?: Array<{ id: string }>; total?: number };
    assert.equal(body.total, 1);
    assert.equal(body.data?.[0]?.id, 'l1');
  });
  it('stored grant: manager role + stored rulesEngine read → 200', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.managerRulesRead)))).status, 200);
  });
});

// ══════════════════════════════════════════════════════════════
//  5. Employees — GET /api/employees  ('employees' view)
//     every stock role has employees ≥ read; the none case is only
//     reachable via a stored override (tested here)
// ══════════════════════════════════════════════════════════════
describe('M0.2 — employees GET', () => {
  let route: GetRoute;
  let t: Awaited<ReturnType<typeof fixturesWithOverrides>>;
  const URL = 'http://localhost/api/employees';

  before(async () => {
    route = (await import('@/app/api/employees/route')) as unknown as GetRoute;
    resetTestData();
    t = await fixturesWithOverrides();
    seedTables();
  });

  it('A. no Authorization header → 401', async () => {
    assert.equal((await route.GET(getRequest(URL))).status, 401);
  });
  it('B. dummy Bearer token → 401', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders('x')))).status, 401);
  });
  it('C. tampered token signature → 401', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(tamperToken(t.hrToken))))).status, 401);
  });
  it("E. 'user' role (employees read) → 200, EMPTY list (M0.3 fail-closed scope)", async () => {
    // M0.2 expectation updated by M0.3: this used to return the
    // seeded employee because the scope engine was inert (everyone
    // resolved 'all'). M0.3 DEFAULT SCOPE SAFETY: the generic user
    // role has no configured employees scope and no employee
    // linkage, so the data scope fails closed to 'own' → empty set.
    // The PERMISSION still holds (200, not 403) — permission and
    // scope are separate axes.
    const res = await route.GET(getRequest(URL, bearerHeaders(t.userToken)));
    assert.equal(res.status, 200);
    const list = (await res.json()) as Array<{ id: string }>;
    assert.equal(list.length, 0);
  });
  it("E2. 'user' role with an explicit wide stored scope → 200 with the seeded employee (M0.3)", async () => {
    // Explicit configuration is the sanctioned way to widen a scope:
    // stored scope 'all' on the employees entry → the engine fast
    // path returns the seeded employee again.
    registerUser({
      id: 'm03-user-wide', email: 'm03-wide@t.local', role: 'user',
      permissions: { employees: { level: 'read', scope: 'all' } },
    });
    const token = await mintToken({ userId: 'm03-user-wide', email: 'm03-wide@t.local', role: 'user' });
    const res = await route.GET(getRequest(URL, bearerHeaders(token)));
    assert.equal(res.status, 200);
    const list = (await res.json()) as Array<{ id: string }>;
    assert.equal(list[0]?.id, 'e1');
  });
  it("F. 'hr' role (employees edit) → 200", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.hrToken)))).status, 200);
  });
  it('stored denial: user role + stored employees none → 403', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.userEmployeesNone)))).status, 403);
  });
});

// ══════════════════════════════════════════════════════════════
//  7. Rules — GET /api/rules  ('rulesEngine' view)
// ══════════════════════════════════════════════════════════════
describe('M0.2 — rules GET', () => {
  let route: GetRoute;
  let t: Awaited<ReturnType<typeof fixturesWithOverrides>>;
  const URL = 'http://localhost/api/rules?limit=100';

  before(async () => {
    route = (await import('@/app/api/rules/route')) as unknown as GetRoute;
    resetTestData();
    t = await fixturesWithOverrides();
    seedTables();
  });

  it('A. no Authorization header → 401', async () => {
    assert.equal((await route.GET(getRequest(URL))).status, 401);
  });
  it('B. dummy Bearer token → 401', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders('x')))).status, 401);
  });
  it("D. 'hr' role (rulesEngine none) → 403", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.hrToken)))).status, 403);
  });
  it("E/F. 'quality' role (rulesEngine edit) → 200 with the seeded rule", async () => {
    const res = await route.GET(getRequest(URL, bearerHeaders(t.qualityToken)));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data?: Array<{ id: string }>; total?: number };
    assert.equal(body.total, 1);
    assert.equal(body.data?.[0]?.id, 'r1');
  });
  it('G. admin → 200 (admin bypass)', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.adminToken)))).status, 200);
  });
});

// ══════════════════════════════════════════════════════════════
//  8. Deduction Rules — GET /api/deduction-rules  ('rules' view)
//     every non-admin preset has rules none → admin-only in practice
// ══════════════════════════════════════════════════════════════
describe('M0.2 — deduction-rules GET', () => {
  let route: GetRoute;
  let t: Awaited<ReturnType<typeof fixturesWithOverrides>>;
  const URL = 'http://localhost/api/deduction-rules';

  before(async () => {
    route = (await import('@/app/api/deduction-rules/route')) as unknown as GetRoute;
    resetTestData();
    t = await fixturesWithOverrides();
    seedTables();
  });

  it('A. no Authorization header → 401', async () => {
    assert.equal((await route.GET(getRequest(URL))).status, 401);
  });
  it('B. dummy Bearer token → 401', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders('x')))).status, 401);
  });
  it("D. 'hr' role (rules none) → 403", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.hrToken)))).status, 403);
  });
  it("D. 'quality' role (rules none) → 403", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.qualityToken)))).status, 403);
  });
  it('G. admin → 200 with the seeded rule', async () => {
    const res = await route.GET(getRequest(URL, bearerHeaders(t.adminToken)));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data?: Array<{ key: string }>; total?: number };
    assert.equal(body.total, 1);
    assert.equal(body.data?.[0]?.key, 'late');
  });
});

// ══════════════════════════════════════════════════════════════
//  STORED PERMISSION REGRESSION — the resolver semantics
//
//  The backend must resolve role preset + stored override with the
//  SAME rule the frontend uses. This is the regression test for the
//  original inconsistency (frontend: preset+map, backend: map only).
// ══════════════════════════════════════════════════════════════
describe('M0.2 — stored override resolution semantics', () => {
  const KEY = 'riskCenter';

  before(async () => {
    resetTestData();
    await fixturesWithOverrides();
  });

  it("role grants + stored 'none' = effective 'none' (backend denies)", async () => {
    // quality grants riskCenter:edit; the stored map says none.
    const eff = resolveEffectivePermissions('quality', { [KEY]: 'none' });
    assert.equal(migratePermission(eff[KEY]).level, 'none');
    // Behavioral proof on the backend resolver (u-quality-risknone is
    // quality + stored {riskCenter:'none'}).
    const token = await mintToken({ userId: 'u-quality-risknone', email: 'qn@test.local', role: 'quality' });
    const verdict = await verifyPermission(
      getRequest('http://localhost/x', bearerHeaders(token)),
      KEY, 'view',
    );
    assert.equal(verdict.allowed, false);
  });

  it('role denies + stored grant = effective grant (frontend would show the page)', async () => {
    const eff = resolveEffectivePermissions('hr', { [KEY]: 'read' });
    assert.equal(migratePermission(eff[KEY]).level, 'read');
    // Behavioral proof: hr denies riskCenter, a stored grant re-opens it.
    registerUser({ id: 'u-hr-riskread', email: 'hr2@test.local', role: 'hr', permissions: { riskCenter: 'read' } });
    const token = await mintToken({ userId: 'u-hr-riskread', email: 'hr2@test.local', role: 'hr' });
    const verdict = await verifyPermission(
      getRequest('http://localhost/x', bearerHeaders(token)),
      KEY, 'view',
    );
    assert.equal(verdict.allowed, true);
  });

  it('missing stored key falls back to the role preset (not to none)', async () => {
    const eff = resolveEffectivePermissions('manager', {});
    assert.equal(migratePermission(eff[KEY]).level, 'read');
    const effHr = resolveEffectivePermissions('hr', {});
    assert.equal(migratePermission(effHr[KEY]).level, 'none');
  });
});

// ══════════════════════════════════════════════════════════════
//  FRONTEND / BACKEND PARITY REGRESSION
//
//  For every M0.2 page key and every stock role (+ the stored-override
//  users), the BACKEND gate decision (verifyPermission, used by the
//  routes above) must equal the FRONTEND gate decision (canView over
//  user.permissions, which AuthContext builds with the SAME
//  resolveEffectivePermissions). Admin bypasses both sides.
// ══════════════════════════════════════════════════════════════
describe('M0.2 — frontend/backend permission parity', () => {
  const M02_KEYS = [
    'kpiDashboard',
    'riskCenter',
    'rulesEngine',
    'employees',
    'rules',
  ];

  const CASES: Array<{ label: string; role: string; stored?: Record<string, unknown> }> = [
    { label: 'admin', role: 'admin' },
    { label: 'hr', role: 'hr' },
    { label: 'manager', role: 'manager' },
    { label: 'quality', role: 'quality' },
    { label: 'user', role: 'user' },
    { label: 'user + stored kpiDashboard read', role: 'user', stored: { kpiDashboard: 'read' } },
    { label: 'quality + stored riskCenter none', role: 'quality', stored: { riskCenter: 'none' } },
    { label: 'manager + stored rulesEngine read', role: 'manager', stored: { rulesEngine: 'read' } },
    { label: 'user + stored employees none', role: 'user', stored: { employees: 'none' } },
  ];

  it('verifyPermission(view) === frontend canView for every key × case', async () => {
    registerUser({ id: 'p-admin', email: 'p-admin@t.local', role: 'admin' });
    registerUser({ id: 'p-hr', email: 'p-hr@t.local', role: 'hr' });
    registerUser({ id: 'p-manager', email: 'p-mgr@t.local', role: 'manager' });
    registerUser({ id: 'p-quality', email: 'p-qual@t.local', role: 'quality' });
    registerUser({ id: 'p-user', email: 'p-user@t.local', role: 'user' });
    registerUser({ id: 'p-user-1', email: 'p1@t.local', role: 'user', permissions: { kpiDashboard: 'read' } });
    registerUser({ id: 'p-quality-1', email: 'p2@t.local', role: 'quality', permissions: { riskCenter: 'none' } });
    registerUser({ id: 'p-manager-1', email: 'p3@t.local', role: 'manager', permissions: { rulesEngine: 'read' } });
    registerUser({ id: 'p-user-2', email: 'p4@t.local', role: 'user', permissions: { employees: 'none' } });

    const userIdByLabel: Record<string, string> = {
      admin: 'p-admin', hr: 'p-hr', manager: 'p-manager', quality: 'p-quality', user: 'p-user',
      'user + stored kpiDashboard read': 'p-user-1',
      'quality + stored riskCenter none': 'p-quality-1',
      'manager + stored rulesEngine read': 'p-manager-1',
      'user + stored employees none': 'p-user-2',
    };

    for (const c of CASES) {
      const userId = userIdByLabel[c.label];
      const token = await mintToken({ userId, email: `${userId}@t.local`, role: c.role });

      // Frontend semantics: AuthContext builds user.permissions with the
      // same resolver; canView = level !== 'none' (admin short-circuits).
      const frontendMap = resolveEffectivePermissions(c.role, c.stored);
      const frontendCanView = (key: string) =>
        c.role === 'admin' || migratePermission(frontendMap[key]).level !== 'none';

      for (const key of M02_KEYS) {
        const verdict = await verifyPermission(
          getRequest('http://localhost/x', bearerHeaders(token)),
          key, 'view',
        );
        assert.equal(
          verdict.allowed,
          frontendCanView(key),
          `parity broken for [${c.label}] page '${key}': backend=${verdict.allowed} frontend=${frontendCanView(key)}`,
        );
      }
    }
  });
});
