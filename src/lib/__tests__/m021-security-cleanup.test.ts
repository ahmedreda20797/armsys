// ══════════════════════════════════════════════════════════════
//  M0.2.1 security tests — authorization surface cleanup
//
//  The three remaining auth-only GET reads must enforce the SAME
//  chain the frontend enforces (authentication → effective
//  permission → resource access), each gated by the EXISTING page
//  key its sibling mutation and its UI page already use:
//
//    GET /api/quality-observations   → 'observations' view
//    GET /api/observation-categories → 'observationCategories' view
//    GET /api/kpi-settings           → 'kpiSettings' view
//
//  Matrix per endpoint:
//    A. no Authorization header        → 401
//    B. dummy Bearer token             → 401
//    C. tampered token signature       → 401
//    D. authenticated, permission none → 403
//    E. authenticated, read level      → 200
//    F. authenticated, edit level      → 200
//    G. admin                          → 200 (existing bypass)
//
//  Plus stored-override semantics (stored 'none' beats a role grant,
//  stored grant beats a role deny, missing key falls back to the
//  preset), frontend/backend parity, and the CAPA POST actor-identity
//  proofs (authenticated identity wins over body.createdBy).
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
  jsonRequest,
  createdRecords,
  type TestTokens,
} from './m01-test-support';
import { verifyPermission } from '@/lib/verify-permission';
import {
  resolveEffectivePermissions,
  migratePermission,
} from '@/config/permissions';

interface GetRoute {
  GET: (req: Request, ctx?: unknown) => Promise<Response>;
}
interface PostRoute {
  POST: (req: Request) => Promise<Response>;
}

function getRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

/** Register the 5 role fixtures + one user per custom stored map. */
async function fixturesWithOverrides(): Promise<TestTokens & {
  qualityObsNone: string;     // quality role, stored observations:'none' (role grants)
  hrObsRead: string;          // hr role, stored observations:'read' (role denies)
  qualityCatsNone: string;    // quality role, stored observationCategories:'none' (role grants read)
  userCatsRead: string;       // user role, stored observationCategories:'read' (role denies)
  managerKpiNone: string;     // manager role, stored kpiSettings:'none' (role grants edit)
  hrKpiRead: string;          // hr role, stored kpiSettings:'read' (role denies)
}> {
  const base = await registerFixtures();

  registerUser({
    id: 'u-quality-obsnone', email: 'qon@test.local', name: 'جودة مقيّد', role: 'quality',
    permissions: { observations: 'none' },
  });
  registerUser({
    id: 'u-hr-obsread', email: 'hor@test.local', name: 'موارد موسّعة', role: 'hr',
    permissions: { observations: 'read' },
  });
  registerUser({
    id: 'u-quality-catsnone', email: 'qcn@test.local', name: 'جودة بلا تصنيفات', role: 'quality',
    permissions: { observationCategories: 'none' },
  });
  registerUser({
    id: 'u-user-catsread', email: 'ucr@test.local', name: 'مستخدم موسّع', role: 'user',
    permissions: { observationCategories: 'read' },
  });
  registerUser({
    id: 'u-manager-kpinone', email: 'mkn@test.local', name: 'مدير مقيّد', role: 'manager',
    permissions: { kpiSettings: 'none' },
  });
  registerUser({
    id: 'u-hr-kpiread', email: 'hkr@test.local', name: 'موارد إعدادات', role: 'hr',
    permissions: { kpiSettings: 'read' },
  });

  const [
    qualityObsNone, hrObsRead, qualityCatsNone, userCatsRead, managerKpiNone, hrKpiRead,
  ] = await Promise.all([
    mintToken({ userId: 'u-quality-obsnone', email: 'qon@test.local', role: 'quality' }),
    mintToken({ userId: 'u-hr-obsread', email: 'hor@test.local', role: 'hr' }),
    mintToken({ userId: 'u-quality-catsnone', email: 'qcn@test.local', role: 'quality' }),
    mintToken({ userId: 'u-user-catsread', email: 'ucr@test.local', role: 'user' }),
    mintToken({ userId: 'u-manager-kpinone', email: 'mkn@test.local', role: 'manager' }),
    mintToken({ userId: 'u-hr-kpiread', email: 'hkr@test.local', role: 'hr' }),
  ]);

  return { ...base, qualityObsNone, hrObsRead, qualityCatsNone, userCatsRead, managerKpiNone, hrKpiRead };
}

/** Seed every table the target routes read so 200s carry real rows. */
function seedTables(): void {
  setTable('qualityObservations', [
    {
      id: 'o1', schemaVersion: 1, employeeId: 'e1', employeeName: 'موظف اختبار',
      department: 'الدعم', month: '2026-07', type: 'positive', severity: 'medium',
      categoryId: 'cat1', categoryName: 'التزام', status: 'open',
      approvalStatus: 'pending', points: 0, isBonus: false,
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ]);
  setTable('observationCategories', [
    { id: 'cat1', key: 'commitment', name: 'التزام', defaultPointValue: 5, weight: 2, color: 'slate', priority: 'medium', isBonusDefault: false },
  ]);
  setTable('kpiSettings', [
    {
      id: 'singleton', allowBonus: true, approvalRequired: true, leaderboardEnabled: true,
      closeMonthLock: true, defaultScore: 100, minimumScore: 0, maximumBonus: 20,
      trendCalculation: 'rollingAverage',
    },
  ]);
  setTable('capaCases', []);
}

// ══════════════════════════════════════════════════════════════
//  1. Quality Observations — GET /api/quality-observations
//     ('observations' view — same key as the POST gate + page)
//     stock levels: admin bypass · manager/quality edit · hr/user none
// ══════════════════════════════════════════════════════════════
describe('M0.2.1 — quality-observations GET', () => {
  let route: GetRoute;
  let t: Awaited<ReturnType<typeof fixturesWithOverrides>>;
  const URL = 'http://localhost/api/quality-observations?month=2026-07';

  before(async () => {
    route = (await import('@/app/api/quality-observations/route')) as unknown as GetRoute;
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
  it("D. 'user' role (observations none) → 403", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.userToken)))).status, 403);
  });
  it("D. 'hr' role (observations none) → 403", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.hrToken)))).status, 403);
  });
  it("E/F. 'quality' role (observations edit) → 200 with the seeded observation", async () => {
    const res = await route.GET(getRequest(URL, bearerHeaders(t.qualityToken)));
    assert.equal(res.status, 200);
    const list = (await res.json()) as Array<{ id: string }>;
    assert.equal(list[0]?.id, 'o1');
  });
  it('G. admin token → 200 (admin bypass)', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.adminToken)))).status, 200);
  });
  it('stored denial: quality role + stored observations none → 403', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.qualityObsNone)))).status, 403);
  });
  it('stored grant: hr role + stored observations read → 200', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.hrObsRead)))).status, 200);
  });
});

// ══════════════════════════════════════════════════════════════
//  2. Observation Categories — GET /api/observation-categories
//     ('observationCategories' view — same key as the POST gate +
//     categories management page)
//     stock levels: admin bypass · manager edit · quality read ·
//     hr/user none
// ══════════════════════════════════════════════════════════════
describe('M0.2.1 — observation-categories GET', () => {
  let route: GetRoute;
  let t: Awaited<ReturnType<typeof fixturesWithOverrides>>;
  const URL = 'http://localhost/api/observation-categories';

  before(async () => {
    route = (await import('@/app/api/observation-categories/route')) as unknown as GetRoute;
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
  it("D. 'user' role (observationCategories none) → 403", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.userToken)))).status, 403);
  });
  it("D. 'hr' role (observationCategories none) → 403", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.hrToken)))).status, 403);
  });
  it("E. 'quality' role (observationCategories read) → 200 with the seeded category", async () => {
    const res = await route.GET(getRequest(URL, bearerHeaders(t.qualityToken)));
    assert.equal(res.status, 200);
    const list = (await res.json()) as Array<{ id: string }>;
    assert.equal(list[0]?.id, 'cat1');
  });
  it("F/G. 'manager' role (edit) and admin (bypass) → 200", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.managerToken)))).status, 200);
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.adminToken)))).status, 200);
  });
  it('stored denial: quality role + stored observationCategories none → 403', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.qualityCatsNone)))).status, 403);
  });
  it('stored grant: user role + stored observationCategories read → 200', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.userCatsRead)))).status, 200);
  });
});

// ══════════════════════════════════════════════════════════════
//  3. KPI Settings — GET /api/kpi-settings
//     ('kpiSettings' view — same key as the PUT gate + settings page)
//     stock levels: admin bypass · manager edit · hr/quality/user none
// ══════════════════════════════════════════════════════════════
describe('M0.2.1 — kpi-settings GET', () => {
  let route: GetRoute;
  let t: Awaited<ReturnType<typeof fixturesWithOverrides>>;
  const URL = 'http://localhost/api/kpi-settings';

  before(async () => {
    route = (await import('@/app/api/kpi-settings/route')) as unknown as GetRoute;
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
  it("D. 'quality' role (kpiSettings none) → 403", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.qualityToken)))).status, 403);
  });
  it("D. 'hr' role (kpiSettings none) → 403", async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.hrToken)))).status, 403);
  });
  it("E/F. 'manager' role (kpiSettings edit) → 200 with the settings", async () => {
    const res = await route.GET(getRequest(URL, bearerHeaders(t.managerToken)));
    assert.equal(res.status, 200);
    const settings = (await res.json()) as { id?: string; defaultScore?: number };
    assert.equal(settings.id, 'singleton');
    assert.equal(settings.defaultScore, 100);
  });
  it('G. admin token → 200 (admin bypass)', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.adminToken)))).status, 200);
  });
  it('stored denial: manager role + stored kpiSettings none → 403', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.managerKpiNone)))).status, 403);
  });
  it('stored grant: hr role + stored kpiSettings read → 200', async () => {
    assert.equal((await route.GET(getRequest(URL, bearerHeaders(t.hrKpiRead)))).status, 200);
  });
});

// ══════════════════════════════════════════════════════════════
//  STORED PERMISSION SEMANTICS — resolver rules for the 3 keys
// ══════════════════════════════════════════════════════════════
describe('M0.2.1 — stored override resolution semantics', () => {
  before(async () => {
    resetTestData();
    await fixturesWithOverrides();
  });

  it("role grants + stored 'none' = effective 'none' (backend denies)", async () => {
    const cases = [
      { key: 'observations', role: 'quality' },
      { key: 'observationCategories', role: 'quality' },
      { key: 'kpiSettings', role: 'manager' },
    ] as const;
    for (const { key, role } of cases) {
      const eff = resolveEffectivePermissions(role, { [key]: 'none' });
      assert.equal(migratePermission(eff[key]).level, 'none', `${key}`);

      const userId = `u-sem-${key}`;
      registerUser({ id: userId, email: `${userId}@t.local`, role, permissions: { [key]: 'none' } });
      const token = await mintToken({ userId, email: `${userId}@t.local`, role });
      const verdict = await verifyPermission(
        getRequest('http://localhost/x', bearerHeaders(token)),
        key, 'view',
      );
      assert.equal(verdict.allowed, false, `${key}: stored 'none' must override the ${role} grant`);
    }
  });

  it("role denies + stored grant = effective grant (backend allows)", () => {
    for (const [key, role, level] of [
      ['observations', 'hr', 'read'],
      ['observationCategories', 'user', 'read'],
      ['kpiSettings', 'hr', 'read'],
    ] as const) {
      const eff = resolveEffectivePermissions(role, { [key]: level });
      assert.equal(migratePermission(eff[key]).level, level, `${key}`);
    }
  });

  it('missing stored key falls back to the role preset (not to none)', () => {
    assert.equal(migratePermission(resolveEffectivePermissions('quality', {}).observations).level, 'edit');
    assert.equal(migratePermission(resolveEffectivePermissions('quality', {}).observationCategories).level, 'read');
    assert.equal(migratePermission(resolveEffectivePermissions('manager', {}).kpiSettings).level, 'edit');
    assert.equal(migratePermission(resolveEffectivePermissions('hr', {}).observations).level, 'none');
  });
});

// ══════════════════════════════════════════════════════════════
//  FRONTEND / BACKEND PARITY REGRESSION
//
//  For every M0.2.1 page key and every stock role (+ stored-override
//  users), the BACKEND gate decision (verifyPermission, used by the
//  routes above) must equal the FRONTEND gate decision (canView over
//  user.permissions, built with the SAME resolveEffectivePermissions).
// ══════════════════════════════════════════════════════════════
describe('M0.2.1 — frontend/backend permission parity', () => {
  const M021_KEYS = ['observations', 'observationCategories', 'kpiSettings'];

  const CASES: Array<{ label: string; userId: string; role: string; stored?: Record<string, unknown> }> = [
    { label: 'admin', userId: 'p21-admin', role: 'admin' },
    { label: 'hr', userId: 'p21-hr', role: 'hr' },
    { label: 'manager', userId: 'p21-mgr', role: 'manager' },
    { label: 'quality', userId: 'p21-qual', role: 'quality' },
    { label: 'user', userId: 'p21-user', role: 'user' },
    { label: 'quality + stored observations none', userId: 'p21-q1', role: 'quality', stored: { observations: 'none' } },
    { label: 'hr + stored observations read', userId: 'p21-h1', role: 'hr', stored: { observations: 'read' } },
    { label: 'manager + stored kpiSettings none', userId: 'p21-m1', role: 'manager', stored: { kpiSettings: 'none' } },
    { label: 'user + stored observationCategories read', userId: 'p21-u1', role: 'user', stored: { observationCategories: 'read' } },
  ];

  it('verifyPermission(view) === frontend canView for every key × case', async () => {
    for (const c of CASES) {
      registerUser({
        id: c.userId, email: `${c.userId}@t.local`, role: c.role,
        ...(c.stored ? { permissions: c.stored } : {}),
      });
    }

    for (const c of CASES) {
      const token = await mintToken({ userId: c.userId, email: `${c.userId}@t.local`, role: c.role });

      // Frontend semantics: AuthContext builds user.permissions with the
      // same resolver; canView = level !== 'none' (admin short-circuits).
      const frontendMap = resolveEffectivePermissions(c.role, c.stored);
      const frontendCanView = (key: string) =>
        c.role === 'admin' || migratePermission(frontendMap[key]).level !== 'none';

      for (const key of M021_KEYS) {
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

// ══════════════════════════════════════════════════════════════
//  4. CAPA POST ACTOR IDENTITY — the authenticated caller is the
//     authoritative actor; body.createdBy/createdByName must never
//     be able to impersonate anyone.
// ══════════════════════════════════════════════════════════════
describe('M0.2.1 — capa-cases POST actor identity', () => {
  let route: PostRoute;
  let t: Awaited<ReturnType<typeof fixturesWithOverrides>>;
  const URL = 'http://localhost/api/capa-cases';

  /** The most recent capaCases record created through the stub. */
  const lastCreated = () =>
    createdRecords.filter((r) => r.table === 'capaCases').slice(-1)[0];

  before(async () => {
    route = (await import('@/app/api/capa-cases/route')) as unknown as PostRoute;
    resetTestData();
    t = await fixturesWithOverrides();
    seedTables();
  });

  it('authenticated user A + body.createdBy = user B → records user A as the authoritative actor', async () => {
    const res = await route.POST(jsonRequest(URL, {
      title: 'حالة اختبار الانتحال',
      department: 'الجودة',
      priority: 'high',
      createdBy: 'u-victim',
      createdByName: 'اسم منتحل',
    }, bearerHeaders(t.qualityToken)));
    assert.equal(res.status, 201);
    const rec = lastCreated();
    assert.ok(rec, 'a capaCases record must have been created');
    assert.equal(rec.data.createdBy, 'u-quality');
    assert.equal(rec.data.createdByName, 'جودة');
    assert.equal(rec.data.timeline[0].performedBy, 'u-quality');
    assert.equal(rec.data.timeline[0].performedByName, 'جودة');
    // The forged identity must NOT appear anywhere in the stored record.
    assert.notEqual(rec.data.createdBy, 'u-victim');
    assert.notEqual(rec.data.createdByName, 'اسم منتحل');
  });

  it('no body.createdBy at all → still the authenticated actor', async () => {
    const res = await route.POST(jsonRequest(URL, {
      title: 'حالة بدون هوية مُرسلة',
    }, bearerHeaders(t.qualityToken)));
    assert.equal(res.status, 201);
    const rec = lastCreated();
    assert.ok(rec);
    assert.equal(rec.data.createdBy, 'u-quality');
    assert.equal(rec.data.createdByName, 'جودة');
    assert.equal(rec.data.timeline[0].performedBy, 'u-quality');
    assert.equal(rec.data.timeline[0].performedByName, 'جودة');
  });

  it('admin creation records the admin identity, not the body identity', async () => {
    const res = await route.POST(jsonRequest(URL, {
      title: 'حالة إنشاء مدير',
      createdBy: 'someone-else',
    }, bearerHeaders(t.adminToken)));
    assert.equal(res.status, 201);
    const rec = lastCreated();
    assert.ok(rec);
    assert.equal(rec.data.createdBy, 'u-admin');
    assert.equal(rec.data.timeline[0].performedBy, 'u-admin');
  });

  it('CAPA creation remains functional (201, generated capaId, response echoes the actor)', async () => {
    const res = await route.POST(jsonRequest(URL, { title: 'حالة وظيفية' }, bearerHeaders(t.qualityToken)));
    assert.equal(res.status, 201);
    const body = (await res.json()) as { capaId?: string; createdBy?: string; timeline?: Array<{ action?: string }> };
    assert.match(body.capaId ?? '', /^CAPA-\d{4}-\d{3}$/);
    assert.equal(body.createdBy, 'u-quality');
    assert.equal(body.timeline?.[0]?.action, 'case_created');
  });

  it("unauthorized role ('hr', capa none) → 403 and no record created", async () => {
    const before = createdRecords.filter((r) => r.table === 'capaCases').length;
    const res = await route.POST(jsonRequest(URL, { title: 'لا ينبغي أن تُنشأ' }, bearerHeaders(t.hrToken)));
    assert.equal(res.status, 403);
    assert.equal(createdRecords.filter((r) => r.table === 'capaCases').length, before);
  });
});
