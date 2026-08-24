// ══════════════════════════════════════════════════════════════
//  M0.1 security tests — CAPA report + CAPA case detail
//
//  reports/capa had the un-awaited requireAuth bug (a Promise is
//  truthy, so EVERY caller passed the check) and no permission gate.
//  capa-cases/[id] GET trusted knowledge of the id as authorization.
// ══════════════════════════════════════════════════════════════

import './m01-test-support';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerFixtures,
  resetTestData,
  setTable,
  bearerHeaders,
  tamperToken,
  type TestTokens,
} from './m01-test-support';

interface GetRoute {
  GET: (req: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
}

const SAMPLE_CASE = {
  id: 'c1',
  capaId: 'CAPA-2026-001',
  title: 'حالة اختبار',
  department: 'الجودة',
  employeeId: 'e1',
  employeeName: 'أحمد محمد',
  status: 'open',
  priority: 'high',
  verificationResult: '',
  source: 'manual',
  issueCategory: 'عام',
  slaDays: 7,
  overdueDays: 0,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

/**
 * M0.5: the fixture manager (u-manager) must be org-bound for the
 * sample case's employee (e1) to sit inside its subtree scope — an
 * unbound manager is fail-closed and (correctly) no longer sees
 * employee-linked cases. This preserves the ORIGINAL intent of these
 * tests: a manager holding the capa read permission reads the case.
 */
function seedManagerScopeForSampleCase(): void {
  setTable('orgNodes', [
    { id: 'company', name: 'company', type: 'team', parentId: null, managerUserId: null },
    { id: 'team1', name: 'team1', type: 'team', parentId: 'company', managerUserId: 'u-manager' },
  ]);
  setTable('employees', [
    { id: 'e1', code: '1', name: 'أحمد محمد', department: 'الجودة', orgNodeId: 'team1' },
  ]);
}

describe('M0.1 — reports/capa GET (missing-await bug + permission)', () => {
  let route: GetRoute;
  let tokens: TestTokens;

  before(async () => {
    route = (await import('@/app/api/reports/capa/route')) as unknown as GetRoute;
    tokens = await registerFixtures();
  });

  it('no Authorization header → 401 (was 200 before M0.1: un-awaited Promise is truthy)', async () => {
    const res = await route.GET(new Request('http://localhost/api/reports/capa'));
    assert.equal(res.status, 401);
  });

  it('dummy Bearer token → 401 (middleware checks presence only; handler must verify)', async () => {
    const res = await route.GET(
      new Request('http://localhost/api/reports/capa', { headers: bearerHeaders('x') })
    );
    assert.equal(res.status, 401);
  });

  it('tampered token signature → 401', async () => {
    const res = await route.GET(
      new Request('http://localhost/api/reports/capa', {
        headers: bearerHeaders(tamperToken(tokens.managerToken)),
      })
    );
    assert.equal(res.status, 401);
  });

  it("authenticated 'hr' role (capa none) → 403", async () => {
    const res = await route.GET(
      new Request('http://localhost/api/reports/capa', { headers: bearerHeaders(tokens.hrToken) })
    );
    assert.equal(res.status, 403);
  });

  it("authenticated 'manager' role (capa read) → 200 with report data", async () => {
    resetTestData();
    const t = await registerFixtures();
    seedManagerScopeForSampleCase();
    setTable('capaCases', [SAMPLE_CASE]);
    const res = await route.GET(
      new Request('http://localhost/api/reports/capa', { headers: bearerHeaders(t.managerToken) })
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.summary.total, 1);
    assert.equal(body.summary.open, 1);
  });
});

describe('M0.1 — capa-cases/[id] GET', () => {
  let route: GetRoute;
  let tokens: TestTokens;

  before(async () => {
    route = (await import('@/app/api/capa-cases/[id]/route')) as unknown as GetRoute;
    tokens = await registerFixtures();
  });

  const get = (token: string | undefined, id = 'c1') =>
    route.GET(new Request(`http://localhost/api/capa-cases/${id}`, { headers: bearerHeaders(token) }), {
      params: Promise.resolve({ id }),
    });

  it('no Authorization header → 401', async () => {
    const res = await get(undefined);
    assert.equal(res.status, 401);
  });

  it('dummy Bearer token → 401', async () => {
    const res = await get('x');
    assert.equal(res.status, 401);
  });

  it("authenticated 'hr' role (capa none) → 403 even for an existing id", async () => {
    setTable('capaCases', [SAMPLE_CASE]);
    const res = await get(tokens.hrToken);
    assert.equal(res.status, 403);
  });

  it("authenticated 'manager' role (capa read) → 200 with the case", async () => {
    resetTestData();
    const t = await registerFixtures();
    seedManagerScopeForSampleCase();
    setTable('capaCases', [SAMPLE_CASE]);
    const res = await get(t.managerToken);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, 'c1');
    assert.equal(body.capaId, 'CAPA-2026-001');
  });

  it('authorized caller, unknown id → 404', async () => {
    const res = await get(tokens.managerToken, 'missing');
    assert.equal(res.status, 404);
  });
});
