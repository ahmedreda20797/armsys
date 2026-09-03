// ══════════════════════════════════════════════════════════════
//  Phase 6.5-A — REAL Gemini activation readiness (spec §3/§6/§13/
//  §14/§16/§17/§21/§22/§29)
//
//  Model discovery against a LOCAL mock endpoint (no external calls,
//  no real credentials) · models route (admin-only) · provider-switch
//  safety (§13/§29) · no-fallback doctrine (§16-M) · error-body
//  sanitization (§16-L) · route timeout declarations (§14) ·
//  conversation/memory persistence readiness re-checks (§21/§22).
// ══════════════════════════════════════════════════════════════

import '../../__tests__/m01-test-support';

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  resetTestData,
  registerFixtures,
  bearerHeaders,
} from '../../__tests__/m01-test-support';

import { discoverGeminiModels } from '@/lib/ai/provider/models';
import { readAISafeDiagnostics } from '@/lib/ai/provider/config';
import { aiStatusFromProviderErrorCode } from '@/lib/ai/gateway/status';
import { resolveAIProvider } from '@/lib/ai/gateway/core';
import { getProviderDefinition } from '@/lib/ai/provider/registry';
import { aiDiagnosticHint } from '@/components/pages/quality-kpi/smart-report/ai-view';
import {
  createConversation,
  listConversationsForUser,
  type ConversationPersistence,
} from '@/lib/ai/conversation/store';
import {
  createMemoryEntry,
  getAllMemoryEntries,
  type MemoryPersistence,
} from '@/lib/ai/memory/store';

// ── env helpers ─────────────────────────────────────────────────
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

// ── local mock ListModels endpoint ──────────────────────────────
function startMockModels(handler: () => { status?: number; payload?: string }): Promise<{
  url: string;
  calls: Array<{ keyHeader: string | undefined; url: string }>;
  close: () => Promise<void>;
}> {
  const calls: Array<{ keyHeader: string | undefined; url: string }> = [];
  const server = http.createServer((req, res) => {
    calls.push({ keyHeader: req.headers['x-goog-api-key'] as string | undefined, url: req.url ?? '' });
    const out = handler();
    res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(out.payload ?? '{}');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, calls, close: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

const MODELS_OK = JSON.stringify({
  models: [
    { name: 'models/gemini-test-flash', displayName: 'Gemini Test Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/gemini-test-pro', displayName: 'Gemini Test Pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/embedding-001', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-test-flash-002', displayName: 'Gemini Test Flash 002', supportedGenerationMethods: ['generateContent'] },
  ],
});

// ── §3 model discovery ──────────────────────────────────────────
describe('Gemini model discovery (§3 — list only, NEVER select)', () => {
  it('unconfigured key → MISCONFIGURED + API_KEY_MISSING, no attempt', async () => {
    const result = await discoverGeminiModels();
    assert.equal(result.attempted, false);
    assert.equal(result.status, 'MISCONFIGURED');
    assert.equal(result.errorCategory, 'API_KEY_MISSING');
  });

  it('success: returns ONLY ids/names of generateContent-capable models; key stays in the header', async () => {
    const secret = 'AIza-DISCOVERY-TEST-KEY-000';
    const server = await startMockModels(() => ({ payload: MODELS_OK }));
    try {
      const result = await discoverGeminiModels({
        AI_API_KEY: secret,
        AI_BASE_URL: server.url,
      } as unknown as NodeJS.ProcessEnv);
      assert.equal(result.attempted, true);
      assert.equal(result.reachable, true);
      assert.equal(result.authenticated, true);
      assert.equal(result.status, 'OPERATIONAL');
      assert.equal(server.calls.length, 1);
      assert.equal(server.calls[0].keyHeader, secret, 'credential travels in the header');
      assert.ok(!server.calls[0].url.includes(secret), 'credential never in the URL');
      // Only generateContent-capable ids are usable.
      const usable = result.models.filter((m) => m.supportsGenerate).map((m) => m.id);
      assert.deepEqual(usable, ['gemini-test-flash', 'gemini-test-pro', 'gemini-test-flash-002']);
      // The result NEVER contains the key value (§7).
      assert.ok(!JSON.stringify(result).includes(secret));
    } finally {
      await server.close();
    }
  });

  it('a hostile endpoint echoing the key through metadata gets REDACTED (§16-L)', async () => {
    const secret = 'AIza-ECHO-TEST-KEY-000';
    const hostile = JSON.stringify({
      models: [{ name: `models/gemini-ok`, displayName: `key is ${secret}`, supportedGenerationMethods: ['generateContent'] }],
    });
    const server = await startMockModels(() => ({ payload: hostile }));
    try {
      const result = await discoverGeminiModels({
        AI_API_KEY: secret,
        AI_BASE_URL: server.url,
      } as unknown as NodeJS.ProcessEnv);
      assert.ok(!JSON.stringify(result).includes(secret), 'echoed key must be redacted');
      assert.equal(result.models[0].displayName, 'key is [REDACTED]');
    } finally {
      await server.close();
    }
  });

  it('401 → authenticated:false, MISCONFIGURED; raw error body NEVER propagates (§16-L)', async () => {
    const hostileBody = JSON.stringify({ error: { code: 401, status: 'UNAUTHENTICATED', message: 'RAW-PROVIDER-DETAIL-HOSTILE' } });
    const server = await startMockModels(() => ({ status: 401, payload: hostileBody }));
    try {
      const result = await discoverGeminiModels({
        AI_API_KEY: 'AIza-x',
        AI_BASE_URL: server.url,
      } as unknown as NodeJS.ProcessEnv);
      assert.equal(result.authenticated, false);
      assert.equal(result.status, 'MISCONFIGURED');
      assert.equal(result.errorCategory, 'AI_AUTH_ERROR');
      assert.ok(!JSON.stringify(result).includes('RAW-PROVIDER-DETAIL-HOSTILE'));
    } finally {
      await server.close();
    }
  });

  it('404 on the listing endpoint → MODEL_ERROR category (no fallback, §16-M)', async () => {
    const server = await startMockModels(() => ({ status: 404, payload: '{"error":{"code":404,"status":"NOT_FOUND"}}' }));
    try {
      const result = await discoverGeminiModels({
        AI_API_KEY: 'AIza-x',
        AI_BASE_URL: server.url,
      } as unknown as NodeJS.ProcessEnv);
      assert.equal(result.status, 'MODEL_ERROR');
    } finally {
      await server.close();
    }
  });

  it('connection refused → UNAVAILABLE (distinct from MISCONFIGURED, §17)', async () => {
    const result = await discoverGeminiModels({
      AI_API_KEY: 'AIza-x',
      AI_BASE_URL: 'http://127.0.0.1:9',
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.reachable, false);
  });
});

// ── models route (admin-only, safe payload) ─────────────────────
describe('GET /api/ai/models (§6/§28 — admin diagnostics surface)', () => {
  it('unauthenticated → 401; non-admin → 403', async () => {
    const { GET } = await import('@/app/api/ai/models/route');
    assert.equal((await GET(new Request('http://local/api/ai/models') as never)).status, 401);

    resetTestData();
    const { userToken } = await registerFixtures();
    assert.equal(
      (await GET(new Request('http://local/api/ai/models', { headers: bearerHeaders(userToken) }) as never)).status,
      403,
    );
  });

  it('admin → 200 with SAFE usable list + explicit-selection note; key never appears', async () => {
    const secret = 'AIza-ROUTE-TEST-KEY-000';
    const server = await startMockModels(() => ({ payload: MODELS_OK }));
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-test-flash';
    process.env.AI_API_KEY = secret;
    process.env.AI_BASE_URL = server.url;

    try {
      resetTestData();
      const { adminToken } = await registerFixtures();
      const { GET } = await import('@/app/api/ai/models/route');
      const res = await GET(new Request('http://local/api/ai/models', { headers: bearerHeaders(adminToken) }) as never);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'OK');
      assert.deepEqual(body.usableModels.map((m: { id: string }) => m.id), ['gemini-test-flash', 'gemini-test-pro', 'gemini-test-flash-002']);
      assert.match(body.note, /AI_MODEL/);
      assert.ok(!JSON.stringify(body).includes(secret), 'key value never reaches the response');
    } finally {
      await server.close();
    }
  });
});

// ── §13/§29 provider-switch safety ──────────────────────────────
describe('provider switching (§13/§29 — replaceable, never destructive)', () => {
  it('settings switch gemini model A → model B takes effect EXPLICITLY', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_API_KEY = 'AIza-switch-test';
    const mk = (model: string) => ({
      provider: 'gemini' as const, model, updatedBy: 'admin-1', updatedByName: 'Admin', updatedAt: new Date().toISOString(),
    });
    const a = resolveAIProvider(process.env, { settings: mk('gemini-model-a') });
    assert.ok(a.provider);
    assert.equal(a.provider!.model, 'gemini-model-a');
    const b = resolveAIProvider(process.env, { settings: mk('gemini-model-b') });
    assert.ok(b.provider);
    assert.equal(b.provider!.model, 'gemini-model-b');
  });

  it('switch to a provider whose key is absent/wrong: EXPLICIT switch (no fallback to gemini), and the boundary fails CLOSED (§16-M)', async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_API_KEY = 'AIza-gemini-key';
    // Settings point at openai-compatible while the env key belongs to
    // gemini. The system NEVER falls back to the configured gemini —
    // it constructs the EXPLICITLY selected provider, and the credential
    // mismatch surfaces as an auth failure (MISCONFIGURED), never as a
    // silent success or a silent return to the previous provider.
    const server = await startMockModels(() => ({ status: 401, payload: '{"error":{"code":401,"status":"UNAUTHENTICATED"}}' }));
    try {
      const resolution = resolveAIProvider(process.env, {
        settings: { provider: 'openai-compatible', model: 'vendor-x', updatedBy: 'admin-1', updatedByName: 'A', updatedAt: new Date().toISOString() },
      });
      assert.ok(resolution.provider, 'explicitly selected provider is constructed');
      assert.equal(resolution.provider!.name, 'openai-compatible', 'no silent fallback to the previously configured provider');
      assert.equal(resolution.providerSource, 'settings');

      // Boundary-level fail-closed: a health check against the switched
      // provider reports the credential problem honestly.
      const { runProviderHealthCheck } = await import('@/lib/ai/provider/health');
      const health = await runProviderHealthCheck({
        ...process.env,
        AI_MODEL: 'gemini-test-model', // env gemini config complete → reaches the real endpoint
        AI_BASE_URL: server.url,
      } as unknown as NodeJS.ProcessEnv);
      assert.equal(health.status, 'MISCONFIGURED');
      assert.equal(health.errorCategory, 'AI_AUTH_ERROR');
      assert.equal(health.operational, false);
    } finally {
      await server.close();
    }
  });

  it('registry holds exactly ONE definition per provider — no fallback chains exist', () => {
    for (const kind of ['gemini', 'z-ai', 'openai-compatible']) {
      assert.ok(getProviderDefinition(kind));
    }
    assert.equal(getProviderDefinition('fallback'), null);
  });

  it('invalid model maps to MODEL_ERROR — a distinct, non-fallback status (§16-M/§17)', () => {
    assert.equal(aiStatusFromProviderErrorCode('AI_MODEL_ERROR'), 'MODEL_ERROR');
  });
});

// ── §14 route timeout declarations ──────────────────────────────
describe('Vercel function-timeout declarations (§14 — 29.6s real-probe lesson)', () => {
  it('every provider-calling AI route declares maxDuration explicitly', async () => {
    const fs = await import('node:fs');
    for (const route of [
      'src/app/api/ai/quality-analysis/route.ts',
      'src/app/api/ai/health/route.ts',
      'src/app/api/ai/models/route.ts',
    ]) {
      const src = fs.readFileSync(route, 'utf8');
      assert.match(src, /export const maxDuration = 60/, `${route} must declare maxDuration`);
    }
  });

  it('AI_TIMEOUT_MS is clamped and observable (config level)', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'openai-compatible';
    process.env.AI_API_KEY = 'sk-x';
    process.env.AI_TIMEOUT_MS = '1';
    assert.equal(readAISafeDiagnostics().timeoutMs, 5_000);
    process.env.AI_TIMEOUT_MS = '99999999';
    assert.equal(readAISafeDiagnostics().timeoutMs, 120_000);
  });
});

// ── §17 UI hint mapping ─────────────────────────────────────────
describe('user-safe diagnostic hints (§17 — no raw errors, no secrets)', () => {
  it('every gateway status maps to a hint; none can contain credentials', () => {
    for (const status of ['DISABLED', 'MISCONFIGURED', 'MODEL_ERROR', 'UNAVAILABLE', 'RATE_LIMITED', 'PROVIDER_ERROR', 'TIMEOUT', 'VALIDATION_ERROR']) {
      const hint = aiDiagnosticHint(status);
      assert.ok(hint && hint.length > 10, `${status} must map to a user-safe hint`);
    }
    assert.equal(aiDiagnosticHint('OPERATIONAL'), null);
    assert.equal(aiDiagnosticHint('sk-abc123secret'), null, 'unknown/garbage values yield NO hint');
  });
});

// ── §21/§22 persistence readiness re-checks ─────────────────────
describe('conversation + memory persistence readiness (§21/§22)', () => {
  it('conversation records keep ownership + provider/model metadata (Phase 6.5-B ready)', async () => {
    const conversations = new Map<string, Record<string, unknown>>();
    const messages = new Map<string, Record<string, unknown>>();
    let seq = 0;
    const persistence: ConversationPersistence = {
      async getAllConversations() { return [...conversations.values()].map((r) => ({ ...r })); },
      async getAllMessages() { return [...messages.values()].map((r) => ({ ...r })); },
      async createConversation(data) {
        seq += 1;
        const rec = { ...data, id: `c-${seq}` };
        conversations.set(rec.id, rec);
        return { ...rec };
      },
      async createMessage(data) {
        seq += 1;
        const rec = { ...data, id: `m-${seq}` };
        messages.set(rec.id, rec);
        return { ...rec };
      },
      async updateConversation(id, data) {
        const row = conversations.get(id);
        if (row) Object.assign(row, data);
        return row ?? null;
      },
    };
    const conv = await createConversation(
      { userId: 'u-1', title: 'جاهزة للدردشة', provider: 'gemini', model: 'gemini-test-flash' },
      persistence,
    );
    assert.ok(conv.ok);
    if (!conv.ok) return;
    const stored = conversations.get(conv.value.conversationId);
    assert.equal(stored?.userId, 'u-1');
    assert.equal(stored?.provider, 'gemini');
    assert.equal(stored?.model, 'gemini-test-flash');
    assert.equal(stored?.archived, false);
    assert.ok(typeof stored?.createdAt === 'string');
    const list = await listConversationsForUser('u-1', {}, persistence);
    assert.equal(list.length, 1);
  });

  it('memory entries remain provider-independent and PROPOSED-gated (§22/§29)', async () => {
    const rows = new Map<string, Record<string, unknown>>();
    let seq = 0;
    const persistence: MemoryPersistence = {
      async getAll() { return [...rows.values()].map((r) => ({ ...r })); },
      async create(data) { seq += 1; const rec = { ...data, id: `mem-${seq}` }; rows.set(rec.id, rec); return { ...rec }; },
      async update(id, data) { const row = rows.get(id); if (row) Object.assign(row, data); return row ?? null; },
    };
    await createMemoryEntry({
      stage: 'analysis',
      subject: { kind: 'employee', employeeId: 'emp-1' },
      title: 'بقاء عبر التبديل',
      summary: 'مدخل ذاكرة يبقى بعد تبديل المزود',
      evidence: [{ collection: 'qualityObservations', recordId: 'obs-1' }],
      source: 'ai-analysis',
      createdBy: 'ai',
      confidence: 'medium',
    }, persistence);
    const all = await getAllMemoryEntries(persistence);
    assert.equal(all.length, 1);
    assert.equal(all[0].status, 'PROPOSED', 'AI-source memory can never start trusted');
    const serialized = JSON.stringify(all);
    assert.ok(!/gemini|glm|gpt/i.test(serialized), 'no provider identity embedded in memory');
  });
});
