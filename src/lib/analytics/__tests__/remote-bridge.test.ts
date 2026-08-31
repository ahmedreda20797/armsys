// ══════════════════════════════════════════════════════════════
//  Phase 5.2 — Remote analytics bridge tests (spec §41 items 13-23)
//
//  Convention (repo-wide): node:test + node:assert/strict via
//  `tsx --test`. The remote transport is exercised with a mocked
//  global fetch — no real network, no real service required.
//  The mocked 200 body is a contract-realistic engine result
//  (fixtures.ts, spec §42 partial-MTD scenario).
//
//  Covers:
//   13. local mode default (no fetch, unchanged Phase 5 behavior)
//   14. remote mode dispatch (URL, method, headers, body)
//   15. remote success → ok result, identical contract
//   16. remote timeout → TIMEOUT (never retried)
//   17. remote unavailable (network failure ×2 → PYTHON_UNAVAILABLE,
//       ONE short retry for connection failures only, §23)
//   18. remote invalid response (200 + garbage → INVALID_OUTPUT)
//   19. authentication is server-side (Bearer header carries the key)
//   20. the API key never reaches any client-facing body
//   21. permission happens before Python (static route contract)
//   22. employee scope happens before Python (static route contract)
//   23. Python failure does not break the report (explicit 200 states)
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  _resetPythonAnalyticsCacheForTests,
  analyticsApiResponseBody,
  runPythonAnalytics,
} from '@/lib/analytics/python-bridge';
import type { AnalyticsApiResponse } from '@/lib/analytics/types';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import { makeOkResult } from './fixtures';

const TEST_KEY = 'remote-test-key-0123456789abcdef';
const SERVICE_URL = 'https://analytics.example.internal';

const datasetStub = {
  datasetKind: 'EMPLOYEE_PERFORMANCE_INTELLIGENCE',
  employee: { employeeId: 'e1' },
  period: { monthKey: '2026-08', valueBasis: 'MTD' },
} as unknown as EmployeePerformanceDataset;

// ── fetch mocking helpers ─────────────────────────────────────

type FetchCall = { url: string; init: RequestInit };

interface MockReply {
  status: number;
  body: string;
  headers?: Record<string, string>;
}

let fetchCalls: FetchCall[] = [];
let replyFactory: ((call: FetchCall, attempt: number) => MockReply | 'network-error' | 'hang') | null = null;
const realFetch = globalThis.fetch;

function installFetchMock(
  factory: (call: FetchCall, attempt: number) => MockReply | 'network-error' | 'hang',
): void {
  fetchCalls = [];
  replyFactory = factory;
  let attempt = 0;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    attempt += 1;
    const call = { url: String(_url), init: init ?? {} };
    fetchCalls.push(call);
    const reply = factory(call, attempt);
    if (reply === 'network-error') {
      throw new TypeError('fetch failed');
    }
    if (reply === 'hang') {
      // Honor the abort signal exactly like real fetch does — the
      // bridge's AbortController must translate into an AbortError.
      return new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
        // Otherwise never resolves (no signal → genuine hang).
      });
    }
    return new Response(reply.body, {
      status: reply.status,
      headers: reply.headers ?? { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  _resetPythonAnalyticsCacheForTests();
  process.env.PYTHON_ANALYTICS_ENABLED = '1';
  process.env.PYTHON_ANALYTICS_MODE = 'remote';
  process.env.PYTHON_ANALYTICS_URL = SERVICE_URL;
  process.env.PYTHON_ANALYTICS_API_KEY = TEST_KEY;
  process.env.PYTHON_ANALYTICS_TIMEOUT_MS = '1000';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  replyFactory = null;
  delete process.env.PYTHON_ANALYTICS_TIMEOUT_MS;
});

// ══════════════════════════════════════════════════════════════
//  13 — local mode default: remote transport never engaged
// ══════════════════════════════════════════════════════════════

describe('Phase 5.2 — remote analytics bridge', () => {
  it('13. local mode (default) never performs a remote call', async () => {
    delete process.env.PYTHON_ANALYTICS_MODE;
    installFetchMock(() => {
      throw new Error('fetch MUST NOT be called in local mode');
    });
    process.env.PYTHON_ANALYTICS_ENABLED = '0'; // disable local subprocess path
    const outcome = await runPythonAnalytics(datasetStub);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, 'DISABLED');
    assert.equal(fetchCalls.length, 0);
  });

  it('14. remote mode posts the verified dataset to the service endpoint', async () => {
    installFetchMock(() => ({ status: 200, body: JSON.stringify(makeOkResult()) }));
    await runPythonAnalytics(datasetStub);
    assert.equal(fetchCalls.length, 1);
    const call = fetchCalls[0];
    assert.equal(call.url, `${SERVICE_URL}/analyze/employee-performance`);
    assert.equal((call.init.method as string), 'POST');
    assert.equal(String(call.init.body).startsWith('{'), true);
    const payload = JSON.parse(String(call.init.body)) as { schemaVersion: number; dataset: unknown };
    assert.equal(payload.schemaVersion, 1);
    assert.equal((payload.dataset as { datasetKind: string }).datasetKind,
      'EMPLOYEE_PERFORMANCE_INTELLIGENCE');
  });

  it('15. remote success → ok result with the SAME output contract', async () => {
    installFetchMock(() => ({ status: 200, body: JSON.stringify(makeOkResult()) }));
    const outcome = await runPythonAnalytics(datasetStub);
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.result.status, 'OK');
      assert.equal(outcome.result.trendAnalysis.status, 'INSUFFICIENT_DATA');
      assert.equal(outcome.result.analyticsEngineVersion, '1.0.0');
    }
  });

  it('15b. no retry after a successful response (retry = connection failures only)', async () => {
    installFetchMock(() => ({ status: 200, body: JSON.stringify(makeOkResult()) }));
    await runPythonAnalytics(datasetStub);
    assert.equal(fetchCalls.length, 1);
  });

  it('16. remote hang → TIMEOUT (distinct state, never retried, never unavailable)', async () => {
    installFetchMock(() => 'hang');
    const outcome = await runPythonAnalytics(datasetStub);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.reason, 'TIMEOUT');
      assert.equal(fetchCalls.length, 1);
    }
    const body = analyticsApiResponseBody(outcome);
    assert.equal(body.status, 'ANALYTICS_TIMEOUT');
  });

  it('17. remote unreachable → ONE short retry then PYTHON_UNAVAILABLE (spec §23)', async () => {
    installFetchMock(() => 'network-error');
    const outcome = await runPythonAnalytics(datasetStub);
    assert.equal(outcome.ok, false);
    assert.equal(fetchCalls.length, 2, 'exactly one retry for transient connection failures');
    if (!outcome.ok) assert.equal(outcome.reason, 'PYTHON_UNAVAILABLE');
    const body = analyticsApiResponseBody(outcome);
    assert.equal(body.status, 'ANALYTICS_UNAVAILABLE');
  });

  it('17b. transient connection failure that recovers on retry → success', async () => {
    installFetchMock((_call, attempt) =>
      attempt === 1 ? 'network-error' : { status: 200, body: JSON.stringify(makeOkResult()) });
    const outcome = await runPythonAnalytics(datasetStub);
    assert.equal(outcome.ok, true);
    assert.equal(fetchCalls.length, 2);
  });

  it('18. remote 200 with garbage body → INVALID_OUTPUT (ANALYTICS_ERROR, spec §9)', async () => {
    installFetchMock(() => ({ status: 200, body: '{"status": "OK", "half": ' }));
    const outcome = await runPythonAnalytics(datasetStub);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, 'INVALID_OUTPUT');
    assert.equal(analyticsApiResponseBody(outcome).status, 'ANALYTICS_ERROR');
  });

  it('18b. remote 200 with schema-violating body → INVALID_OUTPUT (deep validation)', async () => {
    const bad = makeOkResult() as unknown as Record<string, unknown>;
    delete bad.evidenceReferences; // spec §9: evidence references must validate
    installFetchMock(() => ({ status: 200, body: JSON.stringify(bad) }));
    const outcome = await runPythonAnalytics(datasetStub);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, 'INVALID_OUTPUT');
  });

  it('18c. remote HTTP 400 (dataset rejected by the service) → DATA_CONTRACT_ERROR', async () => {
    installFetchMock(() => ({
      status: 400,
      body: JSON.stringify({ status: 'ERROR', error: { code: 'ERROR_INVALID_DATASET' } }),
    }));
    const outcome = await runPythonAnalytics(datasetStub);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.reason, 'DATA_CONTRACT_ERROR');
      assert.match(outcome.detail ?? '', /ERROR_INVALID_DATASET/);
    }
    assert.equal(fetchCalls.length, 1, '4xx verdicts are never retried');
    assert.equal(analyticsApiResponseBody(outcome).status, 'ANALYTICS_ERROR');
  });

  it('18d. remote HTTP 401 (bad credentials) → SERVICE_AUTH_ERROR → ANALYTICS_ERROR', async () => {
    installFetchMock(() => ({ status: 401, body: 'unauthorized' }));
    const outcome = await runPythonAnalytics(datasetStub);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, 'SERVICE_AUTH_ERROR');
    assert.equal(analyticsApiResponseBody(outcome).status, 'ANALYTICS_ERROR');
  });

  it('18e. remote HTTP 500 → SERVICE_ERROR → ANALYTICS_ERROR (service answered)', async () => {
    installFetchMock(() => ({ status: 500, body: 'boom' }));
    const outcome = await runPythonAnalytics(datasetStub);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.reason, 'SERVICE_ERROR');
    assert.equal(analyticsApiResponseBody(outcome).status, 'ANALYTICS_ERROR');
  });

  it('19. authentication is server-side: Bearer key travels on the request', async () => {
    installFetchMock(() => ({ status: 200, body: JSON.stringify(makeOkResult()) }));
    await runPythonAnalytics(datasetStub);
    const headers = new Headers(fetchCalls[0].init.headers as Record<string, string>);
    assert.equal(headers.get('Authorization'), `Bearer ${TEST_KEY}`);
  });

  it('20. the API key NEVER reaches any client-facing body', async () => {
    installFetchMock(() => ({ status: 200, body: JSON.stringify(makeOkResult()) }));
    const okBody = analyticsApiResponseBody(await runPythonAnalytics(datasetStub));
    assert.equal(JSON.stringify(okBody).includes(TEST_KEY), false);
    // Failure bodies too — every reason maps without echoing secrets.
    for (const reason of ['PYTHON_UNAVAILABLE', 'TIMEOUT', 'SERVICE_ERROR', 'SERVICE_AUTH_ERROR'] as const) {
      const body: AnalyticsApiResponse = analyticsApiResponseBody({ ok: false, reason, detail: TEST_KEY });
      assert.equal(JSON.stringify(body).includes(TEST_KEY), false);
    }
    // Static: the bridge module reads the key from server env only —
    // never from window/localStorage, never from a NEXT_PUBLIC var.
    const bridgeSource = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/analytics/python-bridge.ts'), 'utf8');
    assert.equal(bridgeSource.includes('localStorage'), false);
    assert.equal(bridgeSource.includes('NEXT_PUBLIC'), false);
  });

  it('21-22. permission + employee scope happen BEFORE Python (static route contract)', () => {
    const routeSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/analytics/employee-performance/route.ts'), 'utf8');
    const order = (needle: string) => routeSource.indexOf(needle);
    const authPos = order('requireAuth(request)');
    const permPos = order("verifyPermission(request, 'kpiReports', 'view')");
    const scopePos = order('resolveEmployeeScopeFromDb');
    const datasetPos = order('getEmployeePerformanceDataset({');
    // The CALL SITE, not the import statement.
    const pythonPos = order('await runPythonAnalytics(');
    for (const [name, pos] of [['auth', authPos], ['permission', permPos], ['scope', scopePos], ['dataset', datasetPos]] as Array<[string, number]>) {
      assert.ok(pos >= 0, `${name} must exist in the route`);
      assert.ok(pos < pythonPos, `${name} must run BEFORE the Python call`);
    }
  });

  it('23. Python failure does not break the report: explicit 200 states, view builders never throw', () => {
    for (const reason of ['DISABLED', 'PYTHON_UNAVAILABLE', 'SCRIPT_MISSING', 'TIMEOUT',
      'SCRIPT_ERROR', 'INVALID_OUTPUT', 'DATA_CONTRACT_ERROR', 'SERVICE_ERROR',
      'SERVICE_AUTH_ERROR'] as const) {
      const body = analyticsApiResponseBody({ ok: false, reason, detail: 'x' });
      assert.ok(body.status === 'ANALYTICS_UNAVAILABLE'
        || body.status === 'ANALYTICS_TIMEOUT'
        || body.status === 'ANALYTICS_ERROR');
      assert.ok(typeof (body as { message: string }).message === 'string'
        && (body as { message: string }).message.length > 0);
    }
  });
});
