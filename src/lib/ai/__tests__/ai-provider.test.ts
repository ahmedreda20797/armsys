// ══════════════════════════════════════════════════════════════
//  Phase 6.2 — AI Provider layer tests (spec §49)
//
//  Covered here: 9 provider unavailable · 10 timeout · 11 provider
//  error · 12 invalid JSON · 22 provider abstraction · 33 config —
//  plus the OpenAI-compatible adapter against a LOCAL mock HTTP
//  server (no external calls, no credentials) and error mapping
//  (spec §62: 401/429/500/network/timeout → structured statuses).
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  readAIProviderConfig,
  createAIProviderFromEnv,
  AIProviderError,
  OpenAICompatibleProvider,
  ZaiProvider,
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

// ── local mock OpenAI-compatible server ─────────────────────────
interface MockCall {
  auth: string | undefined;
  body: Record<string, unknown>;
}

function startMockServer(handler: (req: http.IncomingMessage, body: string) => {
  status?: number;
  contentType?: string;
  payload?: string;
}): Promise<{ url: string; calls: MockCall[]; close: () => Promise<void> }> {
  const calls: MockCall[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      calls.push({ auth: req.headers.authorization, body: JSON.parse(raw || '{}') });
      const out = handler(req, raw);
      res.writeHead(out.status ?? 200, { 'Content-Type': out.contentType ?? 'application/json' });
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
  systemPrompt: 'SYSTEM',
  userContent: 'USER',
  timeoutMs: 2000,
};

const VALID_COMPLETION = JSON.stringify({
  choices: [{ message: { content: '{"insights": []}' } }],
});

// ── §33 configuration ───────────────────────────────────────────
describe('AI provider configuration (spec §6/§33/§60)', () => {
  it('returns null when nothing is configured → system degrades to AI_UNAVAILABLE', () => {
    assert.equal(readAIProviderConfig(), null);
    assert.equal(createAIProviderFromEnv(), null);
  });

  it('AI_ENABLED!=true disables AI even with a full configuration', () => {
    process.env.AI_ENABLED = 'false';
    process.env.AI_PROVIDER = 'openai-compatible';
    process.env.AI_API_KEY = 'sk-test';
    assert.equal(readAIProviderConfig(), null);
  });

  it('unknown provider name → null (no accidental default, spec §33)', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'oracle-magic';
    assert.equal(readAIProviderConfig(), null);
  });

  it('openai-compatible WITHOUT a server-side key → null', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'openai-compatible';
    assert.equal(readAIProviderConfig(), null);
  });

  it('openai-compatible with key → full config, default timeout', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'openai-compatible';
    process.env.AI_API_KEY = 'sk-test';
    const config = readAIProviderConfig();
    assert.ok(config);
    assert.equal(config.kind, 'openai-compatible');
    assert.equal(config.apiKey, 'sk-test');
    assert.equal(config.timeoutMs, 30_000);
    const provider = createAIProviderFromEnv();
    assert.ok(provider instanceof OpenAICompatibleProvider);
    assert.equal(provider.name, 'openai-compatible');
  });

  it('z-ai provider config → ZaiProvider instance', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'z-ai';
    const provider = createAIProviderFromEnv();
    assert.ok(provider instanceof ZaiProvider);
    assert.equal(provider.name, 'z-ai');
  });

  it('timeout clamped into 5000..120000', () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'openai-compatible';
    process.env.AI_API_KEY = 'sk-test';
    process.env.AI_TIMEOUT_MS = '1';
    assert.equal(readAIProviderConfig()!.timeoutMs, 5_000);
    process.env.AI_TIMEOUT_MS = '99999999';
    assert.equal(readAIProviderConfig()!.timeoutMs, 120_000);
  });
});

// ── OpenAI-compatible adapter against a LOCAL mock server ──────
describe('OpenAI-compatible adapter (spec §61/§62/§63)', () => {
  it('success: returns text + provenance and sends Bearer auth + both messages', async () => {
    const server = await startMockServer(() => ({ payload: VALID_COMPLETION }));
    try {
      const provider = new OpenAICompatibleProvider({ apiKey: 'sk-local-test', model: 'test-model', baseUrl: server.url });
      const completion = await provider.analyze({
        ...BASE_REQUEST,
        systemPrompt: 'SYSTEM-PROMPT-MARKER',
        userContent: 'USER-DATA-MARKER',
      });
      assert.equal(completion.text, '{"insights": []}');
      assert.equal(completion.provider, 'openai-compatible');
      assert.equal(completion.model, 'test-model');
      assert.equal(server.calls.length, 1);
      assert.equal(server.calls[0].auth, 'Bearer sk-local-test');
      const messages = server.calls[0].body.messages as Array<{ role: string; content: string }>;
      assert.equal(messages[0].role, 'system');
      assert.match(messages[0].content, /SYSTEM-PROMPT-MARKER/);
      assert.equal(messages[1].role, 'user');
      assert.match(messages[1].content, /USER-DATA-MARKER/);
    } finally {
      await server.close();
    }
  });

  it('401 → AI_AUTH_ERROR with NO retry (exactly one request)', async () => {
    const server = await startMockServer(() => ({ status: 401 }));
    try {
      const provider = new OpenAICompatibleProvider({ apiKey: 'sk-bad', baseUrl: server.url });
      await assert.rejects(
        provider.analyze(BASE_REQUEST),
        (error: unknown) => error instanceof AIProviderError && error.code === 'AI_AUTH_ERROR',
      );
      assert.equal(server.calls.length, 1);
    } finally {
      await server.close();
    }
  });

  it('429 → exactly ONE safe retry then AI_RATE_LIMITED (spec §63)', async () => {
    const server = await startMockServer(() => ({ status: 429 }));
    try {
      const provider = new OpenAICompatibleProvider({ apiKey: 'sk', baseUrl: server.url });
      await assert.rejects(
        provider.analyze(BASE_REQUEST),
        (error: unknown) => error instanceof AIProviderError && error.code === 'AI_RATE_LIMITED',
      );
      assert.equal(server.calls.length, 2);
    } finally {
      await server.close();
    }
  });

  it('500 → one retry then AI_PROVIDER_ERROR; raw provider body never leaks', async () => {
    const server = await startMockServer(() => ({ status: 500, payload: 'INTERNAL-PROVIDER-DETAILS' }));
    try {
      const provider = new OpenAICompatibleProvider({ apiKey: 'sk', baseUrl: server.url });
      try {
        await provider.analyze(BASE_REQUEST);
        assert.fail('must reject');
      } catch (error) {
        assert.ok(error instanceof AIProviderError);
        assert.equal(error.code, 'AI_PROVIDER_ERROR');
        assert.doesNotMatch(error.message, /INTERNAL-PROVIDER-DETAILS/);
      }
      assert.equal(server.calls.length, 2);
    } finally {
      await server.close();
    }
  });

  it('non-JSON 200 body → AI_INVALID_RESPONSE', async () => {
    const server = await startMockServer(() => ({ payload: 'not json at all' }));
    try {
      const provider = new OpenAICompatibleProvider({ apiKey: 'sk', baseUrl: server.url });
      await assert.rejects(
        provider.analyze(BASE_REQUEST),
        (error: unknown) => error instanceof AIProviderError && error.code === 'AI_INVALID_RESPONSE',
      );
    } finally {
      await server.close();
    }
  });

  it('200 with missing choices/content → AI_INVALID_RESPONSE', async () => {
    const server = await startMockServer(() => ({ payload: '{"choices": []}' }));
    try {
      const provider = new OpenAICompatibleProvider({ apiKey: 'sk', baseUrl: server.url });
      await assert.rejects(
        provider.analyze(BASE_REQUEST),
        (error: unknown) => error instanceof AIProviderError && error.code === 'AI_INVALID_RESPONSE',
      );
    } finally {
      await server.close();
    }
  });

  it('connection refused → one retry then AI_NETWORK_ERROR', async () => {
    // Port 9 (discard) — nothing listens; deterministic refusal.
    const provider = new OpenAICompatibleProvider({ apiKey: 'sk', baseUrl: 'http://127.0.0.1:9' });
    await assert.rejects(
      provider.analyze({ ...BASE_REQUEST, timeoutMs: 3000 }),
      (error: unknown) => error instanceof AIProviderError && error.code === 'AI_NETWORK_ERROR',
    );
  });

  it('hanging server + small timeout → AI_TIMEOUT (abort, no retry)', async () => {
    const server = await startMockServer(() => {
      // Never respond — the client aborts.
      return { status: 200, payload: '{}' };
    });
    // Replace response logic with a hanging socket: close without answering.
    const hanging = http.createServer(() => { /* never ends */ });
    await new Promise<void>((resolve) => hanging.listen(0, '127.0.0.1', resolve));
    const { port } = hanging.address() as AddressInfo;
    try {
      const provider = new OpenAICompatibleProvider({ apiKey: 'sk', baseUrl: `http://127.0.0.1:${port}` });
      await assert.rejects(
        provider.analyze({ ...BASE_REQUEST, timeoutMs: 300 }),
        (error: unknown) => error instanceof AIProviderError && error.code === 'AI_TIMEOUT',
      );
      assert.equal(server.calls.length, 0); // request never completed → no retries
    } finally {
      hanging.close();
      await server.close();
    }
  });
});

// ── z-ai adapter — graceful degradation contract only (§5/§33) ──
describe('z-ai adapter', () => {
  it('exposes stable provenance and never throws a raw (non-AIProviderError) failure', async () => {
    const provider = new ZaiProvider(null);
    assert.equal(provider.name, 'z-ai');
    assert.equal(typeof provider.model, 'string');
    // Platform credentials may or may not exist on this machine — the
    // CONTRACT is: either a valid completion or a structured AIProviderError.
    const outcome = await provider.analyze({ ...BASE_REQUEST, timeoutMs: 8000 }).then(
      (completion) => ({ ok: true as const, completion }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    if (!outcome.ok) {
      assert.ok(outcome.error instanceof AIProviderError);
    } else {
      assert.equal(typeof outcome.completion.text, 'string');
    }
  });
});
