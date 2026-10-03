// ══════════════════════════════════════════════════════════════
//  Master Data — Quality Observation Categories
//
//  The REAL route handlers + the REAL migration run against the
//  in-memory db harness. Coverage (spec §MASTER-DATA):
//    • Bootstrap: fresh install gets the full vocabulary
//      (10 existing + 8 additions), all ACTIVE, sorted identity.
//    • Migration: pre-master-data records are backfilled WITHOUT
//      overwriting configured values; sanctioned renames apply ONLY
//      to records still carrying the exact legacy name; nothing is
//      ever deactivated; the migration is IDEMPOTENT (second run =
//      zero writes).
//    • API contracts: view/create/update/delete/reorder permission
//      gates, duplicate prevention, deactivate/reactivate + audit,
//      referential-integrity delete guard, usage counts,
//      active-category enforcement on new observations.
// ══════════════════════════════════════════════════════════════

import '../../__tests__/m01-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resetTestData, setTable, createdRecords, calls,
  registerFixtures, bearerHeaders, type TestTokens,
} from '../../__tests__/m01-test-support';
// Static import — resolves through the same module instance the
// harness stubbed (a dynamic import would bypass the require-cache
// swap and hit the real Firebase layer).
import { getAll } from '@/lib/db';
import {
  ensureObservationCategoryMasterData,
  buildMasterDataPatch,
  DEFAULT_CATEGORIES,
  ADDITIONAL_CATEGORIES,
  OBSERVATION_CATEGORIES_TABLE,
} from '../index';
import { sortCategories } from '../presentation';
import type { ObservationCategory } from '@/types/quality-kpi';

interface CollectionRoute {
  GET: (req: Request) => Promise<Response>;
  POST: (req: Request) => Promise<Response>;
  PUT: (req: Request) => Promise<Response>;
}
interface ItemRoute {
  PUT: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  DELETE: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
}
interface ObservationsRoute {
  POST: (req: Request) => Promise<Response>;
}

const collectionRoute = {} as CollectionRoute;
const itemRoute = {} as ItemRoute;
const observationsRoute = {} as ObservationsRoute;
const tokens = {} as TestTokens;

function url(path: string): string {
  return `http://localhost${path}`;
}

before(async () => {
  Object.assign(collectionRoute, await import('@/app/api/observation-categories/route'));
  Object.assign(itemRoute, (await import('@/app/api/observation-categories/[id]/route')));
  Object.assign(observationsRoute, await import('@/app/api/quality-observations/route'));
});

beforeEach(async () => {
  // resetTestData clears the users map — re-register + re-mint per test
  // (same pattern as the other route-contract suites).
  resetTestData();
  const minted = await registerFixtures();
  tokens.adminToken = minted.adminToken;
  tokens.managerToken = minted.managerToken;
  tokens.userToken = minted.userToken;
});

async function adminList(withUsage = false): Promise<ObservationCategory[]> {
  const res = await collectionRoute.GET(new Request(url(`/api/observation-categories${withUsage ? '?withUsage=1' : ''}`), {
    headers: bearerHeaders(tokens.adminToken),
  }));
  assert.equal(res.status, 200);
  return res.json() as Promise<ObservationCategory[]>;
}

// ─────────────────────────────────────────────────────────────
//  Bootstrap + migration (lib-level)
// ─────────────────────────────────────────────────────────────

describe('master data bootstrap — fresh install', () => {
  it('creates the full vocabulary: 10 existing + 8 additions, all ACTIVE', async () => {
    await ensureObservationCategoryMasterData();
    const cats = createdRecords.filter((r) => r.table === OBSERVATION_CATEGORIES_TABLE);
    assert.equal(cats.length, DEFAULT_CATEGORIES.length + ADDITIONAL_CATEGORIES.length);

    const byKey = new Map(cats.map((c) => [c.data.key, c.data]));
    // Existing categories preserved (by stable key)…
    for (const key of ['late_followup', 'wrong_information', 'missed_customer', 'excellent_performance',
      'team_assistance', 'fast_recovery', 'safety_violation', 'attendance_issue',
      'customer_complaint_quality', 'process_improvement']) {
      assert.ok(byKey.has(key), `missing existing category ${key}`);
    }
    // …and all requested additions present.
    for (const key of ['package_preparation_delay', 'delayed_customer_response', 'deal_neglect',
      'lack_of_focus', 'tasks_alerts_not_completed', 'no_team_support',
      'supplier_handling_errors', 'ignoring_customer']) {
      assert.ok(byKey.has(key), `missing addition ${key}`);
    }
    // Everything ACTIVE with English labels and impact.
    for (const c of cats) {
      assert.equal(c.data.isActive, true, `${c.data.key} must be active`);
      assert.ok(c.data.nameEn, `${c.data.key} must carry nameEn`);
      assert.ok(['POSITIVE', 'NEGATIVE', 'NEUTRAL'].includes(c.data.impact), `${c.data.key} impact`);
    }
    // The two business renames are canonical in the fresh vocabulary.
    assert.equal(byKey.get('late_followup')!.name, 'متابعة');
    assert.equal(byKey.get('excellent_performance')!.name, 'أداء');
    // Safety violation is NOT touched (stays active, unchanged name).
    assert.equal(byKey.get('safety_violation')!.name, 'مخالفة أمان');
  });

  it('assigns unique sortOrder 1..N to the bootstrap vocabulary', async () => {
    await ensureObservationCategoryMasterData();
    const cats = createdRecords.filter((r) => r.table === OBSERVATION_CATEGORIES_TABLE);
    const orders = cats.map((c) => c.data.sortOrder as number).sort((a, b) => a - b);
    assert.deepEqual(orders, Array.from({ length: cats.length }, (_, i) => i + 1));
  });

  it('is idempotent — a second ensure performs ZERO writes', async () => {
    await ensureObservationCategoryMasterData();
    const writesBefore = calls.filter((c) => c.fn === 'createRecord' || c.fn === 'updateRecord').length;
    await ensureObservationCategoryMasterData();
    const writesAfter = calls.filter((c) => c.fn === 'createRecord' || c.fn === 'updateRecord').length;
    assert.equal(writesAfter, writesBefore, 'second migration must not write');
  });
});

describe('master data migration — pre-master-data records', () => {
  function legacyRow(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      id: overrides.key ?? 'x', schemaVersion: 1, name: 'x', key: 'x',
      defaultPointValue: 1, weight: 1, color: 'slate', priority: 'medium',
      isBonusDefault: false,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      ...overrides,
    };
  }

  it('backfills missing fields, applies exact-legacy renames, and keeps user-renamed records', async () => {
    setTable(OBSERVATION_CATEGORIES_TABLE, [
      // Legacy record still carrying the old label → renamed + backfilled.
      legacyRow({ id: 'c1', key: 'late_followup', name: 'تأخر متابعة' }),
      // User already renamed it → name is NEVER overwritten.
      legacyRow({ id: 'c2', key: 'late_followup2', name: 'خطأ متابعة' }),
      // Bonus category → impact derives POSITIVE.
      legacyRow({ id: 'c3', key: 'excellent_performance', name: 'أداء ممتاز', isBonusDefault: true }),
      // Manually configured nameEn → untouched.
      legacyRow({ id: 'c4', key: 'fast_recovery', name: 'تعافي سريع', nameEn: 'My Recovery' }),
    ]);

    await ensureObservationCategoryMasterData();

    assert.ok(calls.filter((c) => c.fn === 'updateRecord').length >= 4);

    // State-based verification — read the mutated rows through the
    // stubbed db (the harness mutates rows in place).
    const rows = await getAll<ObservationCategory>(OBSERVATION_CATEGORIES_TABLE);
    const byId = new Map(rows.map((r) => [r.id, r]));

    const c1 = byId.get('c1')!;
    assert.equal(c1.name, 'متابعة'); // sanctioned rename applied
    assert.equal(c1.nameEn, 'Follow-up');
    assert.equal(c1.isActive, true);
    const c2 = byId.get('c2')!;
    assert.equal(c2.name, 'خطأ متابعة', 'user-renamed record keeps its name');
    assert.ok(c2.isActive, 'user-renamed record stays active');
    const c3 = byId.get('c3')!;
    assert.equal(c3.name, 'أداء');
    assert.equal(c3.impact, 'POSITIVE');
    const c4 = byId.get('c4')!;
    assert.equal(c4.nameEn, 'My Recovery', 'configured nameEn never overwritten');
  });

  it('never deactivates an existing category during migration', async () => {
    setTable(OBSERVATION_CATEGORIES_TABLE, [
      legacyRow({ id: 'c1', key: 'safety_violation', name: 'مخالفة أمان' }),
    ]);
    await ensureObservationCategoryMasterData();
    // NOTHING existing may end up inactive — verify the full table state.
    const rows = await getAll<ObservationCategory>(OBSERVATION_CATEGORIES_TABLE);
    const safety = rows.find((r) => r.key === 'safety_violation')!;
    assert.equal(safety.name, 'مخالفة أمان', 'existing category name untouched');
    assert.notEqual(safety.isActive, false, 'existing category must NOT be deactivated');
    const created = createdRecords
      .filter((r) => r.table === OBSERVATION_CATEGORIES_TABLE)
      .map((r) => r.data);
    for (const c of created) assert.equal(c.isActive, true, 'additions must be created ACTIVE');
  });

  it('inserts missing additions after the max existing sortOrder (no duplicates)', async () => {
    setTable(OBSERVATION_CATEGORIES_TABLE, [
      legacyRow({ id: 'c1', key: 'lack_of_focus', name: 'عدم التركيز', sortOrder: 42 }), // already added manually
      legacyRow({ id: 'c2', key: 'safety_violation', name: 'مخالفة أمان', sortOrder: 7 }),
    ]);
    await ensureObservationCategoryMasterData();
    const created = createdRecords
      .filter((r) => r.table === OBSERVATION_CATEGORIES_TABLE)
      .map((r) => r.data);
    // lack_of_focus NOT duplicated; the other 7 additions inserted.
    assert.equal(created.filter((c) => c.key === 'lack_of_focus').length, 0);
    assert.equal(created.length, ADDITIONAL_CATEGORIES.length - 1);
    for (const c of created) assert.ok((c.sortOrder as number) > 42, 'additions sort after existing max');
  });
});

describe('buildMasterDataPatch — pure semantics', () => {
  const base = {
    id: 'x', schemaVersion: 1 as const, key: 'k', name: 'n',
    defaultPointValue: 1, weight: 1, color: 'slate', priority: 'medium' as const,
    isBonusDefault: false, createdAt: '', updatedAt: '',
  };

  it('returns null for a fully migrated record (idempotency core)', () => {
    const record = { ...base, nameEn: 'Name', isActive: true, sortOrder: 3, impact: 'NEGATIVE' as const };
    assert.equal(buildMasterDataPatch(record, 0), null);
  });

  it('rename fires ONLY for the exact legacy label', () => {
    const legacy = { ...base, key: 'late_followup', name: 'تأخر متابعة' };
    const patch = buildMasterDataPatch(legacy, 0)!;
    assert.equal(patch.name, 'متابعة');
    const renamed = { ...base, key: 'late_followup', name: 'متابعة' };
    const patch2 = buildMasterDataPatch(renamed, 0)!;
    assert.equal(patch2.name, undefined);
  });
});

// ─────────────────────────────────────────────────────────────
//  API contracts
// ─────────────────────────────────────────────────────────────

describe('GET /api/observation-categories', () => {
  it('401 without a token, 403 without the view permission', async () => {
    const noToken = await collectionRoute.GET(new Request(url('/api/observation-categories')));
    assert.equal(noToken.status, 401);

    const forbidden = await collectionRoute.GET(new Request(url('/api/observation-categories'), {
      headers: bearerHeaders(tokens.userToken), // 'user' preset: observationCategories none
    }));
    assert.equal(forbidden.status, 403);
  });

  it('returns the canonical list sorted by sortOrder, with usage when asked', async () => {
    await ensureObservationCategoryMasterData();
    const list = await adminList();
    assert.equal(list.length, DEFAULT_CATEGORIES.length + ADDITIONAL_CATEGORIES.length);
    const orders = list.map((c) => c.sortOrder ?? 0);
    assert.deepEqual([...orders].sort((a, b) => a - b), orders, 'list must be sortOrder-ascending');

    setTable('qualityObservations', [
      { id: 'o1', categoryId: list[0].id },
      { id: 'o2', categoryId: list[0].id },
      { id: 'o3', categoryId: list[1].id },
    ]);
    const withUsage = await adminList(true);
    const first = withUsage.find((c) => c.id === list[0].id) as ObservationCategory & { usageCount?: number };
    assert.equal(first.usageCount, 2);
  });
});

describe('POST /api/observation-categories — create + duplicate prevention', () => {
  it('rejects a duplicate stable key and a duplicate active Arabic name', async () => {
    await ensureObservationCategoryMasterData();

    const dupKey = await collectionRoute.POST(new Request(url('/api/observation-categories'), {
      method: 'POST',
      headers: bearerHeaders(tokens.adminToken),
      body: JSON.stringify({ key: 'late_followup', name: 'تصنيف جديد تماماً', nameEn: 'Brand New' }),
    }));
    assert.equal(dupKey.status, 400);

    const dupName = await collectionRoute.POST(new Request(url('/api/observation-categories'), {
      method: 'POST',
      headers: bearerHeaders(tokens.adminToken),
      body: JSON.stringify({ key: 'brand_new_key', name: 'مخالفة أمان', nameEn: 'Safety Violation 2' }),
    }));
    assert.equal(dupName.status, 400);

    const badImpact = await collectionRoute.POST(new Request(url('/api/observation-categories'), {
      method: 'POST',
      headers: bearerHeaders(tokens.adminToken),
      body: JSON.stringify({ key: 'ok_key', name: 'سليم', nameEn: 'Fine', impact: 'HUGE' }),
    }));
    assert.equal(badImpact.status, 400);
  });

  it('creates audited, active by default, syncing impact → isBonusDefault', async () => {
    await ensureObservationCategoryMasterData();
    const res = await collectionRoute.POST(new Request(url('/api/observation-categories'), {
      method: 'POST',
      headers: bearerHeaders(tokens.adminToken),
      body: JSON.stringify({ key: 'Star_Deal', name: 'صفقة مميزة', nameEn: 'Star Deal', impact: 'POSITIVE', defaultPointValue: 4, weight: 1 }),
    }));
    assert.equal(res.status, 201);
    const created = await res.json() as ObservationCategory;
    assert.equal(created.key, 'star_deal'); // normalized
    assert.equal(created.isActive, true);
    assert.equal(created.isBonusDefault, true); // POSITIVE → bonus default
    assert.equal(created.sortOrder, DEFAULT_CATEGORIES.length + ADDITIONAL_CATEGORIES.length + 1);

    // The creation path runs through writeAudit → qualityAuditLog.
    const auditEntry = createdRecords.find((r) => r.table === 'qualityAuditLog'
      && (r.data as Record<string, unknown>).action === 'create');
    assert.ok(auditEntry, 'category create must be audited');
  });

  it('rejects an unauthorized mutation (API cannot be bypassed)', async () => {
    const forbidden = await collectionRoute.POST(new Request(url('/api/observation-categories'), {
      method: 'POST',
      headers: bearerHeaders(tokens.userToken),
      body: JSON.stringify({ key: 'hack', name: 'اختراق', nameEn: 'Hack' }),
    }));
    assert.equal(forbidden.status, 403);
  });
});

describe('PUT /api/observation-categories/[id] — deactivate / reactivate / edit', () => {
  it('deactivates and reactivates with explicit audit actions; list unchanged in count', async () => {
    await ensureObservationCategoryMasterData();
    const list = await adminList();
    const target = list[0];
    calls.length = 0;

    const off = await itemRoute.PUT(new Request(url(`/api/observation-categories/${target.id}`), {
      method: 'PUT',
      headers: bearerHeaders(tokens.adminToken),
      body: JSON.stringify({ isActive: false }),
    }), { params: Promise.resolve({ id: target.id }) });
    assert.equal(off.status, 200);
    assert.equal((await off.json()).isActive, false);

    const auditWrites = createdRecords; // audit entries go through writeAudit → createRecord
    const auditEntry = auditWrites.find((r) => r.table === 'qualityAuditLog' && (r.data as Record<string, unknown>).action === 'deactivate');
    assert.ok(auditEntry, 'deactivate must be audited');

    const on = await itemRoute.PUT(new Request(url(`/api/observation-categories/${target.id}`), {
      method: 'PUT',
      headers: bearerHeaders(tokens.adminToken),
      body: JSON.stringify({ isActive: true }),
    }), { params: Promise.resolve({ id: target.id }) });
    assert.equal(on.status, 200);
    assert.equal((await on.json()).isActive, true);
  });

  it('rejects editing to a duplicate active Arabic name', async () => {
    await ensureObservationCategoryMasterData();
    const list = await adminList();
    const a = list.find((c) => c.name === 'متابعة')!;
    const b = list.find((c) => c.name === 'مخالفة أمان')!;
    const res = await itemRoute.PUT(new Request(url(`/api/observation-categories/${b.id}`), {
      method: 'PUT',
      headers: bearerHeaders(tokens.adminToken),
      body: JSON.stringify({ name: a.name }),
    }), { params: Promise.resolve({ id: b.id }) });
    assert.equal(res.status, 400);
  });
});

describe('PUT /api/observation-categories — reorder', () => {
  it('assigns sortOrder by list position and audits the reorder', async () => {
    await ensureObservationCategoryMasterData();
    const list = await adminList();
    const reversed = [...list].reverse().map((c) => c.id);
    const res = await collectionRoute.PUT(new Request(url('/api/observation-categories'), {
      method: 'PUT',
      headers: bearerHeaders(tokens.adminToken),
      body: JSON.stringify({ reorder: reversed }),
    }));
    assert.equal(res.status, 200);

    const after = await adminList();
    assert.deepEqual(after.map((c) => c.id), reversed);
    assert.deepEqual(after.map((c) => c.sortOrder), reversed.map((_, i) => i + 1));

    const auditEntry = createdRecords.find((r) => r.table === 'qualityAuditLog' && (r.data as Record<string, unknown>).action === 'reorder');
    assert.ok(auditEntry, 'reorder must be audited');
  });

  it('rejects a partial or unknown id list', async () => {
    await ensureObservationCategoryMasterData();
    const list = await adminList();
    const res = await collectionRoute.PUT(new Request(url('/api/observation-categories'), {
      method: 'PUT',
      headers: bearerHeaders(tokens.adminToken),
      body: JSON.stringify({ reorder: [list[0].id, 'ghost-id'] }),
    }));
    assert.equal(res.status, 400);
  });
});

describe('DELETE /api/observation-categories/[id] — referential guard', () => {
  it('refuses to hard-delete a referenced category, allows unreferenced', async () => {
    await ensureObservationCategoryMasterData();
    const list = await adminList();
    const referenced = list[0];
    const unreferenced = list[list.length - 1];
    setTable('qualityObservations', [{ id: 'o1', categoryId: referenced.id }]);

    const blocked = await itemRoute.DELETE(new Request(url(`/api/observation-categories/${referenced.id}`), {
      method: 'DELETE',
      headers: bearerHeaders(tokens.adminToken),
    }), { params: Promise.resolve({ id: referenced.id }) });
    assert.equal(blocked.status, 400);
    const body = await blocked.json();
    assert.match(String(body.error?.message ?? ''), /ملاحظة/);

    const ok = await itemRoute.DELETE(new Request(url(`/api/observation-categories/${unreferenced.id}`), {
      method: 'DELETE',
      headers: bearerHeaders(tokens.adminToken),
    }), { params: Promise.resolve({ id: unreferenced.id }) });
    assert.equal(ok.status, 200);
  });

  it('blocks deletion when templates reference the category', async () => {
    await ensureObservationCategoryMasterData();
    const list = await adminList();
    setTable('observationTemplates', [{ id: 't1', categoryId: list[0].id }]);
    const res = await itemRoute.DELETE(new Request(url(`/api/observation-categories/${list[0].id}`), {
      method: 'DELETE',
      headers: bearerHeaders(tokens.adminToken),
    }), { params: Promise.resolve({ id: list[0].id }) });
    assert.equal(res.status, 400);
  });
});

describe('observation create — active-category enforcement', () => {
  it('rejects a NEW observation on a deactivated category, accepts an active one', async () => {
    setTable('employees', [{ id: 'emp_x', name: 'موظف اختبار', status: 'active' }]);
    await ensureObservationCategoryMasterData();
    const list = await adminList();
    const active = list[0];
    const off = await itemRoute.PUT(new Request(url(`/api/observation-categories/${active.id}`), {
      method: 'PUT',
      headers: bearerHeaders(tokens.adminToken),
      body: JSON.stringify({ isActive: false }),
    }), { params: Promise.resolve({ id: active.id }) });
    assert.equal(off.status, 200);

    const rejected = await observationsRoute.POST(new Request(url('/api/quality-observations'), {
      method: 'POST',
      headers: bearerHeaders(tokens.adminToken),
      body: JSON.stringify({
        employeeId: 'emp_x', observationDate: '01/10/2026', type: 'quality_observation',
        categoryId: active.id, notes: '', clientRequestId: `t_${Date.now()}`,
      }),
    }));
    assert.equal(rejected.status, 400);

    // Re-activate → the same creation now SUCCEEDS (employee is seeded
    // active) — proving the deactivated-category gate was the blocker.
    const react = await itemRoute.PUT(new Request(url(`/api/observation-categories/${active.id}`), {
      method: 'PUT',
      headers: bearerHeaders(tokens.adminToken),
      body: JSON.stringify({ isActive: true }),
    }), { params: Promise.resolve({ id: active.id }) });
    assert.equal(react.status, 200);

    const accepted = await observationsRoute.POST(new Request(url('/api/quality-observations'), {
      method: 'POST',
      headers: bearerHeaders(tokens.adminToken),
      body: JSON.stringify({
        employeeId: 'emp_x', observationDate: '01/10/2026', type: 'quality_observation',
        categoryId: active.id, notes: '', clientRequestId: `t_${Date.now()}_2`,
      }),
    }));
    assert.equal(accepted.status, 201);
    const created = await accepted.json();
    assert.equal(created.categoryId, active.id);
  });
});

// ─────────────────────────────────────────────────────────────
//  Presentation ordering (pure)
// ─────────────────────────────────────────────────────────────

describe('sortCategories', () => {
  it('orders by sortOrder then Arabic name', () => {
    const ordered = sortCategories([
      { name: 'ب', sortOrder: 2 },
      { name: 'أ', sortOrder: 1 },
      { name: 'ج', sortOrder: undefined },
    ]);
    assert.deepEqual(ordered.map((c) => c.name), ['أ', 'ب', 'ج']);
  });
});

// Static contract: every mutation route keeps its pinned permission key.
describe('observation-categories routes — static permission contract', () => {
  const files = [
    ['src/app/api/observation-categories/route.ts', ["verifyPermission(request, 'observationCategories', 'view')", "verifyPermission(request, 'observationCategories', 'create')", "verifyPermission(request, 'observationCategories', 'update')"]],
    ['src/app/api/observation-categories/[id]/route.ts', ["verifyPermission(request, 'observationCategories', 'update')", "verifyPermission(request, 'observationCategories', 'delete')"]],
  ] as const;
  for (const [rel, needles] of files) {
    it(`${rel} keeps its permission gates`, () => {
      const source = readFileSync(join(process.cwd(), rel), 'utf8');
      for (const needle of needles) assert.ok(source.includes(needle), `missing: ${needle}`);
    });
  }
});
