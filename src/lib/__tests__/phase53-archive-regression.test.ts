// ══════════════════════════════════════════════════════════════
//  Phase 5.3 — Employee ARCHIVE regression tests (spec §16-§21)
//
//  ROUTE-LEVEL regression for the archive/restore lifecycle:
//  the archive action used to "execute" while the employee silently
//  stayed active — the route's lifecycle branch was dead code
//  because the request sanitizer stripped `status` BEFORE the
//  transition detector ran. These tests exercise the REAL route
//  handler (in-memory db stubs) plus the eligibility layers that
//  consume the stored status.
//
//  Scenarios (spec §21 1-12):
//    1. active employee can be archived          7. archived excluded from current reporting
//    2. employee status actually changes         8. archived employee appears in archive
//    3. archive lifecycle event is recorded      9. restore works
//    4. employee record remains                 10. restore preserves employee ID
//    5. historical records remain               11. restore does not duplicate
//    6. historical KPI remains                  12. restored employee eligible for future periods
// ══════════════════════════════════════════════════════════════

import './m01-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetTestData, registerFixtures, setTable, createdRecords, calls, bearerHeaders, dbStubs } from './m01-test-support';

interface IdRoute {
  PUT?: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
}

function idRequest(url: string, method: string, body: unknown, token?: string): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? bearerHeaders(token) : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
}
const p = (id: string) => ({ params: Promise.resolve({ id }) });

const EMP_ID = 'emp-arc-1';
const BASE = 'http://localhost/api/employees';

async function seedWorld(adminToken: string): Promise<void> {
  resetTestData();
  const { registerUser } = await import('./m01-test-support');
  const { adminToken: token } = await registerFixtures();
  void adminToken;
  void registerUser;
  setTable('users', []);
  // Seed the employee (active, hired 2024) + linked historical records.
  setTable('employees', [
    {
      id: EMP_ID,
      code: 'EMP-100',
      name: 'موظف الأرشفة',
      department: 'العمليات',
      position: 'موظف',
      status: 'active',
      hireDate: '01/01/2024',
      createdAt: '2024-01-01T00:00:00.000Z',
      orgNodeId: 'node-a',
    },
  ]);
  setTable('employmentEvents', []);
  setTable('qualityObservations', [
    {
      id: 'obs-hist-1', employeeId: EMP_ID, employeeName: 'موظف الأرشفة',
      month: '2026-05', applyPointDeduction: true, points: 5, approvalStatus: 'approved',
    },
  ]);
  setTable('qualityDeductions', [
    { id: 'qd-hist-1', employeeId: EMP_ID, date: '05/05/2026', days: 1, amount: 100 },
  ]);
  setTable('monthSnapshots', [
    { id: 'snap-2026-05', monthKey: '2026-05', status: 'closed' },
  ]);
  setTable('kpiMonthlyResults', [
    {
      id: 'kpi-2026-05', month: '2026-05', employeeId: EMP_ID,
      rowStatus: 'VALUE', overallStatus: 'FINAL',
      quality: { componentId: 'quality', rawScore: 88.5, weight: 15 },
    },
  ]);
  void token;
}

async function loadRoute(): Promise<{ route: IdRoute; adminToken: string }> {
  const route = (await import('@/app/api/employees/[id]/route')) as unknown as IdRoute;
  const t = await registerFixtures();
  return { route, adminToken: t.adminToken };
}

function employmentLedger(): Array<Record<string, unknown>> {
  return createdRecords
    .filter((r) => r.table === 'employmentEvents')
    .map((r) => r.data);
}

describe('Phase 5.3 — employee archive regression (route level, spec §16-§21)', () => {
  let route: IdRoute;
  let adminToken: string;

  before(async () => {
    const loaded = await loadRoute();
    route = loaded.route;
    adminToken = loaded.adminToken;
  });

  beforeEach(async () => {
    await seedWorld(adminToken);
  });

  it('[1] an active employee can be archived (PUT 200 with the full record)', async () => {
    const res = await route.PUT!(
      idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'archived', archiveReason: 'نهاية الخدمة' }, adminToken),
      p(EMP_ID),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, EMP_ID);
  });

  it('[2] the status ACTUALLY changes to archived (persisted, not just echoed)', async () => {
    const res = await route.PUT!(
      idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'archived' }, adminToken),
      p(EMP_ID),
    );
    assert.equal(res.status, 200);
    const stored = await dbStubs.getById('employees', EMP_ID);
    assert.equal(stored.status, 'archived');
    // Server-derived metadata written by the server, never the client.
    assert.equal(typeof stored.archivedAt, 'string');
    assert.equal(stored.archivedBy, 'u-admin');
    assert.equal(stored.previousStatus, 'active');
  });

  it('[3] an archived employment event is recorded in the ledger', async () => {
    const res = await route.PUT!(
      idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'archived' }, adminToken),
      p(EMP_ID),
    );
    assert.equal(res.status, 200);
    const ledger = employmentLedger();
    const archived = ledger.filter((e) => e.kind === 'archived');
    assert.equal(archived.length, 1);
    assert.equal(archived[0].employeeId, EMP_ID);
    assert.equal(typeof archived[0].effectiveAt, 'string');
    assert.equal(archived[0].actorUserId, 'u-admin');
  });

  it('[4] the employee record REMAINS (archive is not deletion)', async () => {
    await route.PUT!(idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'archived' }, adminToken), p(EMP_ID));
    const stored = await dbStubs.getById('employees', EMP_ID);
    assert.ok(stored, 'employee record must still exist');
    assert.equal(stored.id, EMP_ID);
    assert.equal(stored.name, 'موظف الأرشفة');
    // No delete calls hit the employees table.
    assert.equal(
      calls.some((c) => c.fn === 'deleteRecord' && c.args[0] === 'employees' && c.args[1] === EMP_ID),
      false,
    );
  });

  it('[5] historical records remain untouched after archiving', async () => {
    await route.PUT!(idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'archived' }, adminToken), p(EMP_ID));
    const obs = await dbStubs.getById('qualityObservations', 'obs-hist-1');
    const ded = await dbStubs.getById('qualityDeductions', 'qd-hist-1');
    assert.ok(obs, 'quality observation must remain');
    assert.ok(ded, 'quality deduction must remain');
    assert.equal(obs.employeeId, EMP_ID);
  });

  it('[6] historical KPI results remain untouched after archiving', async () => {
    await route.PUT!(idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'archived' }, adminToken), p(EMP_ID));
    const kpi = await dbStubs.getById('kpiMonthlyResults', 'kpi-2026-05');
    assert.ok(kpi, 'KPI monthly result must remain');
    assert.equal(kpi.quality.rawScore, 88.5);
    assert.equal(kpi.employeeId, EMP_ID);
  });

  it('[7] the archived employee is EXCLUDED from current active reporting', async () => {
    const { isCurrentEmployee, filterCurrentEmployees } = await import('@/lib/organization');
    const res = await route.PUT!(
      idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'archived' }, adminToken),
      p(EMP_ID),
    );
    const stored = await res.json();
    assert.equal(isCurrentEmployee(stored), false);
    const population = filterCurrentEmployees([stored]);
    assert.equal(population.length, 0);

    // KPI eligibility: the archive date lands in the CURRENT month, so
    // the current period remains valid through the archive-effective
    // date (spec §18/§22 — mid-month archive is NOT zeroed out), but
    // the NEXT (post-archive) period must exclude the employee.
    const { isEmployeeEligibleForPeriod } = await import('@/lib/kpi-framework/employee-result');
    const ledger = employmentLedger();
    const now = new Date();
    const futureMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    ).toISOString().slice(0, 7);
    assert.equal(
      isEmployeeEligibleForPeriod(stored as never, ledger as never, futureMonth),
      false,
    );
  });

  it('[8] the archived employee still appears in the archive (GET list keeps the record)', async () => {
    const listRoute = (await import('@/app/api/employees/route')) as unknown as {
      GET: (req: Request) => Promise<Response>;
    };
    await route.PUT!(idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'archived' }, adminToken), p(EMP_ID));
    const res = await listRoute.GET!(
      new Request(`${BASE}/`, { headers: bearerHeaders(adminToken) }),
    );
    assert.equal(res.status, 200);
    const rows = (await res.json()) as Array<{ id: string; status?: string }>;
    const archived = rows.find((r) => r.id === EMP_ID);
    assert.ok(archived, 'archived employee must remain discoverable');
    assert.equal(archived.status, 'archived');
  });

  it('[9] restore works: archived → active via the same route', async () => {
    await route.PUT!(idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'archived' }, adminToken), p(EMP_ID));
    const res = await route.PUT!(
      idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'active' }, adminToken),
      p(EMP_ID),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'active');
    assert.equal(typeof body.restoredAt, 'string');
    assert.equal(body.restoredBy, 'u-admin');
    // archived-period metadata is NOT wiped by a restore (§20 history).
    assert.equal(typeof body.archivedAt, 'string');
  });

  it('[10] restore preserves the SAME employee identity (id + code + history)', async () => {
    await route.PUT!(idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'archived' }, adminToken), p(EMP_ID));
    const res = await route.PUT!(
      idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'active' }, adminToken),
      p(EMP_ID),
    );
    const body = await res.json();
    assert.equal(body.id, EMP_ID);
    assert.equal(body.code, 'EMP-100');
    assert.equal(body.hireDate, '01/01/2024');
  });

  it('[11] restore does NOT duplicate the employee record', async () => {
    await route.PUT!(idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'archived' }, adminToken), p(EMP_ID));
    await route.PUT!(idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'active' }, adminToken), p(EMP_ID));
    const rows = await dbStubs.getAll('employees');
    const matches = rows.filter((r: Record<string, unknown>) => r.id === EMP_ID);
    assert.equal(matches.length, 1);
    // And a restored ledger event was appended (no second employee).
    const ledger = employmentLedger();
    assert.equal(ledger.filter((e) => e.kind === 'restored').length, 1);
    assert.equal(ledger.filter((e) => e.kind === 'archived').length, 1);
  });

  it('[12] the restored employee is eligible for future reporting periods', async () => {
    await route.PUT!(idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'archived' }, adminToken), p(EMP_ID));
    const res = await route.PUT!(
      idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'active' }, adminToken),
      p(EMP_ID),
    );
    const stored = await res.json();
    const { isEmployeeEligibleForPeriod } = await import('@/lib/kpi-framework/employee-result');
    const { isCurrentEmployee } = await import('@/lib/organization');
    assert.equal(isCurrentEmployee(stored), true);
    const ledger = employmentLedger();
    const futureMonth = (() => {
      const now = new Date();
      const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      return next.toISOString().slice(0, 7);
    })();
    assert.equal(
      isEmployeeEligibleForPeriod(stored as never, ledger as never, futureMonth),
      true,
    );
  });

  // ── Guard rails around the regression fix ─────────────────────

  it('invalid status value is rejected with 400 (no transition possible)', async () => {
    const res = await route.PUT!(
      idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'hacker-status' }, adminToken),
      p(EMP_ID),
    );
    assert.equal(res.status, 400);
    const stored = await dbStubs.getById('employees', EMP_ID);
    assert.equal(stored.status, 'active');
  });

  it('client-supplied lifecycle METADATA is still stripped (anti-spoofing preserved)', async () => {
    const res = await route.PUT!(
      idRequest(
        `${BASE}/${EMP_ID}`,
        'PUT',
        { status: 'archived', archivedAt: '1999-01-01T00:00:00.000Z', archivedBy: 'spoof', previousStatus: 'inactive' },
        adminToken,
      ),
      p(EMP_ID),
    );
    assert.equal(res.status, 200);
    const stored = await dbStubs.getById('employees', EMP_ID);
    assert.equal(stored.status, 'archived');
    assert.notEqual(stored.archivedAt, '1999-01-01T00:00:00.000Z');
    assert.equal(stored.archivedBy, 'u-admin');
    assert.equal(stored.previousStatus, 'active');
  });

  it('a same-value status stays a plain edit (no duplicate lifecycle events)', async () => {
    const res = await route.PUT!(
      idRequest(`${BASE}/${EMP_ID}`, 'PUT', { status: 'active', name: 'اسم جديد' }, adminToken),
      p(EMP_ID),
    );
    assert.equal(res.status, 200);
    const ledger = employmentLedger();
    assert.equal(ledger.length, 0);
    const stored = await dbStubs.getById('employees', EMP_ID);
    assert.equal(stored.status, 'active');
    assert.equal(stored.name, 'اسم جديد');
  });
});
