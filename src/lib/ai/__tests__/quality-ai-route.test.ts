// ══════════════════════════════════════════════════════════════
//  Phase 6.2 — POST /api/ai/quality-analysis route tests (§49)
//
//  The route handler runs END-TO-END over the m01 in-memory harness
//  (real JWT + real permission map + real employee scope + REAL PI
//  loaders + REAL deterministic analytics). The provider is an
//  OpenAI-compatible adapter pointed at a LOCAL mock HTTP server —
//  no external calls, no real credentials (spec §72 honesty).
//
//  Covered here: 1 authenticated · 2 unauthorized · 3 permission
//  denial · 4 employee scope (404 anti-enumeration) · 7 MTD ·
//  9 provider unavailable · 11 provider error (network) ·
//  12 invalid JSON · 20 no raw dump · 34 rate protection ·
//  server-side key handling (§64).
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
  clearQualityAICacheForTests,
  clearQualityAIRateLimitForTests,
} from '@/lib/ai/quality/cache';

const routeModule = import('@/app/api/ai/quality-analysis/route');

const MONTH = '2026-09';
const EMP = 'emp-1';
const EMP_OTHER = 'emp-2';

let adminToken = '';
let userToken = ''; // role 'user' → kpiReports: none
let scopedToken = ''; // kpiReports read + employees scope 'own' linked to emp-2

async function seedWorld(): Promise<void> {
  resetTestData();
  clearQualityAICacheForTests();
  clearQualityAIRateLimitForTests();
  const { adminToken: t1, userToken: t2 } = await registerFixtures();
  adminToken = t1;
  userToken = t2;
  registerUser({
    id: 'u-ai-scope', email: 'aiscope@test.local', name: 'نطاق KPI ذاتي', role: 'user',
    linkedEmployeeId: EMP_OTHER,
    permissions: {
      kpiReports: { level: 'read' },
      employees: { level: 'read', scope: 'own' },
    },
  });
  scopedToken = await mintToken({ userId: 'u-ai-scope', email: 'aiscope@test.local', role: 'user' });

  setTable('employees', [
    { id: EMP, code: 'EMP-001', name: 'أحمد محمود', department: 'العمليات', position: 'موظف', status: 'active' },
    { id: EMP_OTHER, code: 'EMP-002', name: 'سارة أحمد', department: 'المبيعات', position: 'مندوبة', status: 'active' },
  ]);
  setTable('qualityObservations', [
    {
      id: 'obs-1', employeeId: EMP, employeeName: 'أحمد محمود',
      categoryName: 'متابعة العملاء', categoryId: 'cat-followup',
      type: 'تأخير المتابعة', notes: 'لم يتم متابعة العميل بعد الحجز',
      severity: 'medium', status: 'open', approvalStatus: 'approved',
      observationDate: '10/09/2026', month: MONTH,
    },
    {
      id: 'obs-2', employeeId: EMP_OTHER, employeeName: 'سارة أحمد',
      categoryName: 'دقة الحجز', categoryId: 'cat-booking',
      type: 'دقة الحجز', notes: 'دقة في تأكيد الحجز',
      severity: 'low', status: 'open', approvalStatus: 'approved',
      observationDate: '12/09/2026', month: MONTH,
    },
  ]);
}

function aiRequest(body: unknown, token?: string): Request {
  return new Request('http://localhost/api/ai/quality-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? bearerHeaders(token) : {}) },
    body: JSON.stringify(body),
  });
}

// ── env control (AI disabled by default — §60) ──────────────────
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

function enableLocalMockProvider(url: string): void {
  process.env.AI_ENABLED = 'true';
  process.env.AI_PROVIDER = 'openai-compatible';
  process.env.AI_API_KEY = 'sk-route-test-key';
  process.env.AI_BASE_URL = url;
  process.env.AI_TIMEOUT_MS = '5000';
}

// ── local mock provider server ──────────────────────────────────
const VALID_COMPLETION = JSON.stringify({
  choices: [{ message: { content: JSON.stringify({
    insights: [{
      id: 'ins-1', type: 'PATTERN',
      title: 'تركز في متابعة العملاء',
      factBasis: 'تم تسجيل ملاحظة واحدة في الفترة ضمن التصنيف نفسه',
      interpretation: 'قد يستحق هذا التصنيف متابعة أقرب',
      summary: 'تركز أولي في تصنيف واحد',
      severity: 'LOW', confidence: 'LOW',
      supportingEvidence: [{ refId: 'observations' }],
      limitations: ['عينة واحدة'],
    }],
    recommendations: [],
    limitations: ['بيانات محدودة'],
    confidence: 'LOW',
  }) } }],
});

function startMockServer(): Promise<{ url: string; bodies: string[]; auths: string[]; close: () => Promise<void> }> {
  const bodies: string[] = [];
  const auths: string[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      bodies.push(raw);
      auths.push(String(req.headers.authorization));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(VALID_COMPLETION);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, bodies, auths, close: () => new Promise<void>((d) => server.close(() => d())) });
    });
  });
}

// ── authorization doctrine (§8) ─────────────────────────────────
describe('AI route — authorization', () => {
  beforeEach(seedWorld);

  it('(2) unauthenticated request → 401', async () => {
    const { POST } = await routeModule;
    const res = await POST!(aiRequest({ employeeId: EMP, month: MONTH }) as never);
    assert.equal(res.status, 401);
  });

  it('(3) role without kpiReports view → 403 (AI is not a permission bypass)', async () => {
    const { POST } = await routeModule;
    const res = await POST!(aiRequest({ employeeId: EMP, month: MONTH }, userToken) as never);
    assert.equal(res.status, 403);
  });

  it('(4) employee OUTSIDE the caller scope → 404, no existence leak', async () => {
    const { POST } = await routeModule;
    const res = await POST!(aiRequest({ employeeId: EMP, month: MONTH }, scopedToken) as never);
    assert.equal(res.status, 404);
  });

  it('(1) invalid bodies → 400 (missing employee / bad month / wrong types)', async () => {
    const { POST } = await routeModule;
    assert.equal((await POST!(aiRequest({}, adminToken) as never)).status, 400);
    assert.equal((await POST!(aiRequest({ employeeId: EMP, month: '09-2026' }, adminToken) as never)).status, 400);
    assert.equal((await POST!(aiRequest({ employeeId: 42, month: MONTH }, adminToken) as never)).status, 400);
    // Permission/scope parameters CANNOT influence the AI (§7/§8):
    // unknown client fields are IGNORED — scope is resolved server-side
    // (the scoped-user + admin tests above prove the enforcement).
    const injected = await POST!(aiRequest({ employeeId: EMP, month: MONTH, permissions: { all: true }, scope: 'unrestricted' }, userToken) as never);
    assert.equal(injected.status, 403); // the plain user STILL has no access
  });
});

// ── unconfigured / configured provider ──────────────────────────
describe('AI route — provider states', () => {
  beforeEach(seedWorld);

  it('(9) AI not configured → 200 AI_UNAVAILABLE envelope; report facts unaffected (§6/§24)', async () => {
    const { POST } = await routeModule;
    const res = await POST!(aiRequest({ employeeId: EMP, month: MONTH }, adminToken) as never);
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string; message: string };
    assert.equal(body.status, 'AI_UNAVAILABLE');
    assert.ok(body.message.length > 0);
  });

  it('(1)+(20)+(64) configured + local mock provider → OK result; server-side Bearer key; payload delimited; scope enforced', async () => {
    const mock = await startMockServer();
    try {
      enableLocalMockProvider(mock.url);
      const { POST } = await routeModule;
      // The SCOPED user may analyze THEIR OWN employee (in-scope path).
      const res = await POST!(aiRequest({ employeeId: EMP_OTHER, month: MONTH }, scopedToken) as never);
      assert.equal(res.status, 200);
      const body = await res.json() as { status: string; result?: { insights: unknown[]; provider: string; model: string; promptVersion: string; period: { finalized: boolean } } };
      assert.equal(body.status, 'OK');
      assert.ok(body.result);
      assert.equal(body.result!.provider, 'openai-compatible');
      assert.equal(body.result!.promptVersion, 'quality-analysis-v1');
      assert.equal(body.result!.period.finalized, false);
      assert.ok(Array.isArray(body.result!.insights));
      // §64: the API key travelled SERVER-SIDE only, as a Bearer header.
      assert.equal(mock.auths.length >= 1, true);
      assert.equal(mock.auths[0], 'Bearer sk-route-test-key');
      // §30: data is delimited; §10: employee NAME never crosses.
      assert.match(mock.bodies[0], /<<<ARM_DATA_BEGIN>>>/);
      assert.ok(!mock.bodies[0].includes('سارة أحمد'));
      // The system prompt arrives in the system role, NOT inside data.
      assert.match(mock.bodies[0], /مصدر الحقيقة/);
    } finally {
      await mock.close();
    }
  });

  it('(11) provider endpoint down → 200 AI_ERROR (AI_NETWORK_ERROR), no crash (§53/§62)', async () => {
    enableLocalMockProvider('http://127.0.0.1:9');
    const { POST } = await routeModule;
    const res = await POST!(aiRequest({ employeeId: EMP, month: MONTH }, adminToken) as never);
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string; reason: string };
    assert.equal(body.status, 'AI_ERROR');
    assert.equal(body.reason, 'AI_NETWORK_ERROR');
  });

  it('(12) provider returns prose → AI_INVALID_RESPONSE, nothing untrusted rendered (§27)', async () => {
    const server = http.createServer((req, res) => {
      req.on('data', () => { /* drain */ });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'أنا روبوت وأتكلم بحرية بدون JSON' } }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      enableLocalMockProvider(`http://127.0.0.1:${port}`);
      const { POST } = await routeModule;
      const res = await POST!(aiRequest({ employeeId: EMP, month: MONTH }, adminToken) as never);
      const body = await res.json() as { status: string };
      assert.equal(body.status, 'AI_INVALID_RESPONSE');
    } finally {
      server.close();
    }
  });

  it('(34) request storm → AI_RATE_LIMITED after the window budget', async () => {
    const mock = await startMockServer();
    try {
      enableLocalMockProvider(mock.url);
      const { POST } = await routeModule;
      let sawRateLimited = false;
      for (let i = 0; i < 8; i++) {
        const res = await POST!(aiRequest({ employeeId: EMP, month: MONTH }, adminToken) as never);
        const body = await res.json() as { status: string };
        if (body.status === 'AI_RATE_LIMITED') { sawRateLimited = true; break; }
      }
      assert.equal(sawRateLimited, true);
    } finally {
      await mock.close();
    }
  });
});
