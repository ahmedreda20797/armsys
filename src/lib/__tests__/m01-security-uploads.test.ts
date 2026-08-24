// ══════════════════════════════════════════════════════════════
//  M0.1 security tests — bulk upload endpoints
//
//  employees/upload, quality/upload, travel/upload must reject:
//    • no Authorization header          → 401
//    • dummy token ("Bearer x")         → 401  (middleware checks
//      presence only — the handler must verify the signature)
//    • tampered token signature         → 401
//    • authenticated user w/o action    → 403
//  and keep the authorized flow working end-to-end.
// ══════════════════════════════════════════════════════════════

import './m01-test-support';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerFixtures,
  resetTestData,
  setTable,
  xlsxBlob,
  bearerHeaders,
  tamperToken,
  type TestTokens,
} from './m01-test-support';

interface RouteModule {
  POST: (req: Request) => Promise<Response>;
}

describe('M0.1 — employees/upload POST', () => {
  let route: RouteModule;
  let tokens: TestTokens;

  before(async () => {
    route = (await import('@/app/api/employees/upload/route')) as unknown as RouteModule;
    tokens = await registerFixtures();
  });

  it('no Authorization header → 401', async () => {
    const res = await route.POST(new Request('http://localhost/api/employees/upload', { method: 'POST' }));
    assert.equal(res.status, 401);
  });

  it('dummy Bearer token ("Bearer x") → 401', async () => {
    const res = await route.POST(
      new Request('http://localhost/api/employees/upload', {
        method: 'POST',
        headers: bearerHeaders('x'),
      })
    );
    assert.equal(res.status, 401);
  });

  it('tampered valid-token signature → 401', async () => {
    const res = await route.POST(
      new Request('http://localhost/api/employees/upload', {
        method: 'POST',
        headers: bearerHeaders(tamperToken(tokens.adminToken)),
      })
    );
    assert.equal(res.status, 401);
  });

  it("authenticated 'user' role (employees read-only) → 403", async () => {
    const res = await route.POST(
      new Request('http://localhost/api/employees/upload', {
        method: 'POST',
        headers: bearerHeaders(tokens.userToken),
      })
    );
    assert.equal(res.status, 403);
  });

  it('admin with a valid workbook → 200 and rows imported', async () => {
    resetTestData();
    await registerFixtures();
    const fd = new FormData();
    fd.append('file', await xlsxBlob([['كود', 'الاسم', 'القسم'], ['1', 'أحمد محمد', 'صيانة']]), 'employees.xlsx');
    const res = await route.POST(
      new Request('http://localhost/api/employees/upload', {
        method: 'POST',
        headers: bearerHeaders(tokens.adminToken),
        body: fd,
      })
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.imported, 1);
  });
});

describe('M0.1 — quality/upload POST', () => {
  let route: RouteModule;
  let tokens: TestTokens;

  before(async () => {
    route = (await import('@/app/api/quality/upload/route')) as unknown as RouteModule;
    tokens = await registerFixtures();
  });

  it('no Authorization header → 401', async () => {
    const fd = new FormData();
    const res = await route.POST(
      new Request('http://localhost/api/quality/upload', { method: 'POST', body: fd })
    );
    assert.equal(res.status, 401);
  });

  it('dummy Bearer token → 401', async () => {
    const res = await route.POST(
      new Request('http://localhost/api/quality/upload', {
        method: 'POST',
        headers: bearerHeaders('x'),
      })
    );
    assert.equal(res.status, 401);
  });

  it("authenticated 'user' role (quality none) → 403", async () => {
    const res = await route.POST(
      new Request('http://localhost/api/quality/upload', {
        method: 'POST',
        headers: bearerHeaders(tokens.userToken),
      })
    );
    assert.equal(res.status, 403);
  });

  it('admin with a valid workbook → 200 and deduction imported', async () => {
    resetTestData();
    const tokens2 = await registerFixtures();
    setTable('employees', [{ id: 'e1', name: 'أحمد محمد' }]);
    const fd = new FormData();
    fd.append(
      'file',
      await xlsxBlob([['اسم الموظف', 'التاريخ', 'قيمة الخصم'], ['أحمد محمد', '05/07/2026', '3']]),
      'quality.xlsx'
    );
    const res = await route.POST(
      new Request('http://localhost/api/quality/upload', {
        method: 'POST',
        headers: bearerHeaders(tokens2.adminToken),
        body: fd,
      })
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.imported, 1);
  });
});

describe('M0.1 — travel/upload POST', () => {
  let route: RouteModule;
  let tokens: TestTokens;

  before(async () => {
    route = (await import('@/app/api/travel/upload/route')) as unknown as RouteModule;
    tokens = await registerFixtures();
  });

  it('no Authorization header → 401', async () => {
    const res = await route.POST(new Request('http://localhost/api/travel/upload', { method: 'POST' }));
    assert.equal(res.status, 401);
  });

  it('dummy Bearer token → 401', async () => {
    const res = await route.POST(
      new Request('http://localhost/api/travel/upload', {
        method: 'POST',
        headers: bearerHeaders('x'),
      })
    );
    assert.equal(res.status, 401);
  });

  it("authenticated 'user' role (travel read-only) → 403", async () => {
    const res = await route.POST(
      new Request('http://localhost/api/travel/upload', {
        method: 'POST',
        headers: bearerHeaders(tokens.userToken),
      })
    );
    assert.equal(res.status, 403);
  });

  it('admin with a valid workbook → 200 and deal imported', async () => {
    resetTestData();
    const tokens2 = await registerFixtures();
    const fd = new FormData();
    fd.append(
      'file',
      await xlsxBlob([['DEAL', 'Status'], ['عميل/أحمد محمد/شرم الشيخ/10/7/2026', 'Upcoming']]),
      'travel.xlsx'
    );
    const res = await route.POST(
      new Request('http://localhost/api/travel/upload', {
        method: 'POST',
        headers: bearerHeaders(tokens2.adminToken),
        body: fd,
      })
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, 1);
  });
});
