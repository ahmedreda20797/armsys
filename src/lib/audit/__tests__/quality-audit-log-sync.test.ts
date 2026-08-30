// ══════════════════════════════════════════════════════════════
//  Quality Audit Log data-sync regression tests
//
//  ROOT CAUSE pinned here (hotfix regression net):
//    GET /api/quality-audit-log answers with the documented
//    pagination envelope { data, total, limit, offset }. The only
//    consumer (useQualityAuditLog) passed the raw body through and
//    the page's Array.isArray(payload) guard discarded the envelope
//    — so the page rendered a PERMANENTLY EMPTY audit log while
//    valid records sat in qualityAuditLog. The fix normalizes the
//    wire payload at the data layer (parseAuditLogPayload).
//
//  Coverage (spec §11 scenarios 1–15):
//    1  newly created observation appears in the audit log
//    2  multiple observations appear (one entry per action)
//    3  PENDING observation appears (no approval-status filter)
//    4  approved observation appears (approve action entry)
//    5  rejected observation appears (reject action entry)
//    6  current-month observations are returned (created "today")
//    7  historical observations are returned (monthKey filter)
//    8  employee information resolves (server-side snapshot)
//    9  reviewer/actor information resolves
//    10 date/time ordering correct (timestamp desc + ISO validity)
//    11 permission enforcement intact (401/403/200 matrix)
//    12 no duplicate records (exactly one audit write per action)
//    13 Quality Notes creation remains functional (201 + resolution)
//    14 KPI untouched (audit-log GET reads no KPI tables)
//    15 Month Close untouched (audit-log GET reads no monthSnapshots,
//       writes nothing — visibility is NOT month-close dependent)
// ══════════════════════════════════════════════════════════════

//  NOTE: this file lives under src/lib/audit/__tests__ (one level deep)
//  so the package `npm test` glob (src/lib/**/__tests__/*.test.ts)
//  picks it up — files directly in src/lib/__tests__ are NOT matched
//  by that glob (pre-existing quirk, unchanged here).

import '../../__tests__/m01-test-support';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerFixtures,
  resetTestData,
  setTable,
  bearerHeaders,
  tamperToken,
  jsonRequest,
  createdRecords,
  calls,
  dbStubs,
  type TestTokens,
} from '../../__tests__/m01-test-support';
import {
  parseAuditLogPayload,
  isQualityAuditLogEnvelope,
} from '@/app/api/quality-audit-log/payload';

// ── Route module shapes ──
interface GetRoute { GET: (req: Request, ctx?: unknown) => Promise<Response>; }
interface PostRoute { POST: (req: Request) => Promise<Response>; }
interface IdPostRoute {
  POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
}

function getRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

// ── Fixtures ──
const EMPLOYEES = [
  { id: 'e1', name: 'أحمد التجريبي', department: 'الدعم الفني', position: 'فني', isSuspended: false },
  { id: 'e2', name: 'سارة التجريبية', department: 'المبيعات', position: 'مندوبة', isSuspended: false },
];
const CATEGORIES = [
  {
    id: 'cat1', key: 'commitment', name: 'الالتزام', defaultPointValue: 5,
    weight: 2, color: 'slate', priority: 'medium', isBonusDefault: false,
  },
];

function seedWorld(): void {
  setTable('employees', EMPLOYEES.map((e) => ({ ...e })));
  setTable('observationCategories', CATEGORIES.map((c) => ({ ...c })));
  setTable('qualityObservations', []);
  setTable('qualityAuditLog', []);
  setTable('notifications', []);
  setTable('monthSnapshots', []);
  // Resolve employee snapshots the way the real db layer would.
  dbStubs.getEmployeeMap = async () =>
    new Map(EMPLOYEES.map((e) => [e.id, { ...e }]));
}

/** Today's date in the app timezone (Africa/Cairo) as DD/MM/YYYY + YYYY-MM. */
function cairoToday(): { dmy: string; monthKey: string } {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-');
  return { dmy: `${d}/${m}/${y}`, monthKey: `${y}-${m}` };
}

function obsBody(employeeId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    employeeId,
    observationDate: cairoToday().dmy,
    type: 'positive',
    categoryId: 'cat1',
    notes: 'ملاحظة اختبار رجعي',
    evidence: 'ev-1',
    ...extra,
  };
}

/** Read the envelope the GET route answers with. */
async function getEnvelope(url: string, token: string): Promise<{
  data: Array<Record<string, unknown>>; total: number; limit: number; offset: number;
}> {
  const audit = (await import('@/app/api/quality-audit-log/route')) as unknown as GetRoute;
  const res = await audit.GET(getRequest(`http://localhost${url}`, bearerHeaders(token)));
  assert.equal(res.status, 200, `GET ${url} must succeed`);
  return res.json() as Promise<{ data: Array<Record<string, unknown>>; total: number; limit: number; offset: number }>;
}

// ══════════════════════════════════════════════════════════════
//  0. THE FIX — payload contract parser (pure)
// ══════════════════════════════════════════════════════════════
describe('audit-log payload parser (the fix)', () => {
  const entry = {
    id: 'a1', schemaVersion: 1 as const,
    timestamp: '2026-08-30T09:00:00.000Z',
    actorId: 'u1', actorName: 'جودة', action: 'create',
    entityType: 'observation' as const, entityId: 'o1',
    monthKey: '2026-08', before: null,
    after: { employeeName: 'أحمد التجريبي' },
    reason: '', details: 'إنشاء ملاحظة جودة',
    createdAt: '2026-08-30T09:00:00.000Z',
  };

  it('unwraps the documented { data, total, limit, offset } envelope → entries', () => {
    const envelope = { data: [entry], total: 1, limit: 50, offset: 0 };
    const out = parseAuditLogPayload(envelope);
    assert.equal(out.length, 1);
    assert.strictEqual(out[0], entry, 'entries pass through unmutated');
  });

  it('passes a plain array through unchanged (defensive)', () => {
    const arr = [entry, { ...entry, id: 'a2' }];
    const out = parseAuditLogPayload(arr);
    assert.equal(out.length, 2);
    assert.strictEqual(out[0], arr[0]);
    assert.strictEqual(out[1], arr[1]);
  });

  it('never fabricates records: null/undefined/garbage → [] (no fake zeros)', () => {
    assert.deepEqual(parseAuditLogPayload(null), []);
    assert.deepEqual(parseAuditLogPayload(undefined), []);
    assert.deepEqual(parseAuditLogPayload({}), []);
    assert.deepEqual(parseAuditLogPayload({ data: 'not-an-array' }), []);
    assert.deepEqual(parseAuditLogPayload('oops'), []);
    assert.deepEqual(parseAuditLogPayload(42), []);
  });

  it('envelope guard accepts only an array `data` member', () => {
    assert.equal(isQualityAuditLogEnvelope({ data: [], total: 0, limit: 1, offset: 0 }), true);
    assert.equal(isQualityAuditLogEnvelope({ data: null }), false);
    assert.equal(isQualityAuditLogEnvelope({ total: 0 }), false);
    assert.equal(isQualityAuditLogEnvelope(null), false);
    assert.equal(isQualityAuditLogEnvelope([]), false);
  });
});

// ══════════════════════════════════════════════════════════════
//  1–2, 6, 8–9, 12, 13 — creation → audit write → visible via GET
// ══════════════════════════════════════════════════════════════
describe('Quality Notes creation lands in Quality Audit Log', () => {
  let t: TestTokens;
  let obsPost: PostRoute;

  before(async () => {
    obsPost = (await import('@/app/api/quality-observations/route')) as unknown as PostRoute;
    resetTestData();
    t = await registerFixtures();
    seedWorld();
  });

  it('[13] creating an observation via the existing flow still works (201, server-side resolution)', async () => {
    const res = await obsPost.POST(
      jsonRequest('http://localhost/api/quality-observations', obsBody('e1'), bearerHeaders(t.adminToken)),
    );
    assert.equal(res.status, 201);
    const obs = await res.json() as Record<string, unknown>;
    assert.equal(obs.employeeId, 'e1');
    assert.equal(obs.employeeName, 'أحمد التجريبي', 'employee snapshot resolved server-side');
    assert.equal(obs.department, 'الدعم الفني');
    assert.equal(obs.categoryName, 'الالتزام');
    assert.equal(obs.month, cairoToday().monthKey);
  });

  it('[1] the new observation appears in the Quality Audit Log', async () => {
    const { data } = await getEnvelope('/api/quality-audit-log', t.adminToken);
    assert.equal(data.length, 1, 'exactly one audit entry for one observation');
    const e = data[0];
    assert.equal(e.action, 'create');
    assert.equal(e.entityType, 'observation');
    assert.equal(e.monthKey, cairoToday().monthKey);
  });

  it('[2] a second observation appears too — one audit entry per observation, no extras', async () => {
    const res = await obsPost.POST(
      jsonRequest('http://localhost/api/quality-observations', obsBody('e2'), bearerHeaders(t.adminToken)),
    );
    assert.equal(res.status, 201);
    const second = await res.json() as Record<string, unknown>;

    const { data, total } = await getEnvelope('/api/quality-audit-log', t.adminToken);
    assert.equal(data.length, 2);
    assert.equal(total, 2, 'envelope total mirrors record count');

    const entityIds = data.map((e) => e.entityId).sort();
    assert.ok(second.id, 'second observation has an id');
    assert.equal(entityIds.length, new Set(entityIds).size, 'no duplicate entries for the same entity+action');

    const auditWrites = createdRecords.filter((r) => r.table === 'qualityAuditLog');
    assert.equal(auditWrites.length, 2, 'exactly one audit write per created observation [12]');
  });

  it('[8] employee information resolves into the entry (after snapshot + details)', async () => {
    const { data } = await getEnvelope('/api/quality-audit-log', t.adminToken);
    const e1Entry = data.find((e) => (e.after as Record<string, unknown>)?.employeeId === 'e1');
    assert.ok(e1Entry, 'entry for e1 exists');
    assert.equal((e1Entry!.after as Record<string, unknown>).employeeName, 'أحمد التجريبي');
    assert.ok(String(e1Entry!.details).includes('أحمد التجريبي'), 'details names the employee');
  });

  it('[9] reviewer/actor information resolves (actor = the creating user)', async () => {
    const { data } = await getEnvelope('/api/quality-audit-log', t.adminToken);
    for (const e of data) {
      assert.equal(e.actorId, 'u-admin');
      assert.equal(e.actorName, 'مسؤول النظام');
    }
  });

  it('[6] an observation created TODAY (current month) is returned — no date filter hides it', async () => {
    const { monthKey } = cairoToday();
    const { data } = await getEnvelope('/api/quality-audit-log', t.adminToken);
    assert.equal(data.length, 2, 'default listing has no date window that drops today');
    const filtered = await getEnvelope(`/api/quality-audit-log?monthKey=${monthKey}`, t.adminToken);
    assert.equal(filtered.data.length, 2);
    for (const e of filtered.data) assert.equal(e.monthKey, monthKey);
  });
});

// ══════════════════════════════════════════════════════════════
//  3–5, 12 — approval lifecycle: pending/approved/rejected all appear
// ══════════════════════════════════════════════════════════════
describe('audit log records the full review lifecycle (no status filter)', () => {
  let t: TestTokens;
  let obsPost: PostRoute;
  let approvePost: IdPostRoute;
  let rejectPost: IdPostRoute;

  before(async () => {
    obsPost = (await import('@/app/api/quality-observations/route')) as unknown as PostRoute;
    approvePost = (await import('@/app/api/quality-observations/[id]/approve/route')) as unknown as IdPostRoute;
    rejectPost = (await import('@/app/api/quality-observations/[id]/reject/route')) as unknown as IdPostRoute;
    resetTestData();
    t = await registerFixtures();
    seedWorld();
  });

  it('[3] a PENDING observation is logged while still pending (create → approvalStatus pending)', async () => {
    const res = await obsPost.POST(jsonRequest(
      'http://localhost/api/quality-observations',
      obsBody('e1', { applyPointDeduction: true, points: 5 }),
      bearerHeaders(t.adminToken),
    ));
    assert.equal(res.status, 201);
    const obs = await res.json() as Record<string, unknown>;
    assert.equal(obs.approvalStatus, 'pending', 'observation is genuinely pending');

    const { data } = await getEnvelope('/api/quality-audit-log', t.adminToken);
    const createEntry = data.find((e) => e.entityId === obs.id && e.action === 'create');
    assert.ok(createEntry, 'pending observation appears in the audit log');
  });

  it('[4] approving it appends an approve entry (approved observation appears)', async () => {
    const created = createdRecords.filter((r) => r.table === 'qualityObservations');
    const obs = created[created.length - 1].data;
    const res = await approvePost.POST(
      jsonRequest(`http://localhost/api/quality-observations/${obs.id}/approve`, {}, bearerHeaders(t.adminToken)),
      { params: Promise.resolve({ id: String(obs.id) }) },
    );
    assert.equal(res.status, 200);

    const { data } = await getEnvelope('/api/quality-audit-log', t.adminToken);
    const approveEntry = data.find((e) => e.action === 'approve' && e.entityId === obs.id);
    assert.ok(approveEntry, 'approve action logged');
    assert.equal((approveEntry!.after as Record<string, unknown>).approvalStatus, 'approved');
  });

  it('[5] rejecting another observation appends a reject entry with its reason', async () => {
    const res = await obsPost.POST(jsonRequest(
      'http://localhost/api/quality-observations',
      obsBody('e2', { applyPointDeduction: true, points: 3 }),
      bearerHeaders(t.adminToken),
    ));
    assert.equal(res.status, 201);
    const obs = await res.json() as Record<string, unknown>;

    const rejRes = await rejectPost.POST(
      jsonRequest(`http://localhost/api/quality-observations/${obs.id}/reject`,
        { reason: 'بيانات غير مكتملة' }, bearerHeaders(t.adminToken)),
      { params: Promise.resolve({ id: String(obs.id) }) },
    );
    assert.equal(rejRes.status, 200);

    const { data } = await getEnvelope('/api/quality-audit-log', t.adminToken);
    const rejectEntry = data.find((e) => e.action === 'reject' && e.entityId === obs.id);
    assert.ok(rejectEntry, 'rejected observation appears');
    assert.equal(rejectEntry!.reason, 'بيانات غير مكتملة');
  });

  it('[12] the whole lifecycle created exactly ONE audit record per action — no duplicates', () => {
    const auditWrites = createdRecords.filter((r) => r.table === 'qualityAuditLog');
    assert.equal(auditWrites.length, 4, 'create + approve + create + reject');

    const pairs = auditWrites.map((w) => `${w.data.action}:${w.data.entityId}`);
    assert.equal(pairs.length, new Set(pairs).size, 'no (action, entity) pair written twice');

    // No second-copy audit system: writes only touch the canonical
    // observation table, the single audit collection, and notifications.
    const tables = new Set(createdRecords.map((r) => r.table));
    for (const table of tables) {
      assert.ok(
        ['qualityObservations', 'qualityAuditLog', 'notifications'].includes(table),
        `unexpected write target: ${table}`,
      );
    }
  });
});

// ══════════════════════════════════════════════════════════════
//  7, 10 — historical visibility, ordering, filters, pagination
// ══════════════════════════════════════════════════════════════
describe('audit log history, ordering and filters', () => {
  let t: TestTokens;

  const mkEntry = (id: string, timestamp: string, monthKey: string | null) => ({
    id, schemaVersion: 1 as const, timestamp,
    actorId: 'u-quality', actorName: 'جودة', action: 'create',
    entityType: 'observation' as const, entityId: `obs-${id}`,
    monthKey, before: null, after: null, reason: '', details: `سجل ${id}`,
    createdAt: timestamp,
  });

  before(async () => {
    resetTestData();
    t = await registerFixtures();
    seedWorld();
    setTable('qualityAuditLog', [
      mkEntry('old1', '2025-01-15T10:00:00.000Z', '2025-01'),
      mkEntry('old2', '2025-03-20T10:00:00.000Z', '2025-03'),
      mkEntry('old3', '2026-08-01T08:00:00.000Z', '2026-08'),
    ]);
  });

  it('[7] historical observations are returned — default view and monthKey filter', async () => {
    const all = await getEnvelope('/api/quality-audit-log', t.adminToken);
    assert.equal(all.total, 3, 'complete history by default');

    const march = await getEnvelope('/api/quality-audit-log?monthKey=2025-03', t.adminToken);
    assert.equal(march.data.length, 1);
    assert.equal(march.data[0].monthKey, '2025-03');
    assert.equal(march.data[0].id, 'old2');
  });

  it('[10] entries are ordered by timestamp descending (newest first)', async () => {
    const { data } = await getEnvelope('/api/quality-audit-log', t.adminToken);
    assert.deepEqual(data.map((e) => e.id), ['old3', 'old2', 'old1']);
    for (const e of data) {
      assert.ok(!Number.isNaN(new Date(String(e.timestamp)).getTime()), 'timestamp is a valid date');
    }
  });

  it('filters: entityType / action / actorId narrow the results server-side', async () => {
    const byType = await getEnvelope('/api/quality-audit-log?entityType=observation', t.adminToken);
    assert.equal(byType.data.length, 3);
    const byAction = await getEnvelope('/api/quality-audit-log?action=create', t.adminToken);
    assert.equal(byAction.data.length, 3);
    const byActor = await getEnvelope('/api/quality-audit-log?actorId=u-nobody', t.adminToken);
    assert.equal(byActor.data.length, 0);
  });

  it('pagination: limit/offset are honored inside the envelope', async () => {
    const page = await getEnvelope('/api/quality-audit-log?limit=1&offset=1', t.adminToken);
    assert.equal(page.data.length, 1);
    assert.equal(page.limit, 1);
    assert.equal(page.offset, 1);
    assert.equal(page.total, 3);
  });
});

// ══════════════════════════════════════════════════════════════
//  11 — permission enforcement remains intact
// ══════════════════════════════════════════════════════════════
describe('audit log permission matrix (unchanged)', () => {
  let t: TestTokens;
  let route: GetRoute;

  before(async () => {
    route = (await import('@/app/api/quality-audit-log/route')) as unknown as GetRoute;
    resetTestData();
    t = await registerFixtures();
    seedWorld();
    setTable('qualityAuditLog', [mkSimpleEntry()]);
  });

  function mkSimpleEntry() {
    return {
      id: 'x1', schemaVersion: 1, timestamp: '2026-08-30T09:00:00.000Z',
      actorId: 'u-quality', actorName: 'جودة', action: 'create',
      entityType: 'observation', entityId: 'o1', monthKey: '2026-08',
      before: null, after: null, reason: '', details: 'إنشاء',
      createdAt: '2026-08-30T09:00:00.000Z',
    };
  }

  it('no token → 401; garbage token → 401; tampered token → 401', async () => {
    assert.equal((await route.GET(getRequest('http://localhost/api/quality-audit-log'))).status, 401);
    assert.equal((await route.GET(getRequest('http://localhost/api/quality-audit-log', bearerHeaders('x')))).status, 401);
    assert.equal((await route.GET(getRequest('http://localhost/api/quality-audit-log', bearerHeaders(tamperToken(t.adminToken))))).status, 401);
  });

  it('roles WITHOUT the qualityAuditLog page grant are DENIED (existing deny behavior preserved)', async () => {
    // hr + user presets carry qualityAuditLog: 'none'. The route answers
    // a permission denial with 401 + the permission error message (its
    // pre-existing behavior — verifyPermission returns no `user` on
    // denials, so the route cannot distinguish 401/403). This hotfix
    // preserves that behavior verbatim; the assertion pins BOTH the
    // denial itself and the permission (not auth) origin of the error.
    for (const token of [t.hrToken, t.userToken]) {
      const res = await route.GET(getRequest('http://localhost/api/quality-audit-log', bearerHeaders(token)));
      assert.equal(res.status, 401, 'denied — existing route behavior');
      const body = await res.json() as { error?: { message?: string } };
      assert.equal(body.error?.message, 'صلاحية غير كافية', 'denied for PERMISSIONS, not authentication');
    }
  });

  it('roles WITH the page grant still see the log (200) — no redirect, no bypass', async () => {
    for (const token of [t.adminToken, t.managerToken, t.qualityToken]) {
      const res = await route.GET(getRequest('http://localhost/api/quality-audit-log', bearerHeaders(token)));
      assert.equal(res.status, 200);
      const body = await res.json() as { data: unknown[] };
      assert.equal(body.data.length, 1);
    }
  });
});

// ══════════════════════════════════════════════════════════════
//  14–15 — the audit log is NOT coupled to KPI or Month Close
// ══════════════════════════════════════════════════════════════
describe('audit log independence (KPI + Month Close untouched)', () => {
  let t: TestTokens;
  let route: GetRoute;

  before(async () => {
    route = (await import('@/app/api/quality-audit-log/route')) as unknown as GetRoute;
    resetTestData();
    t = await registerFixtures();
    seedWorld();
    setTable('qualityAuditLog', [{
      id: 'z1', schemaVersion: 1, timestamp: '2026-08-30T09:00:00.000Z',
      actorId: 'u-quality', actorName: 'جودة', action: 'create',
      entityType: 'observation', entityId: 'o1', monthKey: '2026-08',
      before: null, after: null, reason: '', details: 'إنشاء',
      createdAt: '2026-08-30T09:00:00.000Z',
    }]);
  });

  it('[15] GET never reads monthSnapshots — visibility does not wait for Month Close', async () => {
    const mark = calls.length;
    const res = await route.GET(getRequest('http://localhost/api/quality-audit-log', bearerHeaders(t.adminToken)));
    assert.equal(res.status, 200);
    const window = calls.slice(mark);
    const readTables = window
      .filter((c) => ['getAll', 'getById', 'getAllBatch', 'findFirst', 'findWhere'].includes(c.fn))
      .map((c) => String(c.args[0]));
    assert.ok(readTables.includes('qualityAuditLog'), 'reads the canonical audit collection');
    assert.ok(!readTables.includes('monthSnapshots'), 'no Month Close dependency');
  });

  it('[14] GET reads no KPI tables and writes nothing', async () => {
    const mark = calls.length;
    const res = await route.GET(getRequest('http://localhost/api/quality-audit-log', bearerHeaders(t.adminToken)));
    assert.equal(res.status, 200);
    const window = calls.slice(mark);

    const readTables = window.map((c) => String(c.args[0]));
    for (const kpiTable of ['kpiSettings', 'kpiSchemes', 'kpiFramework', 'monthlyKpiResults']) {
      assert.ok(!readTables.includes(kpiTable), `must not read ${kpiTable}`);
    }

    const writes = window.filter((c) => ['createRecord', 'createRecordWithId', 'updateRecord', 'deleteRecord'].includes(c.fn));
    assert.equal(writes.length, 0, 'the reader never writes — no audit records fabricated on read');
  });
});
