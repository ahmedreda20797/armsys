// ══════════════════════════════════════════════════════════════
//  M0.1 security tests — CAPA SLA cron path
//
//  The client-settable x-internal-scheduler header must no longer
//  authenticate anything. /api/capa-sla accepts either the server-side
//  CRON_SECRET (Bearer) or a real user token; /api/cron/capa-sla-check
//  verifies the incoming secret and forwards it — with no hardcoded
//  fallback.
// ══════════════════════════════════════════════════════════════

import './m01-test-support';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerFixtures,
  resetTestData,
  bearerHeaders,
  tamperToken,
  type TestTokens,
} from './m01-test-support';

interface GetRoute {
  GET: (req: Request) => Promise<Response>;
}

const CRON_SECRET = process.env.CRON_SECRET as string;

describe('M0.1 — capa-sla GET (scheduler auth)', () => {
  let route: GetRoute;
  let tokens: TestTokens;

  before(async () => {
    route = (await import('@/app/api/capa-sla/route')) as unknown as GetRoute;
    tokens = await registerFixtures();
  });

  it('x-internal-scheduler header alone → 401 (old bypass is dead)', async () => {
    const res = await route.GET(
      new Request('http://localhost/api/capa-sla', {
        headers: { 'x-internal-scheduler': 'true' },
      })
    );
    assert.equal(res.status, 401);
  });

  it('dummy Bearer token → 401', async () => {
    const res = await route.GET(
      new Request('http://localhost/api/capa-sla', { headers: bearerHeaders('x') })
    );
    assert.equal(res.status, 401);
  });

  it('tampered user token → 401', async () => {
    const res = await route.GET(
      new Request('http://localhost/api/capa-sla', {
        headers: bearerHeaders(tamperToken(tokens.managerToken)),
      })
    );
    assert.equal(res.status, 401);
  });

  it('wrong CRON secret → 401', async () => {
    const res = await route.GET(
      new Request('http://localhost/api/capa-sla', {
        headers: bearerHeaders('definitely-not-the-secret'),
      })
    );
    assert.equal(res.status, 401);
  });

  it('correct CRON secret → 200 (scheduler path preserved)', async () => {
    resetTestData();
    const res = await route.GET(
      new Request('http://localhost/api/capa-sla', { headers: bearerHeaders(CRON_SECRET) })
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.summary.checked, 0);
  });

  it('valid authenticated user token → 200 (manual trigger preserved)', async () => {
    resetTestData();
    const t = await registerFixtures();
    const res = await route.GET(
      new Request('http://localhost/api/capa-sla', { headers: bearerHeaders(t.managerToken) })
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });
});

describe('M0.1 — cron/capa-sla-check GET (cron trigger)', () => {
  let route: GetRoute;
  const originalFetch = globalThis.fetch;
  let fetchCalls: Array<{ url: string; headers: Record<string, string> }> = [];

  function stubFetch(): void {
    fetchCalls = [];
    (globalThis as any).fetch = async (input: any, init?: any) => {
      fetchCalls.push({ url: String(input), headers: { ...(init?.headers || {}) } });
      return new Response(JSON.stringify({ success: true, summary: { checked: 0 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  }

  it('no Authorization header → 401 and downstream fetch never called', async () => {
    const mod = (await import('@/app/api/cron/capa-sla-check/route')) as unknown as GetRoute;
    route = mod;
    stubFetch();
    try {
      const res = await route.GET(new Request('http://localhost/api/cron/capa-sla-check'));
      assert.equal(res.status, 401);
      assert.equal(fetchCalls.length, 0);
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });

  it('wrong secret → 401', async () => {
    stubFetch();
    try {
      const res = await route.GET(
        new Request('http://localhost/api/cron/capa-sla-check', {
          headers: bearerHeaders('wrong-secret'),
        })
      );
      assert.equal(res.status, 401);
      assert.equal(fetchCalls.length, 0);
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });

  it('correct secret → forwards the secret to /api/capa-sla without the old header bypass', async () => {
    stubFetch();
    try {
      const res = await route.GET(
        new Request('http://localhost/api/cron/capa-sla-check', {
          headers: bearerHeaders(CRON_SECRET),
        })
      );
      assert.equal(res.status, 200);
      assert.equal(fetchCalls.length, 1);
      const call = fetchCalls[0];
      assert.ok(call.url.endsWith('/api/capa-sla'), `unexpected url ${call.url}`);
      assert.equal(call.headers['Authorization'], `Bearer ${CRON_SECRET}`);
      assert.equal(call.headers['x-internal-scheduler'], undefined);
      const body = await res.json();
      assert.equal(body.cron, 'capa-sla-check');
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});

describe('M0.1 — cron-auth unit behavior', () => {
  it('isCronRequest fails closed when CRON_SECRET is not configured', async () => {
    const { isCronRequest } = await import('@/lib/cron-auth');
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const req = new Request('http://localhost/x', { headers: bearerHeaders('anything') });
      assert.equal(isCronRequest(req), false);
    } finally {
      process.env.CRON_SECRET = saved;
    }
  });

  it('isCronRequest accepts the exact secret and nothing else', async () => {
    const { isCronRequest } = await import('@/lib/cron-auth');
    const ok = new Request('http://localhost/x', { headers: bearerHeaders(CRON_SECRET) });
    const prefix = new Request('http://localhost/x', {
      headers: bearerHeaders(CRON_SECRET.slice(0, -1)),
    });
    assert.equal(isCronRequest(ok), true);
    assert.equal(isCronRequest(prefix), false);
  });
});
