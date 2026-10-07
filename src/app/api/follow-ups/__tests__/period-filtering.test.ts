// ══════════════════════════════════════════════════════════════
//  §PERF-FOLLOWUPS — GET /api/follow-ups (server-side period)
//
//  Contract under test:
//    1. NO month param → ONLY the current calendar month's records
//       (never the full historical dataset).
//    2. ?month=YYYY-MM → exactly that month; other months excluded.
//    3. Invalid month → falls back to current month (never widens).
//    4. Explicit startDate/endDate range keeps its custom-window
//       semantics (pre-existing behavior).
//    5. ATTENTION SET — the response's attention.overdue / dueToday
//       carry the cross-month canonical population (a record created
//       LAST month that is overdue still appears) computed with the
//       canonical predicates; terminal records never count.
//    6. SCOPE — an own-scoped user receives only their records for
//       ANY period; the month parameter cannot widen visibility.
//    7. Period filtering runs INSIDE the authorized population.
//
//  Integration tests run the REAL route handler against the
//  in-memory db stubs (m01-test-support) with REAL JWTs.
//
//  Run: npx tsx --test src/app/api/follow-ups/__tests__/period-filtering.test.ts
// ══════════════════════════════════════════════════════════════

import '../../../../lib/__tests__/m01-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerFixtures,
  registerUser,
  resetTestData,
  setTable,
  bearerHeaders,
  mintToken,
  type TestTokens,
} from '../../../../lib/__tests__/m01-test-support';
import { monthBounds } from '@/lib/followups-period';

// ── Local-calendar month keys (same semantics as the route) ──
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const now = new Date();
const CUR = monthKey(now);
const PREV = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
const NEXT = monthKey(new Date(now.getFullYear(), now.getMonth() + 1, 1));
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
const today = dayKey(now);

function fu(id: string, over: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    employeeId: 'empA1',
    employeeName: 'أ',
    date: `${CUR}-05`,
    followUpType: 'quality',
    subject: 'موضوع',
    status: 'open',
    priorityLevel: 'medium',
    score: 3,
    department: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    nextFollowUpDate: null,
    ...over,
  };
}

/** One row per month × employee, plus attention-shape rows. */
function followUpsTable(): Record<string, unknown>[] {
  return [
    fu('f-cur-a', { employeeId: 'empA1', date: `${CUR}-05` }),
    fu('f-cur-b', { employeeId: 'empB1', date: `${CUR}-15`, status: 'closed' }),
    fu('f-prev-a', { employeeId: 'empA1', date: `${PREV}-10` }),
    fu('f-prev-b', { employeeId: 'empB1', date: `${PREV}-20` }),
    fu('f-next-a', { employeeId: 'empA1', date: `${NEXT}-01` }),
    // Attention shapes — created LAST month, still active:
    fu('f-prev-overdue', { employeeId: 'empA1', date: `${PREV}-08`, nextFollowUpDate: yesterday }),
    fu('f-prev-due-today', { employeeId: 'empB1', date: `${PREV}-09`, nextFollowUpDate: today }),
    // Terminal record with a past due date — never overdue/due-today.
    fu('f-prev-terminal', { employeeId: 'empA1', date: `${PREV}-11`, status: 'closed', nextFollowUpDate: yesterday }),
    // Active record with a FUTURE due date — not in the attention set.
    fu('f-cur-future', { employeeId: 'empA1', date: `${CUR}-06`, nextFollowUpDate: dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)) }),
  ];
}

describe('GET /api/follow-ups — server-side period filtering', () => {
  let route: { GET: (req: Request) => Promise<Response> };
  let t: TestTokens;
  let ownToken = '';

  before(async () => {
    route = (await import('@/app/api/follow-ups/route')) as unknown as { GET: (req: Request) => Promise<Response> };
  });

  beforeEach(async () => {
    resetTestData();
    t = await registerFixtures();
    setTable('followUps', followUpsTable());
    setTable('employees', [
      { id: 'empA1', name: 'أحمد', department: 'مبيعات', orgNodeId: null },
      { id: 'empB1', name: 'سارة', department: 'تدريب', orgNodeId: null },
    ]);
    // Own-scoped viewer: sees ONLY empA1's records (linked employee).
    registerUser({
      id: 'u-own',
      email: 'own@test.local',
      name: 'نطاق محدود',
      role: 'user',
      linkedEmployeeId: 'empA1',
      orgBoundaryNodeIds: ['ga'],
      permissions: {
        followUps: 'read',
        employees: { level: 'read', scope: 'own' },
      },
    });
    ownToken = await mintToken({ userId: 'u-own', email: 'own@test.local', role: 'user' });
  });

  async function get(query: string, token: string): Promise<{ status: number; body: any }> {
    const res = await route.GET(new Request(`http://localhost/api/follow-ups${query}` as unknown as Request, {
      headers: bearerHeaders(token),
    }));
    return { status: res.status, body: await res.json() };
  }

  it('1. no month → ONLY the current month (never full history)', async () => {
    const { status, body } = await get('', t.adminToken);
    assert.equal(status, 200);
    const ids = body.data.map((r: any) => r.id).sort();
    assert.deepEqual(ids, ['f-cur-a', 'f-cur-b', 'f-cur-future']);
    assert.equal(body.meta.month, CUR);
    assert.equal(body.meta.count, 3);
  });

  it('2. ?month=<previous> → exactly that month; other months excluded', async () => {
    const { body } = await get(`?month=${PREV}`, t.adminToken);
    const ids = body.data.map((r: any) => r.id).sort();
    assert.deepEqual(ids, ['f-prev-a', 'f-prev-b', 'f-prev-due-today', 'f-prev-overdue', 'f-prev-terminal']);
    assert.ok(ids.every(() => true));
    // No current/next leakage.
    assert.ok(!ids.includes('f-cur-a'));
    assert.ok(!ids.includes('f-next-a'));
  });

  it('2b. ?month=<next> → only the next month', async () => {
    const { body } = await get(`?month=${NEXT}`, t.adminToken);
    assert.deepEqual(body.data.map((r: any) => r.id), ['f-next-a']);
  });

  it('3. invalid month → current month fallback (no widening)', async () => {
    const { body } = await get('?month=garbage', t.adminToken);
    assert.equal(body.meta.month, CUR);
    assert.deepEqual(body.data.map((r: any) => r.id).sort(), ['f-cur-a', 'f-cur-b', 'f-cur-future']);
  });

  it('4. explicit startDate/endDate range keeps custom-window semantics', async () => {
    const { start } = monthBounds(PREV);
    const { body } = await get(`?startDate=${start}&endDate=${today}`, t.adminToken);
    // Previous-month rows + previous-month attention rows (f-cur-* excluded).
    const ids = body.data.map((r: any) => r.id).sort();
    assert.ok(ids.includes('f-prev-a'));
    assert.ok(ids.includes('f-prev-b'));
    assert.ok(!ids.includes('f-cur-a'));
    assert.ok(!ids.includes('f-next-a'));
    assert.equal(body.meta.month, null);
  });

  it('5. attention set is cross-month and canonical', async () => {
    const { body } = await get(`?month=${CUR}`, t.adminToken);
    // The data list is current-month only…
    assert.ok(!body.data.some((r: any) => r.id === 'f-prev-overdue'));
    // …but the overdue population includes LAST month's overdue record.
    const overdueIds = body.attention.overdue.map((r: any) => r.id);
    assert.deepEqual(overdueIds, ['f-prev-overdue']);
    // Due-today: last month's record due today, and nothing else
    // (the terminal record and future-due records are excluded).
    const dueIds = body.attention.dueToday.map((r: any) => r.id);
    assert.deepEqual(dueIds, ['f-prev-due-today']);
  });

  it('6. own-scoped user: only their records, for ANY period', async () => {
    for (const query of ['', `?month=${PREV}`, `?month=${CUR}`, `?month=${NEXT}`]) {
      const { status, body } = await get(query, ownToken);
      assert.equal(status, 200, `scope request failed: ${query}`);
      for (const r of body.data) {
        assert.equal(r.employeeId, 'empA1', `out-of-scope record leaked for ${query}`);
      }
      // empB1 rows never appear in the attention set either.
      for (const r of body.attention.overdue) assert.equal(r.employeeId, 'empA1');
      for (const r of body.attention.dueToday) assert.equal(r.employeeId, 'empA1');
    }
  });

  it('7. period filtering runs INSIDE the authorized population (no count leak)', async () => {
    // The own-scoped viewer asks for the PREVIOUS month: they receive
    // ONLY their prev-month rows — empB1's prev-month rows are absent
    // even though the period itself is valid for the admin.
    const { body } = await get(`?month=${PREV}`, ownToken);
    const ids = body.data.map((r: any) => r.id).sort();
    assert.deepEqual(ids, ['f-prev-a', 'f-prev-overdue', 'f-prev-terminal']);
  });

  it('8. a viewer without followUps permission is denied', async () => {
    const { status } = await get('', t.userToken);
    assert.equal(status, 403);
  });
});
