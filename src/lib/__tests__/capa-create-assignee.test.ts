// ══════════════════════════════════════════════════════════════
//  CAPA create — assignedToName undefined regression
//
//  POST /api/capa-cases used to resolve assignedToName from the
//  EMPLOYEE map while every CAPA UI sends assignedTo as a USER id
//  (UserSearchInput over /api/dashboard/users). empMap.get(<userId>)
//  → undefined reached createRecord and Firebase's .set() rejected
//  the whole write:
//    "value argument contains undefined in property
//     'arm_erp.capaCases.<id>.assignedToName'"
//
//  These tests pin the fixed contract at the domain boundary:
//    - user ids resolve from the users table (canonical source)
//    - legacy employee ids still resolve from the employee map
//    - unknown ids store null — never a fabricated name
//    - NO property of the createRecord payload is ever undefined
//    - auth / permission / employee-scope gates are unchanged
//    - failed validation writes nothing (no partial records)
// ══════════════════════════════════════════════════════════════

import './m01-test-support';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerFixtures,
  registerUser,
  mintToken,
  resetTestData,
  setTable,
  bearerHeaders,
  dbStubs,
  createdRecords,
} from './m01-test-support';

// Employee-map stub backed by the seeded employees table (same patch
// as m04) so the legacy employee-id fallback is exercisable.
dbStubs.getEmployeeMap = async () => {
  const employees = await dbStubs.getAll('employees');
  return new Map(employees.map((e: Record<string, any>) => [
    e.id,
    { id: e.id, name: e.name, department: e.department || null, position: e.position || null, shiftStart: e.shiftStart || null },
  ]));
};

interface PostRoute {
  POST: (req: Request) => Promise<Response>;
}

function postCapa(body: unknown, token?: string): Promise<Response> {
  return route.POST(
    new Request('http://localhost/api/capa-cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? bearerHeaders(token) : {}) },
      body: JSON.stringify(body),
    })
  );
}

/** Fail on ANY undefined value anywhere inside a value (Firebase .set() rejects it). */
function assertNoUndefined(value: unknown, path = 'record'): void {
  assert.notEqual(value, undefined, `undefined at ${path}`);
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoUndefined(v, `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertNoUndefined(v, `${path}.${k}`);
  }
}

function capaWrites(): Array<{ table: string; data: Record<string, any> }> {
  return createdRecords.filter((r) => r.table === 'capaCases');
}

function lastCapa(): Record<string, any> {
  const writes = capaWrites();
  assert.ok(writes.length > 0, 'expected a capaCases record to be written');
  return writes[writes.length - 1].data;
}

interface Tokens {
  hrToken: string;
  writerTeamToken: string;
  writerNoscopeToken: string;
}

/**
 * Fresh world per test — resetTestData() also clears registered
 * users, so every fixture (users + tokens) must be rebuilt after it
 * (same rule m01/m04 tests follow).
 */
async function freshWorld(): Promise<Tokens> {
  resetTestData();
  const base = await registerFixtures(); // admin/user/hr/manager/quality + tokens
  registerUser({ id: 'u-assignee', email: 'assignee@test.local', name: 'سارة المسؤولة', role: 'user' });

  const capaWrite = {
    level: 'edit',
    actions: { create: true, update: true, delete: true },
  };
  // Team-scoped writer: employees scope 'team' anchored at empA1 → {empA1}.
  registerUser({
    id: 'u-writer-team', email: 'wteam@test.local', name: 'كاتب فريق', role: 'user',
    linkedEmployeeId: 'empA1',
    permissions: {
      capa: capaWrite,
      employees: { level: 'edit', actions: { create: true, update: true, delete: true }, scope: 'team' },
    },
  });
  // Same capa grant, NO employees scope, no linkage → fail-closed set.
  registerUser({
    id: 'u-writer-noscope', email: 'wnoscope@test.local', name: 'كاتب بلا نطاق', role: 'user',
    permissions: { capa: capaWrite },
  });

  const [writerTeam, writerNoscope] = await Promise.all([
    mintToken({ userId: 'u-writer-team', email: 'wteam@test.local', role: 'user' }),
    mintToken({ userId: 'u-writer-noscope', email: 'wnoscope@test.local', role: 'user' }),
  ]);
  return { hrToken: base.hrToken, writerTeamToken: writerTeam, writerNoscopeToken: writerNoscope };
}

function seedWorld(): void {
  setTable('orgNodes', [
    { id: 'company', name: 'company', type: 'team', parentId: null, managerUserId: null },
    { id: 'teamA', name: 'teamA', type: 'team', parentId: 'company', managerUserId: null },
  ]);
  setTable('employees', [
    { id: 'empA1', code: 'A1', name: 'موظف أ1', department: 'المبيعات', orgNodeId: 'teamA' },
  ]);
  setTable('capaCases', []);
  setTable('users', []);
}

let route: PostRoute;

before(async () => {
  route = (await import('@/app/api/capa-cases/route')) as unknown as PostRoute;
});

describe('CAPA create — assignedToName regression (was: undefined → Firebase set() failure)', () => {
  it('no Authorization header → denied (403 via verifyPermission) and nothing written', async () => {
    await freshWorld();
    seedWorld();
    const res = await postCapa({ title: 'حالة', assignedTo: 'u-assignee' });
    assert.equal(res.status, 403); // existing gate: POST uses verifyPermission, not a bare requireAuth
    assert.equal(capaWrites().length, 0);
  });

  it("authenticated 'hr' role (capa none) → 403 and nothing written", async () => {
    const t = await freshWorld();
    seedWorld();
    const res = await postCapa({ title: 'حالة', assignedTo: 'u-assignee' }, t.hrToken);
    assert.equal(res.status, 403);
    assert.equal(capaWrites().length, 0);
  });

  it('valid USER assignedTo → 201, name resolved from users table, no undefined in payload', async () => {
    const t = await freshWorld();
    seedWorld();
    const res = await postCapa({
      title: 'حالة كابا جديدة',
      department: 'الجودة',
      priority: 'high',
      assignedTo: 'u-assignee',
      correctiveAssignedTo: 'u-assignee',
      createdBy: 'attacker', // M0.2.1: actor identity must come from the token
      createdByName: 'مهاجم',
    }, t.writerTeamToken);
    assert.equal(res.status, 201);
    const rec = lastCapa();
    assert.equal(rec.assignedTo, 'u-assignee');
    assert.equal(rec.assignedToName, 'سارة المسؤولة');
    assert.equal(rec.correctiveAssignedToName, 'سارة المسؤولة');
    assert.equal(rec.createdBy, 'u-writer-team'); // token actor, not body
    assertNoUndefined(rec);
  });

  it('assignment omitted → 201 (optional at API level), assignedToName null, no undefined', async () => {
    const t = await freshWorld();
    seedWorld();
    const res = await postCapa({ title: 'حالة بلا مسؤول', department: 'الجودة' }, t.writerTeamToken);
    assert.equal(res.status, 201);
    const rec = lastCapa();
    assert.equal(rec.assignedTo, '');
    assert.equal(rec.assignedToName, null);
    assertNoUndefined(rec);
  });

  it('legacy EMPLOYEE-id assignedTo → 201, name resolved from employee map fallback', async () => {
    const t = await freshWorld();
    seedWorld();
    const res = await postCapa({
      title: 'حالة بمسؤول موظف',
      assignedTo: 'empA1',
      preventiveAssignedTo: 'empA1',
    }, t.writerTeamToken);
    assert.equal(res.status, 201);
    const rec = lastCapa();
    assert.equal(rec.assignedToName, 'موظف أ1');
    assert.equal(rec.preventiveAssignedToName, 'موظف أ1');
    assertNoUndefined(rec);
  });

  it('unknown assignedTo id → 201 with assignedToName null (no fabrication, no crash)', async () => {
    const t = await freshWorld();
    seedWorld();
    const res = await postCapa({ title: 'حالة بمسؤول مجهول', assignedTo: 'no-such-id' }, t.writerTeamToken);
    assert.equal(res.status, 201);
    const rec = lastCapa();
    assert.equal(rec.assignedTo, 'no-such-id');
    assert.equal(rec.assignedToName, null);
    assertNoUndefined(rec);
  });

  it('employeeId valid (direct read) but missing from stale employee-map cache → employeeName null, no undefined', async () => {
    const t = await freshWorld();
    seedWorld();
    const realMap = dbStubs.getEmployeeMap;
    dbStubs.getEmployeeMap = async () => new Map(); // stale/empty cache snapshot
    try {
      const res = await postCapa({ title: 'حالة بموظف جديد', employeeId: 'empA1' }, t.writerTeamToken);
      assert.equal(res.status, 201);
      const rec = lastCapa();
      assert.equal(rec.employeeId, 'empA1');
      assert.equal(rec.employeeName, null);
      assertNoUndefined(rec);
    } finally {
      dbStubs.getEmployeeMap = realMap;
    }
  });

  it('out-of-scope employeeId → 403 (M0.4 scope authoritative) and nothing written', async () => {
    const t = await freshWorld();
    seedWorld();
    setTable('employees', [
      { id: 'empA1', code: 'A1', name: 'موظف أ1', department: 'المبيعات', orgNodeId: 'teamA' },
      { id: 'empB1', code: 'B1', name: 'موظف ب1', department: 'المبيعات', orgNodeId: null },
    ]);
    const denied = await postCapa({ title: 'حالة خارج النطاق', employeeId: 'empB1' }, t.writerTeamToken);
    assert.equal(denied.status, 403);
    assert.equal(capaWrites().length, 0);

    // Fail-closed writer (no employees scope): even empA1 is denied.
    const failClosed = await postCapa({ title: 'حالة للكاتب بلا نطاق', employeeId: 'empA1' }, t.writerNoscopeToken);
    assert.equal(failClosed.status, 403);
    assert.equal(capaWrites().length, 0);

    // In-scope target still succeeds.
    const ok = await postCapa({ title: 'حالة داخل النطاق', employeeId: 'empA1' }, t.writerTeamToken);
    assert.equal(ok.status, 201);
    assert.equal(lastCapa().employeeId, 'empA1');
  });

  it('missing title → 400 validation error and nothing written', async () => {
    const t = await freshWorld();
    seedWorld();
    const res = await postCapa({ department: 'الجودة', assignedTo: 'u-assignee' }, t.writerTeamToken);
    assert.equal(res.status, 400);
    assert.equal(capaWrites().length, 0);
  });
});
