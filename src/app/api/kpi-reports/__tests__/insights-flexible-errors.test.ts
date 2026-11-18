// ══════════════════════════════════════════════════════════════
//  §API-ERROR-CONTRACTS — GET /api/kpi-reports/insights-flexible
//
//  The route classifies builder failures STRUCTURALLY (typed
//  FlexiblePeriodValidationError with a stable machine-readable code)
//  — never by matching Arabic message substrings. Arabic text stays
//  the user-facing message; the stable code rides in
//  `error.details.periodErrorCode`.
//
//  Covers: typed failure codes for every period validation branch,
//  the structural classifier (incl. the cross-bundle plain-object
//  shape), and the REAL route handler's error contract:
//  401 / 403 / 400-with-stable-code / 500 — same canonical error body
//  shape ({ error: { code, message, details?, validation? } }).
//
//  Harness: m01-test-support (in-memory db stubs — no Firebase).
// ══════════════════════════════════════════════════════════════

import '../../../../lib/__tests__/m01-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resetTestData,
  registerFixtures,
  registerUser,
  setTable,
  bearerHeaders,
  dbStubs,
} from '../../../../lib/__tests__/m01-test-support';
import {
  resolveFlexiblePeriod,
  resolvePeriodWithComparison,
  isFlexiblePeriodValidationError,
  FlexiblePeriodValidationError,
} from '@/lib/kpi-reporting';

type Route = { GET: (req: Request) => Promise<Response> };
const route = {} as Route;
const tokens: { admin: string; plain: string } = { admin: '', plain: '' };

before(async () => {
  Object.assign(route, await import('@/app/api/kpi-reports/insights-flexible/route'));
});

beforeEach(async () => {
  resetTestData();
  setTable('orgNodes', [
    { id: 'ga', name: 'الإدارة العامة', type: 'general_administration', parentId: null, managerUserId: null, status: 'active' },
  ]);
  setTable('employees', [
    { id: 'emp_1', name: 'أحمد', code: '001', status: 'active', orgNodeId: 'ga', createdAt: '2026-01-01T00:00:00.000Z' },
  ]);
  // Users live in the SAME reset tables — re-register + re-mint per test
  // (the established harness pattern; token signatures don't depend on db state).
  const t = await registerFixtures();
  tokens.admin = t.adminToken;
  // A role whose preset grants NO kpiReports page (DEFAULT_PERMISSIONS).
  registerUser({ id: 'u-plain', email: 'plain@test.local', name: 'بدون صلاحية', role: 'user' });
  tokens.plain = await import('@/lib/auth').then(({ signToken }) =>
    signToken({ userId: 'u-plain', email: 'plain@test.local', role: 'user' }, 'access'),
  );
});

function get(url: string, token?: string): Promise<Response> {
  return route.GET(new Request(`http://localhost${url}`, {
    headers: token ? bearerHeaders(token) : {},
  }));
}

// ───────────────────────────────────────────────────────────────

describe('§API-ERROR-CONTRACTS — typed period validation codes (unit layer)', () => {
  it('every period failure branch carries its stable code with the Arabic message', () => {
    const cases: Array<{ spec: Parameters<typeof resolveFlexiblePeriod>[0]; code: string }> = [
      { spec: { kind: 'day', date: '2026-13-40' }, code: 'INVALID_DAY_KEY' },
      { spec: { kind: 'week', weekStart: 'not-a-date' }, code: 'INVALID_DAY_KEY' },
      { spec: { kind: 'month', monthKey: '2026-13' }, code: 'INVALID_MONTH_KEY' },
      { spec: { kind: 'quarter', year: 1800, quarter: 1 }, code: 'INVALID_YEAR' },
      { spec: { kind: 'six_months', year: 2200, half: 1 }, code: 'INVALID_YEAR' },
      { spec: { kind: 'year', year: 999 }, code: 'INVALID_YEAR' },
      { spec: { kind: 'custom_range', fromDate: '2026-09-10', toDate: '2026-09-01' }, code: 'INVALID_RANGE_ORDER' },
      { spec: { kind: 'custom_range', fromDate: '2025-01-01', toDate: '2026-06-01' }, code: 'EXCEEDS_MAX_SPAN' },
      { spec: { kind: 'decade' } as never, code: 'UNKNOWN_KIND' },
    ];
    for (const { spec, code } of cases) {
      const result = resolveFlexiblePeriod(spec);
      assert.equal(result.ok, false, `expected failure for ${JSON.stringify(spec)}`);
      if (!result.ok) {
        assert.equal(result.code, code, `code mismatch for ${JSON.stringify(spec)}`);
        assert.ok(result.error.length > 0, 'Arabic message preserved');
      }
    }
  });

  it('the overlap policy failure carries PERIOD_OVERLAP (§4.1)', () => {
    const result = resolvePeriodWithComparison(
      { kind: 'custom_range', fromDate: '2026-09-01', toDate: '2026-09-20' },
      { kind: 'custom_range', fromDate: '2026-09-15', toDate: '2026-09-30' },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'PERIOD_OVERLAP');
      assert.ok(result.error.includes('متداخلتان'), 'Arabic overlap message preserved');
    }
  });
});

describe('§API-ERROR-CONTRACTS — the structural classifier', () => {
  it('recognizes the typed error (instanceof + cross-bundle plain-object shape)', () => {
    const typed = new FlexiblePeriodValidationError('PERIOD_OVERLAP', 'رسالة');
    assert.ok(isFlexiblePeriodValidationError(typed));
    assert.ok(typed instanceof Error);

    // A structurally identical error from a different module bundle
    // (name + code) is still recognized — no reliance on identity.
    const crossBundle = { name: 'FlexiblePeriodValidationError', code: 'EXCEEDS_MAX_SPAN', message: 'x' };
    assert.ok(isFlexiblePeriodValidationError(crossBundle));

    assert.equal(isFlexiblePeriodValidationError(new Error('فترتا التقرير والمقارنة متداخلتان')), false,
      'a plain Error with the same Arabic text is NOT classified as validation — the old substring trap');
    assert.equal(isFlexiblePeriodValidationError(null), false);
    assert.equal(isFlexiblePeriodValidationError({ name: 'Error', code: 'PERIOD_OVERLAP' }), false);
  });
});

describe('§API-ERROR-CONTRACTS — route-level error contract', () => {
  it('the route classifies structurally — no Arabic substring matching remains in source', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/kpi-reports/insights-flexible/route.ts'),
      'utf8',
    );
    assert.ok(source.includes('isFlexiblePeriodValidationError'), 'typed classification missing');
    for (const fragment of ["includes('متداخلتان')", "includes('غير صالح')", "includes('الحد الأقصى')"]) {
      assert.ok(!source.includes(fragment), `fragile substring classification still present: ${fragment}`);
    }
  });

  it('401 without a token; 403 for a caller without the kpiReports page', async () => {
    const unauth = await get('/api/kpi-reports/insights-flexible?period=%7B%22kind%22%3A%22month%22%2C%22monthKey%22%3A%222026-09%22%7D');
    assert.equal(unauth.status, 401);
    const unauthBody = await unauth.json();
    assert.equal(unauthBody.error.code, 'UNAUTHORIZED');
    assert.equal(unauthBody.error.validation, undefined);

    const forbidden = await get(
      '/api/kpi-reports/insights-flexible?period=%7B%22kind%22%3A%22month%22%2C%22monthKey%22%3A%222026-09%22%7D',
      tokens.plain,
    );
    assert.equal(forbidden.status, 403);
    const forbiddenBody = await forbidden.json();
    assert.equal(forbiddenBody.error.code, 'FORBIDDEN');
  });

  it('400 missing required period param — VALIDATION code + validation:true', async () => {
    const res = await get('/api/kpi-reports/insights-flexible', tokens.admin);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION');
    assert.equal(body.error.validation, true);
    assert.ok(typeof body.error.message === 'string' && body.error.message.length > 0);
  });

  it('400 invalid period JSON — stable VALIDATION shape', async () => {
    const res = await get('/api/kpi-reports/insights-flexible?period=not-json', tokens.admin);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION');
    assert.equal(body.error.validation, true);
  });

  it('400 overlapping periods — typed code surfaces in details.periodErrorCode, Arabic message intact', async () => {
    const primary = encodeURIComponent(JSON.stringify({ kind: 'custom_range', fromDate: '2026-09-01', toDate: '2026-09-20' }));
    const comparison = encodeURIComponent(JSON.stringify({ kind: 'custom_range', fromDate: '2026-09-15', toDate: '2026-09-30' }));
    const res = await get(`/api/kpi-reports/insights-flexible?period=${primary}&comparison=${comparison}`, tokens.admin);
    assert.equal(res.status, 400, 'overlap is a client-input 400');
    const body = await res.json();
    assert.equal(body.error.code, 'VALIDATION');
    assert.equal(body.error.validation, true);
    assert.equal(body.error.details?.periodErrorCode, 'PERIOD_OVERLAP');
    assert.ok(body.error.message.includes('متداخلتان'), 'the Arabic user-facing message is preserved');
    // Response shape: EXACTLY the canonical error envelope.
    assert.deepEqual(Object.keys(body.error).sort(), ['code', 'details', 'message', 'validation']);
  });

  it('400 invalid custom-range order carries INVALID_RANGE_ORDER in details', async () => {
    const primary = encodeURIComponent(JSON.stringify({ kind: 'custom_range', fromDate: '2026-09-10', toDate: '2026-09-01' }));
    const res = await get(`/api/kpi-reports/insights-flexible?period=${primary}`, tokens.admin);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.details?.periodErrorCode, 'INVALID_RANGE_ORDER');
  });

  it('500 on an internal failure — INTERNAL code, no stack/internal details leaked', async () => {
    const original = dbStubs.getAll;
    dbStubs.getAll = async () => {
      throw new Error('db exploded: secret-internal-detail');
    };
    try {
      const primary = encodeURIComponent(JSON.stringify({ kind: 'month', monthKey: '2026-09' }));
      const res = await get(`/api/kpi-reports/insights-flexible?period=${primary}`, tokens.admin);
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.error.code, 'INTERNAL');
      assert.equal(body.error.validation, undefined);
      const serialized = JSON.stringify(body);
      assert.ok(!serialized.includes('secret-internal-detail'), 'internal error details must not leak');
      assert.ok(!serialized.includes('db exploded'), 'internal message must not leak');
    } finally {
      dbStubs.getAll = original;
    }
  });
});
