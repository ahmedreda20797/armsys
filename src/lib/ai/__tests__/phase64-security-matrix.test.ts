// ══════════════════════════════════════════════════════════════
//  Phase 6.4 — SECURITY TEST MATRIX (spec §36, scenarios A–S)
//
//  Runs the route handlers END-TO-END over the m01 in-memory harness
//  (real JWT + real permission resolution + in-memory db) — the same
//  doctrine as the Phase 6.2 route tests. Unit-level scenarios live
//  in phase64-gateway.test.ts / phase64-provider.test.ts /
//  phase64-memory-conversation.test.ts and are cross-referenced here.
// ══════════════════════════════════════════════════════════════

import '../../__tests__/m01-test-support';

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  resetTestData,
  registerFixtures,
  registerUser,
  setTable,
  mintToken,
  bearerHeaders,
} from '../../__tests__/m01-test-support';

import {
  executeAITool,
  listAITools,
} from '@/lib/ai/tools';
import { ENABLED_TOOL_CATEGORIES } from '@/lib/ai/tools/types';
import type { AIToolCaller } from '@/lib/ai/tools/types';

const qualityRoute = import('@/app/api/ai/quality-analysis/route');
const diagnosticsRoute = import('@/app/api/ai/diagnostics/route');
const healthRoute = import('@/app/api/ai/health/route');
const providerSettingsRoute = import('@/app/api/ai/provider-settings/route');

const ENV_KEYS = ['AI_ENABLED', 'AI_PROVIDER', 'AI_MODEL', 'AI_API_KEY', 'AI_BASE_URL', 'AI_TIMEOUT_MS'] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

let adminToken = '';
let userToken = '';

beforeEach(async () => {
  resetTestData();
  const { adminToken: t1, userToken: t2 } = await registerFixtures();
  adminToken = t1;
  userToken = t2;
});

// ── caller fixture for tool tests ───────────────────────────────
function makeCaller(overrides: {
  role?: string;
  permissions?: Record<string, unknown>;
  scopeIncludes?: (employeeId: string) => boolean;
}): AIToolCaller {
  return {
    userId: 'u-tool',
    userName: 'أدوات',
    role: overrides.role ?? 'user',
    permissions: (overrides.permissions ?? {}) as AIToolCaller['permissions'],
    linkedEmployeeId: null,
    scope: {
      scope: 'department',
      pageKey: 'employees',
      source: 'configured',
      boundary: { source: 'assignment', nodeIds: [] },
      isUnrestricted: false,
      employeeIds: new Set(['emp-1']),
      includes: overrides.scopeIncludes ?? ((id: string) => id === 'emp-1'),
    } as AIToolCaller['scope'],
  };
}

// ══════════════════════════════════════════════════════════════
//  A — unauthorized user cannot call the AI endpoint
// ══════════════════════════════════════════════════════════════
describe('§36-A — unauthorized access to the AI endpoint', () => {
  it('POST /api/ai/quality-analysis without a token → 401, before ANY data access', async () => {
    const { POST } = await qualityRoute;
    const response = await POST(new Request('http://local/api/ai/quality-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: 'emp-1', month: '2026-09' }),
    }) as never);
    assert.equal(response.status, 401);
  });

  it('diagnostics/health/provider-settings without a token → 401', async () => {
    const { GET: diagGET } = await diagnosticsRoute;
    assert.equal((await diagGET(new Request('http://local/api/ai/diagnostics') as never)).status, 401);
    const { GET: healthGET } = await healthRoute;
    assert.equal((await healthGET(new Request('http://local/api/ai/health') as never)).status, 401);
    const { GET: settingsGET } = await providerSettingsRoute;
    assert.equal((await settingsGET(new Request('http://local/api/ai/provider-settings') as never)).status, 401);
  });
});

// ══════════════════════════════════════════════════════════════
//  N — admin-only provider settings reject non-admin users
// ══════════════════════════════════════════════════════════════
describe('§36-N — admin-only AI provider control', () => {
  it('normal user → 403 on diagnostics, health, settings GET and PUT', async () => {
    const { GET: diagGET } = await diagnosticsRoute;
    assert.equal((await diagGET(new Request('http://local/api/ai/diagnostics', { headers: bearerHeaders(userToken) }) as never)).status, 403);
    const { GET: healthGET } = await healthRoute;
    assert.equal((await healthGET(new Request('http://local/api/ai/health', { headers: bearerHeaders(userToken) }) as never)).status, 403);
    const settings = await providerSettingsRoute;
    assert.equal(
      (await settings.GET(new Request('http://local/api/ai/provider-settings', { headers: bearerHeaders(userToken) }) as never)).status,
      403,
    );
    assert.equal(
      (await settings.PUT(new Request('http://local/api/ai/provider-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...bearerHeaders(userToken) },
        body: JSON.stringify({ provider: 'gemini', model: 'gemini-x' }),
      }) as never)).status,
      403,
    );
  });

  it('admin → 200 on diagnostics + settings GET; PUT activates explicitly', async () => {
    const { GET: diagGET } = await diagnosticsRoute;
    const diagRes = await diagGET(new Request('http://local/api/ai/diagnostics', { headers: bearerHeaders(adminToken) }) as never);
    assert.equal(diagRes.status, 200);
    const diagBody = await diagRes.json();
    assert.equal(diagBody.status, 'OK');
    assert.equal(typeof diagBody.diagnostics.aiEnabled, 'boolean');

    const settings = await providerSettingsRoute;
    const putRes = await settings.PUT(new Request('http://local/api/ai/provider-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...bearerHeaders(adminToken) },
      body: JSON.stringify({ provider: 'gemini', model: 'gemini-test-model' }),
    }) as never);
    assert.equal(putRes.status, 200);
    const putBody = await putRes.json();
    assert.equal(putBody.settings.provider, 'gemini');
    assert.equal(putBody.settings.model, 'gemini-test-model');

    // The override persists and is visible on GET.
    const getRes = await settings.GET(new Request('http://local/api/ai/provider-settings', { headers: bearerHeaders(adminToken) }) as never);
    const getBody = await getRes.json();
    assert.equal(getBody.settings.provider, 'gemini');
    // The settings node holds NO credential material — ever (§7).
    assert.ok(!JSON.stringify(getBody).includes('AI_API_KEY'));
  });

  it('PUT rejects unknown providers and never accepts a key field (§1.7/§7)', async () => {
    const settings = await providerSettingsRoute;
    const badProvider = await settings.PUT(new Request('http://local/api/ai/provider-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...bearerHeaders(adminToken) },
      body: JSON.stringify({ provider: 'openrouter-auto', model: 'x' }),
    }) as never);
    assert.equal(badProvider.status, 400);

    // A submitted apiKey is structurally ignored — nothing is stored.
    const withKey = await settings.PUT(new Request('http://local/api/ai/provider-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...bearerHeaders(adminToken) },
      body: JSON.stringify({ provider: 'gemini', model: 'gemini-test-model', apiKey: 'AIza-EVIL-000' }),
    }) as never);
    assert.equal(withKey.status, 200);
    const { createdRecords } = await import('../../__tests__/m01-test-support');
    const settingsWrites = createdRecords.filter((r) => r.table === 'aiProviderSettings');
    assert.ok(settingsWrites.every((r) => !JSON.stringify(r).includes('AIza-EVIL-000')));
  });
});

// ══════════════════════════════════════════════════════════════
//  F/G — the API key is never returned to the client, never logged
// ══════════════════════════════════════════════════════════════
describe('§36-F/§36-G — credential never leaves the server boundary', () => {
  it('diagnostics response NEVER contains the key value (only the boolean)', async () => {
    const secret = 'AIza-DIAG-SECRET-value-000';
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-test-model';
    process.env.AI_API_KEY = secret;

    const { GET } = await diagnosticsRoute;
    const res = await GET(new Request('http://local/api/ai/diagnostics', { headers: bearerHeaders(adminToken) }) as never);
    assert.equal(res.status, 200);
    const bodyText = JSON.stringify(await res.json());
    assert.ok(!bodyText.includes(secret), 'key value must never appear');
    assert.ok(bodyText.includes('"apiKeyConfigured":true'), 'only the boolean appears');
  });

  it('health response NEVER contains the key value', async () => {
    const secret = 'AIza-HEALTH-SECRET-value-000';
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-test-model';
    process.env.AI_API_KEY = secret;

    const { GET } = await healthRoute;
    const res = await GET(new Request('http://local/api/ai/health', { headers: bearerHeaders(adminToken) }) as never);
    assert.equal(res.status, 200);
    const bodyText = JSON.stringify(await res.json());
    assert.ok(!bodyText.includes(secret));
  });

  it('provider request to the external endpoint carries NO Firebase credentials (§36-D)', async () => {
    process.env.FIREBASE_PROJECT_ID = 'secret-project';
    process.env.FIREBASE_PRIVATE_KEY = 'secret-private-key-material';
    process.env.FIREBASE_CLIENT_EMAIL = 'secret@secret.iam';
    process.env.FIREBASE_DATABASE_URL = 'https://secret.firebaseio.com';
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-test-model';
    process.env.AI_API_KEY = 'AIza-local-matrix-test';

    const captured: Array<{ headers: Record<string, unknown>; url: string; body: string }> = [];
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        captured.push({ headers: req.headers, url: req.url ?? '', body: raw });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const { GeminiProvider } = await import('@/lib/ai/provider/gemini-adapter');
      const provider = new GeminiProvider({ apiKey: 'AIza-local-matrix-test', model: 'gemini-test-model', baseUrl: `http://127.0.0.1:${port}` });
      await provider.analyze({ systemPrompt: 'S', userContent: 'U', timeoutMs: 3000 });
      assert.equal(captured.length, 1);
      const wire = `${captured[0].url} ${captured[0].body} ${JSON.stringify(captured[0].headers)}`;
      assert.ok(!wire.includes('secret-project'));
      assert.ok(!wire.includes('secret-private-key-material'));
      assert.ok(!wire.includes('secret@secret.iam'));
      assert.ok(!wire.includes('secret.firebaseio.com'));
    } finally {
      server.close();
      delete process.env.FIREBASE_PROJECT_ID;
      delete process.env.FIREBASE_PRIVATE_KEY;
      delete process.env.FIREBASE_CLIENT_EMAIL;
      delete process.env.FIREBASE_DATABASE_URL;
    }
  });
});

// ══════════════════════════════════════════════════════════════
//  C/M — permission-aware tools; no sensitive write tools exist
// ══════════════════════════════════════════════════════════════
describe('§36-C/§36-M — permission-aware tool layer', () => {
  it('a caller WITHOUT the employees page cannot use getEmployeeProfile (§11)', async () => {
    const outcome = await executeAITool('getEmployeeProfile', { employeeId: 'emp-1' }, makeCaller({
      permissions: { employees: { level: 'none' } },
    }));
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, 'PERMISSION_DENIED');
  });

  it('a caller with the permission but OUT OF SCOPE is denied — anti-enumeration (§11)', async () => {
    const outcome = await executeAITool('getEmployeeProfile', { employeeId: 'emp-other' }, makeCaller({
      permissions: { employees: { level: 'read' } },
      scopeIncludes: () => false,
    }));
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.reason, 'OUT_OF_SCOPE');
      assert.doesNotMatch(outcome.error, /موجود|آخر/, 'never reveals existence elsewhere');
    }
  });

  it('invalid tool arguments are rejected before anything runs (§12)', async () => {
    const outcome = await executeAITool('getEmployeeProfile', { employeeId: '' }, makeCaller({
      permissions: { employees: { level: 'read' } },
    }));
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, 'INVALID_ARGS');
  });

  it('write-tool names are unknown; every registered tool is READ_ONLY (§13/§36-M)', async () => {
    const writeNames = ['approveDeduction', 'createDeduction', 'updateEmployee', 'archiveEmployee', 'changePermissions'];
    for (const name of writeNames) {
      const outcome = await executeAITool(name, {}, makeCaller({ role: 'admin' }));
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.equal(outcome.reason, 'TOOL_UNKNOWN');
    }
    assert.deepEqual(ENABLED_TOOL_CATEGORIES, ['READ_ONLY']);
    for (const tool of listAITools()) {
      assert.equal(tool.category, 'READ_ONLY', `${tool.name} must be READ_ONLY in this phase`);
    }
  });

  it('unregistered tool → TOOL_UNKNOWN even for admin', async () => {
    const outcome = await executeAITool('nonexistent', {}, makeCaller({ role: 'admin' }));
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, 'TOOL_UNKNOWN');
  });
});
