// ══════════════════════════════════════════════════════════════
//  M0.1 security tests — firebase/test (SSRF) and health (data leak)
// ══════════════════════════════════════════════════════════════

import './m01-test-support';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerFixtures,
  bearerHeaders,
  tamperToken,
  jsonRequest,
  calls,
  resetTestData,
  dbStubs,
  type TestTokens,
} from './m01-test-support';

interface PostRoute {
  POST: (req: Request) => Promise<Response>;
}
interface HealthRoute {
  GET: () => Promise<Response>;
}

describe('M0.1 — firebase/test POST (SSRF hardening)', () => {
  let route: PostRoute;
  let tokens: TestTokens;
  const originalFetch = globalThis.fetch;
  let fetchUrls: string[] = [];

  function stubFetch(): void {
    fetchUrls = [];
    let written: string | null = null;
    (globalThis as any).fetch = async (input: any, init?: any) => {
      fetchUrls.push(String(input));
      if (init?.method === 'PUT') {
        written = String(init.body);
        return new Response('null', { status: 200 });
      }
      if (init?.method === 'DELETE') return new Response('null', { status: 200 });
      return new Response(written ?? 'null', { status: 200 });
    };
  }

  before(async () => {
    route = (await import('@/app/api/firebase/test/route')) as unknown as PostRoute;
    tokens = await registerFixtures();
  });

  it('no Authorization header → 401', async () => {
    const res = await route.POST(
      jsonRequest('http://localhost/api/firebase/test', {
        apiKey: 'k',
        databaseURL: 'https://proj-default-rtdb.firebaseio.com',
      })
    );
    assert.equal(res.status, 401);
  });

  it('dummy Bearer token → 401', async () => {
    const res = await route.POST(
      jsonRequest(
        'http://localhost/api/firebase/test',
        { apiKey: 'k', databaseURL: 'https://proj-default-rtdb.firebaseio.com' },
        bearerHeaders('x')
      )
    );
    assert.equal(res.status, 401);
  });

  it('tampered token → 401', async () => {
    const res = await route.POST(
      jsonRequest(
        'http://localhost/api/firebase/test',
        { apiKey: 'k', databaseURL: 'https://proj-default-rtdb.firebaseio.com' },
        bearerHeaders(tamperToken(tokens.adminToken))
      )
    );
    assert.equal(res.status, 401);
  });

  it("authenticated 'user' role (firebase none) → 403", async () => {
    const res = await route.POST(
      jsonRequest(
        'http://localhost/api/firebase/test',
        { apiKey: 'k', databaseURL: 'https://proj-default-rtdb.firebaseio.com' },
        bearerHeaders(tokens.userToken)
      )
    );
    assert.equal(res.status, 403);
  });

  const SSRF_TARGETS = [
    'http://localhost:9000/?ns=proj', // local emulator / localhost
    'http://127.0.0.1.firebaseio.com', // plain http
    'https://10.0.0.5/firebaseio.com', // private range, non-firebase host
    'https://evil.com', // arbitrary host
    'https://proj.firebaseio.com.attacker.io', // suffix-spoofed host
    'https://user:pass@proj-default-rtdb.firebaseio.com', // credentials
    'https://proj-default-rtdb.firebaseio.com:8443', // custom port
    'not-a-url',
  ];

  for (const target of SSRF_TARGETS) {
    it(`admin + disallowed destination (${target}) → 400 and NO outbound request`, async () => {
      stubFetch();
      try {
        const res = await route.POST(
          jsonRequest(
            'http://localhost/api/firebase/test',
            { apiKey: 'k', databaseURL: target },
            bearerHeaders(tokens.adminToken)
          )
        );
        assert.equal(res.status, 400);
        assert.equal(fetchUrls.length, 0, `fetch was called for ${target}`);
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });
  }

  it('admin + official RTDB URL → proceeds and succeeds', async () => {
    stubFetch();
    try {
      const res = await route.POST(
        jsonRequest(
          'http://localhost/api/firebase/test',
          { apiKey: 'k', databaseURL: 'https://proj-default-rtdb.firebaseio.com' },
          bearerHeaders(tokens.adminToken)
        )
      );
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(fetchUrls.length, 3); // write + read + cleanup
      assert.ok(fetchUrls[0].startsWith('https://proj-default-rtdb.firebaseio.com/'));
    } finally {
      (globalThis as any).fetch = originalFetch;
    }
  });
});

describe('M0.1 — health GET (no user data, no users-table scan)', () => {
  let route: HealthRoute;

  before(async () => {
    route = (await import('@/app/api/health/route')) as unknown as HealthRoute;
  });

  it('returns ok without any user identity information', async () => {
    resetTestData();
    const res = await route.GET();
    assert.equal(res.status, 200);
    const text = JSON.stringify(await res.json());
    assert.equal(JSON.parse(text).status, 'ok');
    for (const forbidden of ['firstUser', 'email', 'role', 'usersCount']) {
      assert.ok(!text.includes(forbidden), `health response leaks "${forbidden}"`);
    }
  });

  it('does not read the users table (single-record ping only)', async () => {
    resetTestData();
    await route.GET();
    const usersScans = calls.filter((c) => c.fn === 'getAll' && c.args[0] === 'users');
    assert.equal(usersScans.length, 0, 'health endpoint scanned the users table');
    assert.ok(calls.some((c) => c.fn === 'pingDatabase'), 'health endpoint did not use the ping');
  });

  it('reports 500 (not ok) when the database is unreachable', async () => {
    const originalPing = dbStubs.pingDatabase;
    dbStubs.pingDatabase = async () => {
      throw new Error('unreachable');
    };
    try {
      const res = await route.GET();
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.status, 'error');
    } finally {
      dbStubs.pingDatabase = originalPing;
    }
  });
});
