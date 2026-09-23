// ══════════════════════════════════════════════════════════════
//  HR Decision-Support — ROUTE contracts (authorization/scope)
//
//  The REAL route handlers run against the in-memory db harness:
//    • GET /api/reports/hr-performance/decision and …/employee sit
//      behind the SAME chain as the existing HR report:
//      requireAuth → verifyPermission('reports','view') → audience
//      resolution → server-resolved employee scope (M0.5).
//    • No token → 401; a role without the reports page → 403;
//      an authorized HR caller → the sanitized projection ONLY
//      (structural JSON-level exclusion of technical fields).
//    • The drill-down returns 404 for an employee outside the
//      caller's scope (fail-closed — indistinguishable from a
//      missing employee) and for a missing one.
//    • Scope narrowing uses the CANONICAL guard (filterEmployeesInScope)
//      — pinned directly on a restricted scope context.
// ══════════════════════════════════════════════════════════════

import './m01-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  registerFixtures,
  resetTestData,
  setTable,
  bearerHeaders,
} from './m01-test-support';
import { filterEmployeesInScope } from '@/lib/scope/server';
import type { EmployeeScopeContext } from '@/lib/scope';

interface DecisionRoute { GET: (req: Request) => Promise<Response> }
interface DecisionEmployeeRoute { GET: (req: Request) => Promise<Response> }

const decisionRoute = {} as DecisionRoute;
const decisionEmployeeRoute = {} as DecisionEmployeeRoute;
const testTokens = { user: '', hr: '' };

function get(url: string, token?: string): Promise<Response> {
  return decisionRoute.GET(new Request(`http://localhost${url}`, {
    headers: token ? bearerHeaders(token) : {},
  }));
}

function getEmployee(url: string, token?: string): Promise<Response> {
  return decisionEmployeeRoute.GET(new Request(`http://localhost${url}`, {
    headers: token ? bearerHeaders(token) : {},
  }));
}

before(async () => {
  Object.assign(decisionRoute, await import('@/app/api/reports/hr-performance/decision/route'));
  Object.assign(decisionEmployeeRoute, await import('@/app/api/reports/hr-performance/decision/employee/route'));
});

beforeEach(async () => {
  resetTestData();
  setTable('employees', [
    {
      id: 'emp_1', name: 'أحمد محمد', code: '001', department: 'المبيعات',
      position: 'مندوب مبيعات', status: 'active',
      createdAt: '2026-01-10T00:00:00.000Z',
    },
  ]);
  // Users live in the SAME reset tables — re-register + re-mint per test.
  const t = await registerFixtures();
  testTokens.user = t.userToken;
  testTokens.hr = t.hrToken;
});

// ─────────────────────────────────────────────────────────────
//  Static route contract (permission + scope + audience in source)
// ─────────────────────────────────────────────────────────────

describe('decision routes — static contract', () => {
  const routePaths = [
    'src/app/api/reports/hr-performance/decision/route.ts',
    'src/app/api/reports/hr-performance/decision/employee/route.ts',
  ];

  for (const rel of routePaths) {
    it(`${rel} enforces reports:view + server-resolved scope + audience`, () => {
      const source = readFileSync(join(process.cwd(), rel), 'utf8');
      assert.ok(source.includes("verifyPermission(request, 'reports', 'view')"), 'reports view permission missing');
      assert.ok(source.includes('resolveEmployeeScopeFromDb'), 'M0.5 scope resolution missing');
      assert.ok(source.includes('resolveReportAudience'), 'audience resolution missing');
      assert.ok(!source.includes("verifyPermission(request, 'reports', 'export')"));
    });
  }
});

// ─────────────────────────────────────────────────────────────
//  Authentication / permission gate
// ─────────────────────────────────────────────────────────────

describe('decision routes — auth', () => {
  it('401 without a valid token', async () => {
    const res = await get('/api/reports/hr-performance/decision?month=2026-09');
    assert.equal(res.status, 401);
    const resEmployee = await getEmployee('/api/reports/hr-performance/decision/employee?month=2026-09&employeeId=emp_1');
    assert.equal(resEmployee.status, 401);
  });

  it('403 for a caller whose role grants no reports page', async () => {
    const res = await get('/api/reports/hr-performance/decision?month=2026-09', testTokens.user);
    assert.equal(res.status, 403);
  });

  it('400 for an invalid month key', async () => {
    const res = await get('/api/reports/hr-performance/decision?month=2026-13', testTokens.hr);
    assert.equal(res.status, 400);
  });
});

// ─────────────────────────────────────────────────────────────
//  Authorized caller — sanitized projection only
// ─────────────────────────────────────────────────────────────

describe('decision routes — authorized HR caller', () => {
  it('200 team report over the scoped population with HR-safe shape only', async () => {
    const res = await get('/api/reports/hr-performance/decision?month=2026-09', testTokens.hr);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.reportKind, 'HR_TEAM_DECISION');
    assert.equal(body.audience, 'HR');
    assert.equal(body.monthKey, '2026-09');
    assert.equal(body.resolvedAudience, 'HR');
    assert.equal(body.totals.employees, 1);
    assert.equal(body.rows.length, 1);
    const row = body.rows[0];
    assert.equal(row.employeeName, 'أحمد محمد');
    // No schemes/snapshots configured → explicit NO_SCHEME outcome,
    // null score (never 0), and the fail-safe STABLE status.
    assert.equal(row.kpiScore, null);
    assert.equal(row.status, 'STABLE');
    // Structural exclusion at the HTTP boundary.
    const serialized = JSON.stringify(body);
    for (const technical of [
      'observationIds', 'recordIds', '"collection"', 'evidence',
      'deductionPoints', 'bonusPoints', 'weightedContribution',
      'componentId', 'problemDescription', 'detailedDescription',
    ]) {
      assert.ok(!serialized.includes(technical), `technical field leaked: ${technical}`);
    }
  });

  it('200 drill-down for an in-scope employee; the safety disclaimer is present', async () => {
    const res = await getEmployee('/api/reports/hr-performance/decision/employee?month=2026-09&employeeId=emp_1', testTokens.hr);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.reportKind, 'HR_EMPLOYEE_DECISION');
    assert.equal(body.employee.employeeId, 'emp_1');
    assert.ok(body.action.disclaimerAr.includes('ليست قراراً نهائياً'));
    assert.ok(Array.isArray(body.factors));
    assert.ok(Array.isArray(body.scorecard));
    // Missing data named — never interpreted as poor performance.
    assert.ok(body.dataQuality.notesAr.length > 0);
  });

  it('404 for an unknown employee (fail-closed, out-of-scope is indistinguishable)', async () => {
    const res = await getEmployee('/api/reports/hr-performance/decision/employee?month=2026-09&employeeId=emp_missing', testTokens.hr);
    assert.equal(res.status, 404);
  });
});

// ─────────────────────────────────────────────────────────────
//  Scope narrowing — the canonical guard the route consumes
// ─────────────────────────────────────────────────────────────

describe('decision routes — scope narrowing', () => {
  it('filterEmployeesInScope (the route guard) keeps ONLY authorized ids for a restricted context', () => {
    const restricted: EmployeeScopeContext = {
      scope: 'team',
      pageKey: 'employees',
      source: { basis: 'page_permission', level: 'read', scope: 'team' } as never,
      boundary: { source: 'assignment', nodeIds: [] },
      isUnrestricted: false,
      employeeIds: new Set(['emp_1', 'emp_2']),
      includes: (id: string) => id === 'emp_1' || id === 'emp_2',
    };
    const employees = [
      { id: 'emp_1', name: 'a' },
      { id: 'emp_2', name: 'b' },
      { id: 'emp_3', name: 'c' },
    ] as Array<{ id: string; name: string }>;
    const kept = filterEmployeesInScope(employees, restricted);
    assert.deepEqual(kept.map((e) => e.id).sort(), ['emp_1', 'emp_2']);
  });

  it('filterEmployeesInScope passes everything through for an unrestricted context', () => {
    const unrestricted: EmployeeScopeContext = {
      scope: 'all',
      pageKey: 'employees',
      source: { basis: 'page_permission', level: 'read', scope: 'all' } as never,
      boundary: { source: 'admin', nodeIds: [] },
      isUnrestricted: true,
      employeeIds: new Set<string>(),
      includes: () => true,
    };
    const employees = [{ id: 'x' }, { id: 'y' }] as Array<{ id: string }>;
    assert.equal(filterEmployeesInScope(employees, unrestricted).length, 2);
  });
});
