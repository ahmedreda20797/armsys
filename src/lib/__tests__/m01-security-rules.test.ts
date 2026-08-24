// ══════════════════════════════════════════════════════════════
//  M0.1 security tests — rule creation endpoints
//
//  rules POST and deduction-rules POST must reject unauthenticated,
//  dummy-token, and insufficient-permission callers, and the recorded
//  actor must be DERIVED FROM THE AUTHENTICATED USER — never from
//  body-supplied createdById/createdByName.
// ══════════════════════════════════════════════════════════════

import './m01-test-support';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerFixtures,
  resetTestData,
  bearerHeaders,
  tamperToken,
  jsonRequest,
  createdRecords,
  type TestTokens,
} from './m01-test-support';

interface RouteModule {
  POST: (req: Request) => Promise<Response>;
}

const VALID_RULE_BODY = {
  name: 'قاعدة اختبار',
  module: 'capa',
  triggerType: 'manual',
  conditions: { logic: 'and', conditions: [] },
  actions: [{ type: 'notify' }],
  // Forged identity — must be ignored by the server:
  createdById: 'attacker-forged-id',
  createdByName: 'مهاجم',
};

describe('M0.1 — rules POST (automation rules)', () => {
  let route: RouteModule;
  let tokens: TestTokens;

  before(async () => {
    route = (await import('@/app/api/rules/route')) as unknown as RouteModule;
    tokens = await registerFixtures();
  });

  it('no Authorization header → 401', async () => {
    const res = await route.POST(jsonRequest('http://localhost/api/rules', VALID_RULE_BODY));
    assert.equal(res.status, 401);
  });

  it('dummy Bearer token → 401', async () => {
    const res = await route.POST(
      jsonRequest('http://localhost/api/rules', VALID_RULE_BODY, bearerHeaders('x'))
    );
    assert.equal(res.status, 401);
  });

  it('tampered token signature → 401', async () => {
    const res = await route.POST(
      jsonRequest('http://localhost/api/rules', VALID_RULE_BODY, bearerHeaders(tamperToken(tokens.adminToken)))
    );
    assert.equal(res.status, 401);
  });

  it("authenticated 'user' role (rulesEngine none) → 403 and no rule created", async () => {
    resetTestData();
    const t = await registerFixtures();
    const res = await route.POST(
      jsonRequest('http://localhost/api/rules', VALID_RULE_BODY, bearerHeaders(t.userToken))
    );
    assert.equal(res.status, 403);
    assert.equal(createdRecords.filter((r) => r.table === 'automationRules').length, 0);
  });

  it("authenticated 'hr' role (rulesEngine none) → 403", async () => {
    const t = await registerFixtures();
    const res = await route.POST(
      jsonRequest('http://localhost/api/rules', VALID_RULE_BODY, bearerHeaders(t.hrToken))
    );
    assert.equal(res.status, 403);
  });

  it('admin → 201, actor derived from token (forged body identity ignored)', async () => {
    resetTestData();
    const t = await registerFixtures();
    const res = await route.POST(
      jsonRequest('http://localhost/api/rules', VALID_RULE_BODY, bearerHeaders(t.adminToken))
    );
    assert.equal(res.status, 201);
    const rule = await res.json();
    assert.equal(rule.createdById, 'u-admin');
    assert.equal(rule.createdByName, 'مسؤول النظام');
    assert.notEqual(rule.createdById, 'attacker-forged-id');
    assert.notEqual(rule.createdByName, 'مهاجم');
  });
});

describe('M0.1 — deduction-rules POST', () => {
  let route: RouteModule;
  let tokens: TestTokens;

  before(async () => {
    route = (await import('@/app/api/deduction-rules/route')) as unknown as RouteModule;
    tokens = await registerFixtures();
  });

  it('no Authorization header → 401', async () => {
    const res = await route.POST(
      jsonRequest('http://localhost/api/deduction-rules', { key: 'late', label: 'تأخير', amount: 50 })
    );
    assert.equal(res.status, 401);
  });

  it('dummy Bearer token → 401', async () => {
    const res = await route.POST(
      jsonRequest('http://localhost/api/deduction-rules', { key: 'late', label: 'تأخير' }, bearerHeaders('x'))
    );
    assert.equal(res.status, 401);
  });

  it("authenticated 'user' role (rules none) → 403", async () => {
    const res = await route.POST(
      jsonRequest(
        'http://localhost/api/deduction-rules',
        { key: 'late', label: 'تأخير' },
        bearerHeaders(tokens.userToken)
      )
    );
    assert.equal(res.status, 403);
  });

  it('admin → 201 with the created rule', async () => {
    resetTestData();
    const t = await registerFixtures();
    const res = await route.POST(
      jsonRequest(
        'http://localhost/api/deduction-rules',
        { key: 'late', label: 'تأخير', amount: 50, unit: 'EGP' },
        bearerHeaders(t.adminToken)
      )
    );
    assert.equal(res.status, 201);
    const rule = await res.json();
    assert.equal(rule.key, 'late');
    assert.equal(rule.unit, 'EGP');
  });
});
