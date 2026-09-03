// ══════════════════════════════════════════════════════════════
//  Phase 6.5-A §3 — Gemini SAFE diagnostics matrix
//
//  The REAL activation blocker (Phase 6.5-A delivery): generateContent
//  failures were collapsed into a bare AI_MODEL_ERROR, hiding WHAT the
//  provider rejected. These tests lock the SAFE diagnostic contract:
//    • every provider failure carries { httpStatus, providerStatus,
//      providerCode, safeReason } — machine-readable, bounded, and
//      secret-redacted;
//    • the configured-model rejection (404 NOT_FOUND, e.g. "no longer
//      available to new users") is OBSERVABLE, never hidden;
//    • the echo health check works against thinking-capable models
//      (token budget must absorb thoughts);
//    • no key, no header, no raw response body ever leaks.
//
//  All provider traffic goes to a LOCAL mock endpoint — no external
//  calls, no real credentials (the Phase 6.2 doctrine). Real-provider
//  verification stays in scripts/phase65-verify-gemini.ts.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  readAIProviderConfig,
  readAISafeDiagnostics,
  runProviderHealthCheck,
  AIProviderError,
  GeminiProvider,
  type AIProviderRequest,
} from '../provider';
import { mapGeminiFailure, readGeminiErrorStatus } from '../provider/gemini-adapter';
import { discoverGeminiModels } from '../provider/models';

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
  method: string;
  url: string;
  body: Record<string, unknown>;
}

function startMockServer(
  handler: (body: string) => { status?: number; payload?: string; delayMs?: number },
): Promise<{ url: string; calls: MockCall[]; close: () => Promise<void> }> {
  const calls: MockCall[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      calls.push({
        apiKeyHeader: req.headers['x-goog-api-key'] as string | undefined,
        method: req.method ?? '',
        url: req.url ?? '',
        body: JSON.parse(raw || '{}'),
      });
      const out = handler(raw);
      const respond = () => {
        res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' });
        res.end(out.payload ?? '{}');
      };
      if (out.delayMs && out.delayMs > 0) setTimeout(respond, out.delayMs);
      else respond();
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

/** A server that accepts the connection but NEVER answers — for the
 *  client-side hard-timeout path. */
function startHangingServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(() => {/* deliberately no response */});
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => {
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

function geminiErrorBody(code: number, status: string, message?: string): string {
  return JSON.stringify(message === undefined ? { error: { code, status } } : { error: { code, status, message } });
}

const ECHO_OK = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ARM_AI_HEALTH_OK' }] } }] });

const BASE_REQUEST: AIProviderRequest = {
  systemPrompt: 'SYSTEM-MARKER',
  userContent: 'Respond with exactly: ARM_AI_HEALTH_OK',
  temperature: 0,
  maxOutputTokens: 512,
  timeoutMs: 2000,
};

// ── A. successful configuration ─────────────────────────────────
describe('A. successful Gemini configuration', () => {
  it('enabled gemini + explicit model + key → CONFIGURED, adapter constructed with the exact model', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-2.5-flash';
    process.env.AI_API_KEY = 'AIza-config-matrix-key';
    const config = readAIProviderConfig();
    assert.ok(config);
    assert.equal(config.kind, 'gemini');
    assert.equal(config.model, 'gemini-2.5-flash');
    assert.equal(readAISafeDiagnostics().configurationState, 'CONFIGURED');
    const provider = new GeminiProvider({ apiKey: config.apiKey!, model: config.model! });
    assert.equal(provider.model, 'gemini-2.5-flash');
    assert.equal(provider.name, 'gemini');
  });
});

// ── B. model discovery success ──────────────────────────────────
describe('B. model discovery success', () => {
  it('lists generate-capable ids from the real response shape (52-model class payload)', async () => {
    const server = await startMockServer(() => ({
      payload: JSON.stringify({
        models: [
          { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
          { name: 'models/gemini-3.6-flash', displayName: 'Gemini 3.6 Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
        ],
      }),
    }));
    try {
      const result = await discoverGeminiModels({ AI_API_KEY: 'AIza-discovery-matrix', AI_BASE_URL: server.url } as unknown as NodeJS.ProcessEnv);
      assert.equal(result.status, 'OPERATIONAL');
      assert.equal(result.authenticated, true);
      const usable = result.models.filter((m) => m.supportsGenerate).map((m) => m.id);
      assert.deepEqual(usable, ['gemini-2.5-flash', 'gemini-3.6-flash']);
    } finally {
      await server.close();
    }
  });
});

// ── C/D. successful generateContent + exact echo ────────────────
describe('C/D. successful generateContent + exact echo match', () => {
  it('request shape matches the Gemini REST contract (endpoint/body/roles/parts)', async () => {
    const server = await startMockServer(() => ({ payload: ECHO_OK }));
    try {
      const provider = new GeminiProvider({ apiKey: 'AIza-shape-matrix', model: 'gemini-3.6-flash', baseUrl: server.url });
      const completion = await provider.analyze(BASE_REQUEST);
      assert.equal(completion.text, 'ARM_AI_HEALTH_OK');
      assert.equal(completion.provider, 'gemini');
      assert.equal(completion.model, 'gemini-3.6-flash');
      const call = server.calls[0];
      assert.equal(call.method, 'POST');
      assert.match(call.url, /\/v1beta\/models\/gemini-3\.6-flash:generateContent$/);
      assert.equal(call.apiKeyHeader, 'AIza-shape-matrix');
      const body = call.body as {
        systemInstruction?: { parts?: Array<{ text?: string }> };
        contents?: Array<{ role?: string; parts?: Array<{ text?: string }> }>;
        generationConfig?: { temperature?: number; maxOutputTokens?: number };
      };
      assert.match(body.systemInstruction?.parts?.[0]?.text ?? '', /SYSTEM-MARKER/);
      assert.equal(body.contents?.length, 1);
      assert.equal(body.contents?.[0]?.role, 'user');
      assert.equal(body.contents?.[0]?.parts?.[0]?.text, 'Respond with exactly: ARM_AI_HEALTH_OK');
      assert.equal(body.generationConfig?.temperature, 0);
      assert.equal(body.generationConfig?.maxOutputTokens, 512);
    } finally {
      await server.close();
    }
  });

  it('health probe reports operational + echoMatched=true on the exact echo token', async () => {
    const server = await startMockServer(() => ({ payload: ECHO_OK }));
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-3.6-flash';
    process.env.AI_API_KEY = 'AIza-echo-matrix';
    process.env.AI_BASE_URL = server.url;
    try {
      const health = await runProviderHealthCheck();
      assert.equal(health.operational, true);
      assert.equal(health.echoMatched, true);
      assert.equal(health.modelAccepted, true);
      assert.equal(health.providerReachable, true);
    } finally {
      await server.close();
    }
  });

  it('health probe request keeps the thinking-safe token budget (≥512) so thoughts cannot starve the echo', async () => {
    const server = await startMockServer(() => ({ payload: ECHO_OK }));
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-3.6-flash';
    process.env.AI_API_KEY = 'AIza-think-matrix';
    process.env.AI_BASE_URL = server.url;
    try {
      await runProviderHealthCheck();
      const body = server.calls[0].body as { generationConfig?: { maxOutputTokens?: number } };
      assert.ok(
        (body.generationConfig?.maxOutputTokens ?? 0) >= 512,
        'thinking models spend output tokens on thoughts first — a tiny budget yields an empty echo',
      );
    } finally {
      await server.close();
    }
  });
});

// ── E–I. HTTP status → category + SAFE diagnostic ───────────────
describe('E–I. provider failures carry the SAFE diagnostic', () => {
  it('E. 400 INVALID_ARGUMENT (non-key message) → AI_MODEL_ERROR + diagnostic', async () => {
    const server = await startMockServer(() => ({
      status: 400,
      payload: geminiErrorBody(400, 'INVALID_ARGUMENT', 'Please use a valid generation configuration.'),
    }));
    try {
      const provider = new GeminiProvider({ apiKey: 'AIza-e-matrix', model: 'gemini-3.6-flash', baseUrl: server.url });
      const error = await provider.analyze(BASE_REQUEST).then(() => null, (e: unknown) => e);
      assert.ok(error instanceof AIProviderError);
      assert.equal(error.code, 'AI_MODEL_ERROR');
      assert.deepEqual(error.diagnostic, {
        httpStatus: 400,
        providerStatus: 'INVALID_ARGUMENT',
        providerCode: 400,
        safeReason: 'Please use a valid generation configuration.',
      });
    } finally {
      await server.close();
    }
  });

  it('F. 401/403 → AI_AUTH_ERROR + diagnostic', async () => {
    for (const httpStatus of [401, 403]) {
      const server = await startMockServer(() => ({
        status: httpStatus,
        payload: geminiErrorBody(httpStatus, httpStatus === 401 ? 'UNAUTHENTICATED' : 'PERMISSION_DENIED', 'permission denied for this key'),
      }));
      try {
        const provider = new GeminiProvider({ apiKey: 'AIza-f-matrix', model: 'gemini-3.6-flash', baseUrl: server.url });
        const error = await provider.analyze(BASE_REQUEST).then(() => null, (e: unknown) => e);
        assert.ok(error instanceof AIProviderError);
        assert.equal(error.code, 'AI_AUTH_ERROR');
        assert.equal(error.diagnostic?.httpStatus, httpStatus);
        assert.ok(error.diagnostic?.safeReason);
      } finally {
        await server.close();
      }
    }
  });

  it('G. 404 NOT_FOUND "no longer available to new users" → MODEL_ERROR with the EXACT rejection observable', async () => {
    // The REAL Phase 6.5-A blocker, replayed verbatim from the live API.
    const realMessage = 'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.6-flash for the latest features and improvements.';
    const server = await startMockServer(() => ({
      status: 404,
      payload: geminiErrorBody(404, 'NOT_FOUND', realMessage),
    }));
    try {
      const provider = new GeminiProvider({ apiKey: 'AIza-g-matrix', model: 'gemini-2.5-flash', baseUrl: server.url });
      const error = await provider.analyze(BASE_REQUEST).then(() => null, (e: unknown) => e);
      assert.ok(error instanceof AIProviderError);
      assert.equal(error.code, 'AI_MODEL_ERROR');
      assert.equal(error.diagnostic?.httpStatus, 404);
      assert.equal(error.diagnostic?.providerStatus, 'NOT_FOUND');
      assert.equal(error.diagnostic?.providerCode, 404);
      assert.equal(error.diagnostic?.safeReason, realMessage);
      // The user-facing message stays the stable Arabic category text —
      // the RAW provider text lives only in the diagnostic.
      assert.doesNotMatch(error.message, /no longer available/);
    } finally {
      await server.close();
    }
  });

  it('H. 429 RESOURCE_EXHAUSTED → AI_RATE_LIMITED after exactly one retry, diagnostic preserved', async () => {
    const server = await startMockServer(() => ({
      status: 429,
      payload: geminiErrorBody(429, 'RESOURCE_EXHAUSTED', 'quota exceeded'),
    }));
    try {
      const provider = new GeminiProvider({ apiKey: 'AIza-h-matrix', model: 'gemini-3.6-flash', baseUrl: server.url });
      const error = await provider.analyze(BASE_REQUEST).then(() => null, (e: unknown) => e);
      assert.ok(error instanceof AIProviderError);
      assert.equal(error.code, 'AI_RATE_LIMITED');
      assert.equal(error.diagnostic?.providerStatus, 'RESOURCE_EXHAUSTED');
      assert.equal(server.calls.length, 2, 'single safe retry');
    } finally {
      await server.close();
    }
  });

  it('I. 503 UNAVAILABLE → AI_PROVIDER_ERROR after one retry, diagnostic.httpStatus=503', async () => {
    const server = await startMockServer(() => ({
      status: 503,
      payload: geminiErrorBody(503, 'UNAVAILABLE', 'high demand — try again later'),
    }));
    try {
      const provider = new GeminiProvider({ apiKey: 'AIza-i-matrix', model: 'gemini-3.6-flash', baseUrl: server.url });
      const error = await provider.analyze(BASE_REQUEST).then(() => null, (e: unknown) => e);
      assert.ok(error instanceof AIProviderError);
      assert.equal(error.code, 'AI_PROVIDER_ERROR');
      assert.equal(error.diagnostic?.httpStatus, 503);
      assert.equal(error.diagnostic?.providerStatus, 'UNAVAILABLE');
      assert.equal(server.calls.length, 2, 'single safe retry');
    } finally {
      await server.close();
    }
  });
});

// ── J. malformed provider error response ────────────────────────
describe('J. malformed provider error response', () => {
  it('non-JSON error body → still mapped by HTTP status, diagnostic degrades to nulls', async () => {
    const server = await startMockServer(() => ({ status: 400, payload: '<html>Gateway garbage</html>' }));
    try {
      const provider = new GeminiProvider({ apiKey: 'AIza-j-matrix', model: 'gemini-3.6-flash', baseUrl: server.url });
      const error = await provider.analyze(BASE_REQUEST).then(() => null, (e: unknown) => e);
      assert.ok(error instanceof AIProviderError);
      assert.equal(error.code, 'AI_MODEL_ERROR');
      assert.deepEqual(error.diagnostic, {
        httpStatus: 400,
        providerStatus: null,
        providerCode: null,
        safeReason: null,
      });
    } finally {
      await server.close();
    }
  });

  it('error object with WRONG field types → type-guarded to nulls, never throws', async () => {
    const server = await startMockServer(() => ({
      status: 400,
      payload: JSON.stringify({ error: { code: 'four-hundred', status: 123, message: { nested: true } } }),
    }));
    try {
      const provider = new GeminiProvider({ apiKey: 'AIza-j2-matrix', model: 'gemini-3.6-flash', baseUrl: server.url });
      const error = await provider.analyze(BASE_REQUEST).then(() => null, (e: unknown) => e);
      assert.ok(error instanceof AIProviderError);
      assert.equal(error.code, 'AI_MODEL_ERROR');
      assert.equal(error.diagnostic?.providerStatus, null);
      assert.equal(error.diagnostic?.providerCode, null);
      assert.equal(error.diagnostic?.safeReason, null);
    } finally {
      await server.close();
    }
  });
});

// ── K/L. configuration gaps ─────────────────────────────────────
describe('K/L. missing model / missing API key', () => {
  it('K. gemini without AI_MODEL → null config + MODEL_MISSING_REQUIRED', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_API_KEY = 'AIza-k-matrix';
    assert.equal(readAIProviderConfig(), null);
    const diag = readAISafeDiagnostics();
    assert.equal(diag.configurationState, 'MISCONFIGURED');
    assert.ok(diag.configurationProblems.includes('MODEL_MISSING_REQUIRED'));
  });

  it('L. gemini without AI_API_KEY → null config + API_KEY_MISSING; discovery never attempts', async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-3.6-flash';
    assert.equal(readAIProviderConfig(), null);
    const discovery = await discoverGeminiModels();
    assert.equal(discovery.attempted, false);
    assert.equal(discovery.errorCategory, 'API_KEY_MISSING');
  });
});

// ── M. unreachable / timeout ────────────────────────────────────
describe('M. provider unreachable / timeout', () => {
  it('connection refused → AI_NETWORK_ERROR (diagnostic null — no HTTP exchange happened)', async () => {
    const provider = new GeminiProvider({ apiKey: 'AIza-m-matrix', model: 'gemini-3.6-flash', baseUrl: 'http://127.0.0.1:9' });
    const error = await provider.analyze({ ...BASE_REQUEST, timeoutMs: 3000 }).then(() => null, (e: unknown) => e);
    assert.ok(error instanceof AIProviderError);
    assert.equal(error.code, 'AI_NETWORK_ERROR');
    assert.equal(error.diagnostic, null);
  });

  it('hanging endpoint → AI_TIMEOUT honoured from request.timeoutMs', async () => {
    const server = await startHangingServer();
    try {
      const provider = new GeminiProvider({ apiKey: 'AIza-m2-matrix', model: 'gemini-3.6-flash', baseUrl: server.url });
      const error = await provider.analyze({ ...BASE_REQUEST, timeoutMs: 150 }).then(() => null, (e: unknown) => e);
      assert.ok(error instanceof AIProviderError);
      assert.equal(error.code, 'AI_TIMEOUT');
    } finally {
      await server.close();
    }
  });
});

// ── N/O/P. safe diagnostic output contract ──────────────────────
describe('N/O/P. safe diagnostic output (shape / no secrets / no raw bodies)', () => {
  it('N. diagnostic shape is exactly the normalized ARM contract', () => {
    const error = mapGeminiFailure(404, 'NOT_FOUND', false, { providerCode: 404, providerMessage: 'model rejected' });
    assert.deepEqual(error.diagnostic, {
      httpStatus: 404,
      providerStatus: 'NOT_FOUND',
      providerCode: 404,
      safeReason: 'model rejected',
    });
  });

  it('O. the API key NEVER appears in the diagnostic — echoed secrets are redacted', async () => {
    const secret = 'AQ.Ab8RN6-MATRIX-SECRET-KEY-000';
    const server = await startMockServer(() => ({
      status: 404,
      payload: geminiErrorBody(404, 'NOT_FOUND', `Model rejected. Your key ${secret} is not allowed.`),
    }));
    try {
      const provider = new GeminiProvider({ apiKey: secret, model: 'gemini-2.5-flash', baseUrl: server.url });
      const error = await provider.analyze(BASE_REQUEST).then(() => null, (e: unknown) => e);
      assert.ok(error instanceof AIProviderError);
      assert.ok(!JSON.stringify(error.diagnostic).includes(secret), 'key must be redacted inside safeReason');
      assert.match(error.diagnostic?.safeReason ?? '', /\[REDACTED\]/);
      assert.ok(!JSON.stringify(error.message).includes(secret));
    } finally {
      await server.close();
    }
  });

  it('P. no raw provider response leakage: the full body never propagates, safeReason stays bounded', async () => {
    const padding = 'x'.repeat(600);
    const rawBody = JSON.stringify({
      error: { code: 400, status: 'INVALID_ARGUMENT', message: `padding ${padding} end` },
      unrestictedField: 'RAW-BODY-MARKER-should-never-travel',
    });
    const server = await startMockServer(() => ({ status: 400, payload: rawBody }));
    try {
      const provider = new GeminiProvider({ apiKey: 'AIza-p-matrix', model: 'gemini-3.6-flash', baseUrl: server.url });
      const error = await provider.analyze(BASE_REQUEST).then(() => null, (e: unknown) => e);
      assert.ok(error instanceof AIProviderError);
      const serialized = JSON.stringify({ name: error.name, message: error.message, code: error.code, diagnostic: error.diagnostic });
      assert.ok(!serialized.includes('RAW-BODY-MARKER-should-never-travel'), 'unknown body fields never travel');
      const reason = error.diagnostic?.safeReason ?? '';
      assert.ok(reason.length <= 241, `safeReason is length-capped (got ${reason.length})`);
      assert.ok(!serialized.includes(rawBody), 'the raw body is never embedded');
      assert.match(reason, /…$/, 'truncation is marked with an ellipsis');
    } finally {
      await server.close();
    }
  });

  it('P (health path). the health result carries only SAFE fields and never the raw body or key', async () => {
    const secret = 'AQ.Ab8RN6-MATRIX-HEALTH-KEY-000';
    const rawBody = JSON.stringify({
      error: { code: 404, status: 'NOT_FOUND', message: `rejected. key echo: ${secret}` },
      fullPromptEcho: 'RAW-BODY-MARKER-health-path',
    });
    const server = await startMockServer(() => ({ status: 404, payload: rawBody }));
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-2.5-flash';
    process.env.AI_API_KEY = secret;
    process.env.AI_BASE_URL = server.url;
    try {
      const health = await runProviderHealthCheck();
      assert.equal(health.status, 'MODEL_ERROR');
      assert.equal(health.providerHttpStatus, 404);
      assert.equal(health.providerStatus, 'NOT_FOUND');
      const serialized = JSON.stringify(health);
      assert.ok(!serialized.includes(secret), 'key never appears in the health result');
      assert.ok(!serialized.includes('RAW-BODY-MARKER-health-path'), 'raw body never appears');
      assert.match(health.safeReason ?? '', /\[REDACTED\]/, 'the echoed key inside the reason is redacted');
      assert.equal(health.providerReachable, true);
      assert.equal(health.modelAccepted, false);
      assert.equal(health.operational, false);
    } finally {
      await server.close();
    }
  });
});

// ── health-probe timeout boundary (configuration-driven) ────────
//  Phase 6.5-A fix: the probe honours the CONFIGURED AI timeout
//  boundary (AI_TIMEOUT_MS → readAIProviderConfig, clamped 5s–120s,
//  30s safe default) — the old separate hard-coded 10s cap terminated
//  slower real Gemini responses and misreported them as AI_TIMEOUT.
describe('health-probe timeout boundary (configuration-driven, never a hard 10s cap)', () => {
  function withGeminiEnv(baseUrl: string, timeoutMs?: string): void {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'gemini';
    process.env.AI_MODEL = 'gemini-3.6-flash';
    process.env.AI_API_KEY = 'AIza-probe-timeout-matrix';
    process.env.AI_BASE_URL = baseUrl;
    if (timeoutMs === undefined) delete process.env.AI_TIMEOUT_MS;
    else process.env.AI_TIMEOUT_MS = timeoutMs;
  }

  it('effectiveTimeoutMs mirrors the resolved Gateway boundary (centralized clamping, no second parser)', async () => {
    const cases: Array<{ timeoutMs?: string; expected: number }> = [
      { timeoutMs: '45000', expected: 45_000 },
      { timeoutMs: undefined, expected: 30_000 }, // missing → safe default
      { timeoutMs: 'abc', expected: 30_000 }, // invalid → safe default
      { timeoutMs: '1', expected: 5_000 }, // floor
      { timeoutMs: '99999999', expected: 120_000 }, // ceiling
    ];
    for (const { timeoutMs, expected } of cases) {
      const server = await startMockServer(() => ({ payload: ECHO_OK }));
      try {
        withGeminiEnv(server.url, timeoutMs);
        const health = await runProviderHealthCheck();
        assert.equal(health.effectiveTimeoutMs, expected, `AI_TIMEOUT_MS=${timeoutMs ?? '<missing>'}`);
        assert.equal(health.operational, true);
        assert.equal(health.echoMatched, true);
      } finally {
        await server.close();
      }
    }
  });

  it('a real response arriving at ~10.5s — beyond the OLD hard-coded cap — still succeeds under AI_TIMEOUT_MS=45000', async () => {
    const server = await startMockServer(() => ({ payload: ECHO_OK, delayMs: 10_500 }));
    try {
      withGeminiEnv(server.url, '45000');
      const health = await runProviderHealthCheck();
      assert.equal(health.status, 'OPERATIONAL', 'the probe must NOT stop at 10 seconds');
      assert.equal(health.errorCategory, null);
      assert.equal(health.providerReachable, true);
      assert.equal(health.modelAccepted, true);
      assert.equal(health.operational, true);
      assert.equal(health.echoMatched, true);
    } finally {
      await server.close();
    }
  });

  it('failure path honours the configured boundary: hanging endpoint + AI_TIMEOUT_MS=5000 → TIMEOUT at ~5s (not 10s)', async () => {
    const server = await startHangingServer();
    try {
      withGeminiEnv(server.url, '5000');
      const health = await runProviderHealthCheck();
      assert.equal(health.status, 'TIMEOUT');
      assert.equal(health.errorCategory, 'AI_TIMEOUT');
      assert.equal(health.effectiveTimeoutMs, 5_000);
      assert.equal(health.providerReachable, false);
      assert.equal(health.modelAccepted, false);
      assert.equal(health.operational, false);
      assert.equal(health.providerHttpStatus, null);
    } finally {
      await server.close();
    }
  });

  it('timeout result stays secret-free (no key, no headers)', async () => {
    const secret = 'AQ.Ab8RN6-PROBE-TIMEOUT-KEY-000';
    const server = await startHangingServer();
    try {
      withGeminiEnv(server.url, '5000');
      process.env.AI_API_KEY = secret;
      const health = await runProviderHealthCheck();
      assert.ok(!JSON.stringify(health).includes(secret));
    } finally {
      await server.close();
    }
  });
});
// ── back-compat: mapping helpers keep working without detail ────
describe('mapping helper backward compatibility', () => {
  it('mapGeminiFailure keeps its 3-arg signature valid (diagnostic degrades gracefully)', () => {
    const error = mapGeminiFailure(400, 'INVALID_ARGUMENT', false);
    assert.equal(error.code, 'AI_MODEL_ERROR');
    assert.deepEqual(error.diagnostic, { httpStatus: 400, providerStatus: 'INVALID_ARGUMENT', providerCode: null, safeReason: null });
  });

  it('readGeminiErrorStatus keeps classifying API-key errors (400 + key message → auth)', async () => {
    const parsed = await readGeminiErrorStatus(new Response(
      geminiErrorBody(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.'),
      { status: 400 },
    ));
    assert.equal(parsed.looksLikeApiKeyError, true);
    assert.equal(parsed.apiStatus, 'INVALID_ARGUMENT');
    assert.equal(parsed.apiCode, 400);
    assert.equal(mapGeminiFailure(400, parsed.apiStatus, parsed.looksLikeApiKeyError).code, 'AI_AUTH_ERROR');
  });
});
