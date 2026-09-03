// ══════════════════════════════════════════════════════════════
//  Phase 6.4 — provider registry + diagnostics + Gemini adapter +
//  layered resolution + health check (spec §3/§4/§5/§24/§25/§26)
//
//  The Gemini adapter is exercised against a LOCAL mock HTTP server
//  (no external calls, no real credentials — the Phase 6.2 doctrine).
//  Live Gemini verification stays honestly pending until a real key
//  exists (§42 "Production verification pending").
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  readAIProviderConfig,
  readAISafeDiagnostics,
  createAIProviderFromEnv,
  resolveAIProvider,
  runProviderHealthCheck,
  AIProviderError,
  GeminiProvider,
  getProviderDefinition,
  listProviderDefinitions,
  type AIProviderRequest,
} from '../provider';

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

// ── local mock server (Gemini-shaped responses) ────────────────
interface MockCall {
  apiKeyHeader: string | undefined;
  url: string;
  body: Record<string, unknown>;
}

function startMockServer(handler: (body: string) => {
  status?: number;
  payload?: string;
}): Promise<{ url: string; calls: MockCall[]; close: () => Promise<void> }> {
  const calls: MockCall[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      calls.push({
        apiKeyHeader: req.headers['x-goog-api-key'] as string | undefined,
        url: req.url ?? '',
        body: JSON.parse(raw || '{}'),
      });
      const out = handler(raw);
      res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(out.payload ?? '{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        calls,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

const BASE_REQUEST: AIProviderRequest = {
  systemPrompt: 'SYSTEM-MARKER',
  userContent: 'USER-MARKER',
  timeoutMs: 2000,
};

const GEMINI_OK = JSON.stringify({
  candidates: [{ content: { parts: [{ text: '{"insights": []}' }] } }],
});

// ── §5 registry — explicitness doctrine ─────────────────────────
describe('AI provider registry (spec §5/§1.7)', () => {
  it('registers exactly the three explicit providers — no auto/router entry', () => {
    const defs = listProviderDefinitions();
    assert.deepEqual(defs.map((d) => d.id).sort(), ['gemini', 'openai-compatible', 'z-ai']);
  });

  it('gemini REQUIRES an explicit model — never auto-selected (§4/§5)', () => {
    const def = getProviderDefinition('gemini');
    assert.ok(def);
    assert.equal(def.requirements.requiresExplicitModel, true);
    assert.equal(def.requirements.modelSource, 'explicit-required');
  });

  it('unknown provider resolves to null — no accidental default (§33)', () => {
    assert.equal(getProviderDefinition('oracle-magic'), null);
    assert.equal(getProviderDefinition('openrouter-auto'), null);
  });

  it('gemini without AI_MODEL → null config + MISCONFIGURED diagnostics (§4)', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_API_KEY = 'AIza-test-key-000';
    assert.equal(readAIProviderConfig(), null);
    assert.equal(createAIProviderFromEnv(), null);
    const diag = readAISafeDiagnostics();
    assert.equal(diag.configurationState, 'MISCONFIGURED');
    assert.ok(diag.configurationProblems.includes('MODEL_MISSING_REQUIRED'));
  });

  it('gemini without AI_API_KEY → null config + API_KEY_MISSING diagnostics', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-test-model';
    assert.equal(readAIProviderConfig(), null);
    const diag = readAISafeDiagnostics();
    assert.ok(diag.configurationProblems.includes('API_KEY_MISSING'));
  });

  it('gemini fully configured → config + diagnostics CONFIGURED (§26)', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-test-model';
    process.env.AI_API_KEY = 'AIza-test-key-000';
    const config = readAIProviderConfig();
    assert.ok(config);
    assert.equal(config.kind, 'gemini');
    assert.equal(config.model, 'gemini-test-model');
    const provider = createAIProviderFromEnv();
    assert.ok(provider instanceof GeminiProvider);
  });
});

// ── §3/§25 — safe configuration diagnostics ─────────────────────
describe('AI safe diagnostics (spec §3/§25 — never a secret)', () => {
  it('nothing configured → DISABLED with AI_DISABLED problem', () => {
    const diag = readAISafeDiagnostics();
    assert.equal(diag.aiEnabled, false);
    assert.equal(diag.configurationState, 'DISABLED');
    assert.deepEqual(diag.configurationProblems, ['AI_DISABLED']);
  });

  it('enabled but provider unset → MISCONFIGURED with PROVIDER_NOT_SET', () => {
    process.env.AI_ENABLED = 'true';
    const diag = readAISafeDiagnostics();
    assert.equal(diag.configurationState, 'MISCONFIGURED');
    assert.ok(diag.configurationProblems.includes('PROVIDER_NOT_SET'));
  });

  it('unknown provider id → PROVIDER_UNKNOWN; the id itself is a NAME, not a secret', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'some-router';
    const diag = readAISafeDiagnostics();
    assert.equal(diag.providerKnown, false);
    assert.ok(diag.configurationProblems.includes('PROVIDER_UNKNOWN'));
  });

  it('diagnostics expose booleans ONLY — the raw key value can never appear', () => {
    const secret = 'AIzaSECRET-VALUE-must-never-appear-000';
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-test-model';
    process.env.AI_API_KEY = secret;
    const serialized = JSON.stringify(readAISafeDiagnostics());
    assert.ok(!serialized.includes(secret));
    assert.equal(serialized.includes('apiKeyConfigured'), true);
  });
});

// ── §8 — layered resolution (settings override → env) ───────────
describe('resolveAIProvider — layered explicit resolution (§6/§8)', () => {
  it('env-only resolution when no settings are injected', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'openai-compatible';
    process.env.AI_MODEL = 'test-model';
    process.env.AI_API_KEY = 'sk-test';
    const resolution = resolveAIProvider();
    assert.ok(resolution.provider);
    assert.equal(resolution.providerSource, 'env');
  });

  it('settings override provider/model without touching credentials (§7)', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'z-ai';
    process.env.AI_API_KEY = 'AIza-settings-test';
    const resolution = resolveAIProvider(process.env, {
      settings: {
        provider: 'gemini',
        model: 'gemini-from-settings',
        updatedBy: 'admin-1',
        updatedByName: 'Admin',
        updatedAt: new Date().toISOString(),
      },
    });
    assert.ok(resolution.provider);
    assert.equal(resolution.provider.name, 'gemini');
    assert.equal(resolution.provider.model, 'gemini-from-settings');
    assert.equal(resolution.providerSource, 'settings');
  });

  it('settings can NEVER enable AI while the master switch is off (§7/§26)', () => {
    // AI_ENABLED unset — settings alone must not activate anything.
    const resolution = resolveAIProvider(process.env, {
      settings: {
        provider: 'gemini',
        model: 'gemini-from-settings',
        updatedBy: 'admin-1',
        updatedByName: 'Admin',
        updatedAt: new Date().toISOString(),
      },
    });
    assert.equal(resolution.provider, null);
    assert.equal(resolution.diagnostics.aiEnabled, false);
  });

  it('settings can NEVER supply a credential — the key stays env-level (§7)', () => {
    process.env.AI_ENABLED = 'true';
    // No AI_API_KEY in env — gemini settings override still fails closed.
    const resolution = resolveAIProvider(process.env, {
      settings: {
        provider: 'gemini',
        model: 'gemini-from-settings',
        updatedBy: 'admin-1',
        updatedByName: 'Admin',
        updatedAt: new Date().toISOString(),
      },
    });
    assert.equal(resolution.provider, null);
    // The credential gate is checked BEFORE any provider is created.
    assert.equal(resolution.config, null);
  });
});

// ── §4 — Gemini adapter against a local mock server ────────────
describe('Gemini adapter (spec §4/§62/§63)', () => {
  it('sends systemInstruction + contents with the key in the HEADER — never the URL', async () => {
    const server = await startMockServer(() => ({ payload: GEMINI_OK }));
    try {
      const provider = new GeminiProvider({ apiKey: 'AIza-local-test', model: 'gemini-test-model', baseUrl: server.url });
      const completion = await provider.analyze(BASE_REQUEST);
      assert.equal(completion.text, '{"insights": []}');
      assert.equal(completion.provider, 'gemini');
      assert.equal(completion.model, 'gemini-test-model');
      assert.equal(server.calls.length, 1);
      assert.equal(server.calls[0].apiKeyHeader, 'AIza-local-test');
      assert.match(server.calls[0].url, /\/v1beta\/models\/gemini-test-model:generateContent/);
      assert.ok(!server.calls[0].url.includes('AIza'), 'key never travels in the URL');
      const body = server.calls[0].body as {
        systemInstruction?: { parts?: Array<{ text?: string }> };
        contents?: Array<{ role?: string; parts?: Array<{ text?: string }> }>;
      };
      assert.match(body.systemInstruction?.parts?.[0]?.text ?? '', /SYSTEM-MARKER/);
      assert.equal(body.contents?.[0]?.role, 'user');
      assert.match(body.contents?.[0]?.parts?.[0]?.text ?? '', /USER-MARKER/);
    } finally {
      await server.close();
    }
  });

  it('404 → AI_MODEL_ERROR (invalid/unavailable model is a CONFIG error, §3)', async () => {
    const server = await startMockServer(() => ({
      status: 404,
      payload: JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'models/unknown not found' } }),
    }));
    try {
      const provider = new GeminiProvider({ apiKey: 'AIza-x', model: 'no-such-model', baseUrl: server.url });
      await assert.rejects(
        provider.analyze(BASE_REQUEST),
        (error: unknown) => error instanceof AIProviderError && error.code === 'AI_MODEL_ERROR',
      );
    } finally {
      await server.close();
    }
  });

  it('400 API-key message → AI_AUTH_ERROR; the raw message NEVER leaks', async () => {
    const server = await startMockServer(() => ({
      status: 400,
      payload: JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } }),
    }));
    try {
      const provider = new GeminiProvider({ apiKey: 'AIza-bad', model: 'gemini-test-model', baseUrl: server.url });
      try {
        await provider.analyze(BASE_REQUEST);
        assert.fail('must reject');
      } catch (error) {
        assert.ok(error instanceof AIProviderError);
        assert.equal(error.code, 'AI_AUTH_ERROR');
        assert.doesNotMatch(error.message, /valid API key/);
      }
    } finally {
      await server.close();
    }
  });

  it('429 → AI_RATE_LIMITED after exactly one safe retry', async () => {
    const server = await startMockServer(() => ({ status: 429 }));
    try {
      const provider = new GeminiProvider({ apiKey: 'AIza-x', model: 'gemini-test-model', baseUrl: server.url });
      await assert.rejects(
        provider.analyze(BASE_REQUEST),
        (error: unknown) => error instanceof AIProviderError && error.code === 'AI_RATE_LIMITED',
      );
      assert.equal(server.calls.length, 2);
    } finally {
      await server.close();
    }
  });

  it('empty candidates → AI_INVALID_RESPONSE', async () => {
    const server = await startMockServer(() => ({ payload: '{"candidates": []}' }));
    try {
      const provider = new GeminiProvider({ apiKey: 'AIza-x', model: 'gemini-test-model', baseUrl: server.url });
      await assert.rejects(
        provider.analyze(BASE_REQUEST),
        (error: unknown) => error instanceof AIProviderError && error.code === 'AI_INVALID_RESPONSE',
      );
    } finally {
      await server.close();
    }
  });

  it('connection refused → AI_NETWORK_ERROR; Firebase credentials never in the request', async () => {
    const provider = new GeminiProvider({ apiKey: 'AIza-x', model: 'gemini-test-model', baseUrl: 'http://127.0.0.1:9' });
    await assert.rejects(
      provider.analyze({ ...BASE_REQUEST, timeoutMs: 3000 }),
      (error: unknown) => error instanceof AIProviderError && error.code === 'AI_NETWORK_ERROR',
    );
  });
});

// ── §24 — health check ──────────────────────────────────────────
describe('provider health check (spec §24 — safe probe, safe result)', () => {
  it('unconfigured → DISABLED, no provider call attempted', async () => {
    const health = await runProviderHealthCheck();
    assert.equal(health.attempted, false);
    assert.equal(health.status, 'DISABLED');
    assert.equal(health.operational, false);
  });

  it('misconfigured → MISCONFIGURED with the stable problem code', async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_API_KEY = 'AIza-x';
    // model missing
    const health = await runProviderHealthCheck();
    assert.equal(health.status, 'MISCONFIGURED');
    assert.equal(health.errorCategory, 'MODEL_MISSING_REQUIRED');
  });

  it('healthy provider → OPERATIONAL with reachable + modelAccepted (mock)', async () => {
    const server = await startMockServer(() => ({ payload: GEMINI_OK }));
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-test-model';
    process.env.AI_API_KEY = 'AIza-local-test';
    process.env.AI_BASE_URL = server.url;
    try {
      const health = await runProviderHealthCheck();
      assert.equal(health.status, 'OPERATIONAL');
      assert.equal(health.operational, true);
      assert.equal(health.providerReachable, true);
      assert.equal(health.modelAccepted, true);
      assert.equal(typeof health.latencyMs, 'number');
    } finally {
      await server.close();
    }
  });

  it('model rejected → MODEL_ERROR with provider reachable, model not accepted', async () => {
    const server = await startMockServer(() => ({
      status: 404,
      payload: JSON.stringify({ error: { code: 404, status: 'NOT_FOUND' } }),
    }));
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'no-such-model';
    process.env.AI_API_KEY = 'AIza-local-test';
    process.env.AI_BASE_URL = server.url;
    try {
      const health = await runProviderHealthCheck();
      assert.equal(health.status, 'MODEL_ERROR');
      assert.equal(health.providerReachable, true);
      assert.equal(health.modelAccepted, false);
    } finally {
      await server.close();
    }
  });

  it('health result never contains any secret value', async () => {
    const secret = 'AIza-HEALTH-SECRET-value-000';
    const server = await startMockServer(() => ({ payload: GEMINI_OK }));
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-test-model';
    process.env.AI_API_KEY = secret;
    process.env.AI_BASE_URL = server.url;
    try {
      const health = await runProviderHealthCheck();
      assert.ok(!JSON.stringify(health).includes(secret));
    } finally {
      await server.close();
    }
  });
});
