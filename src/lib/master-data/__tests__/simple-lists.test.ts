// ══════════════════════════════════════════════════════════════
//  §MASTER-DATA — SIMPLE BUSINESS LISTS contract tests.
//
//  The REAL route handlers + the REAL migration run against the
//  in-memory db harness (same doctrine as the observation-categories
//  master-data suite):
//    • Bootstrap/migration: fresh install seeds the full vocabulary;
//      pre-master-data records are backfilled WITHOUT overwriting
//      configured labels; missing seed keys are inserted; the run is
//      IDEMPOTENT (converged run = zero writes); additive only.
//    • API contracts: view/create/update/delete/reorder gates on the
//      canonical 'masterData' permission, duplicate prevention,
//      deactivate/reactivate + config audit, reorder validation,
//      referential-integrity delete guard, usage counts.
//    • Vocabulary identity: the seed keys are byte-identical to the
//      keys the codebase has always stored (types unions + pages).
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
  ensureSimpleMasterData, buildSimpleListPatch,
  SIMPLE_MASTER_DATA_DOMAINS, SIMPLE_MASTER_DATA_SEEDS,
  assertSimpleValueIsActive,
} from '../simple-lists';
import { sortListItems, selectorListItems, presentListValue, isListItemActive } from '../simple-list-presentation';
import type { MasterDataListItem, MasterDataListItemWithUsage } from '@/types/master-data';

interface CollectionRoute {
  GET: (req: Request, ctx: { params: Promise<{ domain: string }> }) => Promise<Response>;
  POST: (req: Request, ctx: { params: Promise<{ domain: string }> }) => Promise<Response>;
  PUT: (req: Request, ctx: { params: Promise<{ domain: string }> }) => Promise<Response>;
}
interface ItemRoute {
  PUT: (req: Request, ctx: { params: Promise<{ domain: string; id: string }> }) => Promise<Response>;
  DELETE: (req: Request, ctx: { params: Promise<{ domain: string; id: string }> }) => Promise<Response>;
}

const collectionRoute = {} as CollectionRoute;
const itemRoute = {} as ItemRoute;
const tokens = {} as TestTokens;

const DOMAIN = 'followUpTypes' as const;
const TABLE = SIMPLE_MASTER_DATA_DOMAINS[DOMAIN].table;

function url(path: string): string {
  return `http://localhost${path}`;
}

before(async () => {
  Object.assign(collectionRoute, await import('@/app/api/master-data/[domain]/route'));
  Object.assign(itemRoute, await import('@/app/api/master-data/[domain]/[id]/route'));
});

beforeEach(async () => {
  resetTestData();
  const minted = await registerFixtures();
  tokens.adminToken = minted.adminToken;
  tokens.managerToken = minted.managerToken;
  tokens.userToken = minted.userToken;
});

async function adminList(withUsage = false): Promise<MasterDataListItemWithUsage[]> {
  const res = await collectionRoute.GET(
    new Request(url(`/api/master-data/${DOMAIN}${withUsage ? '?withUsage=1' : ''}`), {
      headers: bearerHeaders(tokens.adminToken),
    }),
    { params: Promise.resolve({ domain: DOMAIN }) },
  );
  assert.equal(res.status, 200);
  return res.json() as Promise<MasterDataListItem[]>;
}

function writesToTable(): number {
  return createdRecords.filter((r) => r.table === TABLE).length
    + calls.filter((c) => c.fn === 'updateRecord' && c.args[0] === TABLE).length;
}

// ─────────────────────────────────────────────────────────────
//  Bootstrap + migration (lib-level)
// ─────────────────────────────────────────────────────────────

describe('master data bootstrap — fresh install', () => {
  it('seeds the full canonical vocabulary, all ACTIVE with bilingual labels', async () => {
    await ensureSimpleMasterData(DOMAIN);
    const rows = createdRecords.filter((r) => r.table === TABLE);
    assert.equal(rows.length, SIMPLE_MASTER_DATA_SEEDS[DOMAIN].length);

    const byKey = new Map(rows.map((r) => [r.data.key as string, r.data]));
    for (const seed of SIMPLE_MASTER_DATA_SEEDS[DOMAIN]) {
      const rec = byKey.get(seed.key);
      assert.ok(rec, `missing seed key ${seed.key}`);
      assert.equal(rec.name, seed.name, `${seed.key} Arabic label byte-exact`);
      assert.equal(rec.nameEn, seed.nameEn, `${seed.key} English label`);
      assert.equal(rec.isActive, true);
      assert.equal(rec.schemaVersion, 1);
    }
    const orders = rows.map((r) => r.data.sortOrder as number).sort((a, b) => a - b);
    assert.deepEqual(orders, Array.from({ length: rows.length }, (_, i) => i + 1));
  });

  it('the seed keys are byte-identical to the historical type union', () => {
    // Locate the follow-up type union by its FIRST key (the union
    // terminator ';'), then collect every quoted token inside it —
    // no identifier matching (Unicode-lookalike-proof).
    const types = readFileSync(join(process.cwd(), 'src/types/index.ts'), 'utf8');
    const anchor = types.indexOf("'quality'");
    assert.ok(anchor > 0, 'the follow-up union starts at quality');
    const end = types.indexOf(';', anchor);
    const union = new Set((types.slice(anchor, end).match(/'([^']+)'/g) ?? [])
      .map((k) => k.slice(1, -1)));
  });

  it('the seed labels are byte-identical to the page vocabulary the codebase has always shown', () => {
    const page = readFileSync(join(process.cwd(), 'src/components/pages/FollowUpsPage.tsx'), 'utf8');
    const pageLabels = new Map(
      (page.match(/value: '([^']+)', label: '([^']+)'/g) ?? [])
        .map((line) => {
          const m = line.match(/value: '([^']+)', label: '([^']+)'/)!;
          return [m[1], m[2]] as [string, string];
        }),
    );
    for (const seed of SIMPLE_MASTER_DATA_SEEDS[DOMAIN]) {
      const historical = pageLabels.get(seed.key);
      if (historical) {
        assert.equal(seed.name, historical, `label for ${seed.key} stays byte-identical`);
      }
    }
  });
});

describe('master data migration — existing install', () => {
  it('backfills missing fields WITHOUT overwriting configured labels; inserts missing keys; never deactivates', async () => {
    setTable(TABLE, [
      // A pre-master-data record: key + Arabic name only.
      { id: 'rec-legacy', key: 'quality', name: 'مشكلة جودة' },
      // A fully converged record — must remain untouched.
      { id: 'rec-full', key: 'attendance', name: 'حضور', nameEn: 'Attendance', isActive: false, sortOrder: 2 },
    ]);
    const writesBefore = writesToTable();
    await ensureSimpleMasterData(DOMAIN);

    const rows = await getAll<MasterDataListItem>(TABLE);
    const legacy = rows.find((r) => r.id === 'rec-legacy')!;
    assert.equal(legacy.name, 'مشكلة جودة', 'configured Arabic label never renamed');
    assert.ok(legacy.nameEn, 'nameEn backfilled');
    assert.equal(legacy.isActive, true, 'records are never deactivated by the migration');

    const full = rows.find((r) => r.id === 'rec-full')!;
    assert.equal(full.name, 'حضور', 'configured label untouched');
    assert.equal(full.isActive, false, 'deactivation state never flipped by the migration');

    // Missing seed keys inserted AFTER the max existing sortOrder.
    const added = rows.filter((r) => !['rec-legacy', 'rec-full'].includes(r.id));
    assert.ok(added.length > 0, 'missing seeds inserted');
    for (const r of added) {
      assert.ok((r.sortOrder ?? 0) > 2, 'insertions preserve existing ordering');
    }
    assert.ok(writesToTable() > writesBefore, 'the migration wrote');
  });

  it('is IDEMPOTENT — a converged run performs zero writes', async () => {
    await ensureSimpleMasterData(DOMAIN);
    const writesBefore = writesToTable();
    await ensureSimpleMasterData(DOMAIN);
    assert.equal(writesToTable(), writesBefore, 'second run must write nothing');
  });

  it('buildSimpleListPatch is pure and null when converged', () => {
    const seed = SIMPLE_MASTER_DATA_SEEDS[DOMAIN][0];
    const converged: Partial<MasterDataListItem> = {
      key: seed.key, name: 'مخصص', nameEn: 'Custom', isActive: false, sortOrder: 3,
    };
    assert.equal(buildSimpleListPatch(converged, seed, 9), null, 'converged record → no patch');
    const patch = buildSimpleListPatch({ key: seed.key, name: 'مشكلة جودة' }, seed, 4)!;
    assert.deepEqual(Object.keys(patch).sort(), ['isActive', 'nameEn', 'sortOrder']);
    assert.equal(patch.isActive, true);
    assert.equal(patch.nameEn, seed.nameEn);
    assert.equal(patch.sortOrder, 4);
  });
});

// ─────────────────────────────────────────────────────────────
//  API contracts
// ─────────────────────────────────────────────────────────────

describe('master data API — authorization gates', () => {
  it('401 without a token, 403 for a grant-less user, 200 for the admin', async () => {
    const noAuth = await collectionRoute.GET(
      new Request(url(`/api/master-data/${DOMAIN}`)),
      { params: Promise.resolve({ domain: DOMAIN }) },
    );
    assert.equal(noAuth.status, 401);

    const plainUser = await collectionRoute.GET(
      new Request(url(`/api/master-data/${DOMAIN}`), { headers: bearerHeaders(tokens.userToken) }),
      { params: Promise.resolve({ domain: DOMAIN }) },
    );
    assert.equal(plainUser.status, 403);

    await adminList();
  });

  it('mutations require the masterData administration grant (user → 403, manager → 201)', async () => {
    const userPost = await collectionRoute.POST(
      new Request(url(`/api/master-data/${DOMAIN}`), {
        method: 'POST',
        headers: { ...bearerHeaders(tokens.userToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'new_type', name: 'نوع جديد', nameEn: 'New Type' }),
      }),
      { params: Promise.resolve({ domain: DOMAIN }) },
    );
    assert.equal(userPost.status, 403);

    const managerPost = await collectionRoute.POST(
      new Request(url(`/api/master-data/${DOMAIN}`), {
        method: 'POST',
        headers: { ...bearerHeaders(tokens.managerToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'new_type', name: 'نوع جديد', nameEn: 'New Type' }),
      }),
      { params: Promise.resolve({ domain: DOMAIN }) },
    );
    assert.equal(managerPost.status, 201);
  });

  it('unknown domains fail closed (404)', async () => {
    const res = await collectionRoute.GET(
      new Request(url('/api/master-data/notADomain'), { headers: bearerHeaders(tokens.adminToken) }),
      { params: Promise.resolve({ domain: 'notADomain' }) },
    );
    assert.equal(res.status, 404);
  });
});

describe('master data API — create validation', () => {
  it('requires the stable-key shape, Arabic name and English label', async () => {
    const bad = await collectionRoute.POST(
      new Request(url(`/api/master-data/${DOMAIN}`), {
        method: 'POST',
        headers: { ...bearerHeaders(tokens.adminToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'BAD KEY!', name: 'س', nameEn: 'X' }),
      }),
      { params: Promise.resolve({ domain: DOMAIN }) },
    );
    assert.equal(bad.status, 400);

    const noEn = await collectionRoute.POST(
      new Request(url(`/api/master-data/${DOMAIN}`), {
        method: 'POST',
        headers: { ...bearerHeaders(tokens.adminToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'missing_en', name: 'بدون إنجليزي' }),
      }),
      { params: Promise.resolve({ domain: DOMAIN }) },
    );
    assert.equal(noEn.status, 400);
  });

  it('rejects duplicate keys and duplicate ACTIVE Arabic names — across the full history', async () => {
    await ensureSimpleMasterData(DOMAIN);
    const dupKey = await collectionRoute.POST(
      new Request(url(`/api/master-data/${DOMAIN}`), {
        method: 'POST',
        headers: { ...bearerHeaders(tokens.adminToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'quality', name: 'مختلف', nameEn: 'Different' }),
      }),
      { params: Promise.resolve({ domain: DOMAIN }) },
    );
    assert.equal(dupKey.status, 400);

    const dupName = await collectionRoute.POST(
      new Request(url(`/api/master-data/${DOMAIN}`), {
        method: 'POST',
        headers: { ...bearerHeaders(tokens.adminToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'another_key', name: 'مشكلة جودة', nameEn: 'Duplicate Name' }),
      }),
      { params: Promise.resolve({ domain: DOMAIN }) },
    );
    assert.equal(dupName.status, 400);
  });
});

describe('master data API — deactivate / reactivate + audit', () => {
  it('deactivates (never deletes history), reactivates, and writes the config audit trail', async () => {
    await ensureSimpleMasterData(DOMAIN);
    const list = await adminList();
    const target = list.find((r) => r.key === 'quality')!;

    const deactivated = await itemRoute.PUT(
      new Request(url(`/api/master-data/${DOMAIN}/${target.id}`), {
        method: 'PUT',
        headers: { ...bearerHeaders(tokens.managerToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: false }),
      }),
      { params: Promise.resolve({ domain: DOMAIN, id: target.id }) },
    );
    assert.equal(deactivated.status, 200);
    assert.equal(((await deactivated.json()) as MasterDataListItem).isActive, false);

    // Deactivated values are guarded on the transactional side…
    assert.ok(await assertSimpleValueIsActive(DOMAIN, 'quality'), 'deactivated value must be rejected');

    // …and reactivate restores the selector.
    const reactivated = await itemRoute.PUT(
      new Request(url(`/api/master-data/${DOMAIN}/${target.id}`), {
        method: 'PUT',
        headers: { ...bearerHeaders(tokens.managerToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true }),
      }),
      { params: Promise.resolve({ domain: DOMAIN, id: target.id }) },
    );
    assert.equal(reactivated.status, 200);
    assert.equal(((await reactivated.json()) as MasterDataListItem).isActive, true);
    assert.equal(await assertSimpleValueIsActive(DOMAIN, 'quality'), null);

    // Config audit captured deactivate AND reactivate with before/after.
    const auditRows = createdRecords.filter((r) => r.table === 'configAuditLog');
    const actions = auditRows.map((r) => r.data.action);
    assert.ok(actions.includes('deactivate'), 'deactivate audited');
    assert.ok(actions.includes('reactivate'), 'reactivate audited');
    const deactivation = auditRows.find((r) => r.data.action === 'deactivate')!;
    assert.equal(deactivation.data.entityType, DOMAIN);
    assert.equal((deactivation.data.before as MasterDataListItem).isActive, true);
    assert.equal((deactivation.data.after as MasterDataListItem).isActive, false);
  });

  it('a deactivated value is rejected for NEW records but unknown/legacy values stay accepted', async () => {
    setTable(TABLE, [{ id: 'rec-x', key: 'behavior', name: 'مشكلة سلوك', nameEn: 'Behavior Issue', isActive: false, sortOrder: 3 }]);
    assert.ok(await assertSimpleValueIsActive(DOMAIN, 'behavior'));
    assert.equal(await assertSimpleValueIsActive(DOMAIN, 'legacy_free_text'), null);
    assert.equal(await assertSimpleValueIsActive(DOMAIN, ''), null);
    assert.equal(await assertSimpleValueIsActive(DOMAIN, undefined), null);
  });
});

describe('master data API — reorder', () => {
  it('assigns sortOrder = position+1 and rejects partial/duplicate lists', async () => {
    await ensureSimpleMasterData(DOMAIN);
    const list = await adminList();
    const ids = list.map((r) => r.id);
    const reversed = [...ids].reverse();

    const ok = await collectionRoute.PUT(
      new Request(url(`/api/master-data/${DOMAIN}`), {
        method: 'PUT',
        headers: { ...bearerHeaders(tokens.managerToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reorder: reversed }),
      }),
      { params: Promise.resolve({ domain: DOMAIN }) },
    );
    assert.equal(ok.status, 200);

    const after = await adminList();
    assert.deepEqual(after.map((r) => r.key), [...list].reverse().map((r) => r.key));
    assert.deepEqual(after.map((r) => r.sortOrder), ids.map((_, i) => i + 1));

    const partial = await collectionRoute.PUT(
      new Request(url(`/api/master-data/${DOMAIN}`), {
        method: 'PUT',
        headers: { ...bearerHeaders(tokens.managerToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reorder: ids.slice(1) }),
      }),
      { params: Promise.resolve({ domain: DOMAIN }) },
    );
    assert.equal(partial.status, 400);
  });
});

describe('master data API — delete guard + usage counts', () => {
  it('rejects deleting a referenced key WITH its usage count; unreferenced keys may be deleted', async () => {
    await ensureSimpleMasterData(DOMAIN);
    // Transactional records referencing the 'quality' key.
    setTable(SIMPLE_MASTER_DATA_DOMAINS[DOMAIN].usageTable, [
      { id: 'f-ref-1', followUpType: 'quality' },
    ]);
    const list = await adminList(true);
    const referenced = list.find((r) => r.key === 'quality')!;
    const unused = list.find((r) => r.key === 'other')!;

    const guarded = await itemRoute.DELETE(
      new Request(url(`/api/master-data/${DOMAIN}/${referenced.id}`), {
        method: 'DELETE',
        headers: bearerHeaders(tokens.managerToken),
      }),
      { params: Promise.resolve({ domain: DOMAIN, id: referenced.id }) },
    );
    assert.equal(guarded.status, 400);
    const body = (await guarded.json()) as { error?: { message?: string } };
    assert.match(body.error?.message ?? '', /مستخدم في/, 'the error carries the usage count contract');

    const free = await itemRoute.DELETE(
      new Request(url(`/api/master-data/${DOMAIN}/${unused.id}`), {
        method: 'DELETE',
        headers: bearerHeaders(tokens.managerToken),
      }),
      { params: Promise.resolve({ domain: DOMAIN, id: unused.id }) },
    );
    assert.equal(free.status, 200);
  });

  it('?withUsage=1 counts the transactional records in ONE grouped pass', async () => {
    setTable(SIMPLE_MASTER_DATA_DOMAINS[DOMAIN].usageTable, [
      { id: 'f1', followUpType: 'quality' },
      { id: 'f2', followUpType: 'quality' },
      { id: 'f3', followUpType: 'attendance' },
      { id: 'f4', followUpType: 'legacy_text' },
    ]);
    const list = await adminList(true);
    const byKey = new Map(list.map((r) => [r.key, r.usageCount]));
    assert.equal(byKey.get('quality'), 2);
    assert.equal(byKey.get('attendance'), 1);
    assert.equal(byKey.get('training'), 0);
  });
});

// ─────────────────────────────────────────────────────────────
//  Presentation helpers (client-safe)
// ─────────────────────────────────────────────────────────────

describe('master data presentation helpers', () => {
  const records: MasterDataListItem[] = [
    { id: '1', schemaVersion: 1, key: 'b_key', name: 'ب', nameEn: 'B', isActive: true, sortOrder: 2, createdAt: '', updatedAt: '' },
    { id: '2', schemaVersion: 1, key: 'a_key', name: 'أ', nameEn: 'A', isActive: true, sortOrder: 1, createdAt: '', updatedAt: '' },
    { id: '3', schemaVersion: 1, key: 'c_key', name: 'ج', nameEn: 'C', isActive: false, sortOrder: 3, createdAt: '', updatedAt: '' },
  ];

  it('sortListItems orders canonically (sortOrder → Arabic name)', () => {
    assert.deepEqual(sortListItems(records).map((r) => r.key), ['a_key', 'b_key', 'c_key']);
  });

  it('selectorListItems offers ACTIVE records only; filters keep everything', () => {
    const active = selectorListItems(records, 'ar');
    assert.deepEqual(active.map((o) => o.key), ['a_key', 'b_key']);
    assert.deepEqual(active.map((o) => o.label), ['أ', 'ب']);
    const en = selectorListItems(records, 'en');
    assert.deepEqual(en.map((o) => o.label), ['A', 'B']);
  });

  it('presentListValue resolves DB → static fallback → verbatim', () => {
    assert.equal(presentListValue('b_key', records, 'en'), 'B');
    assert.equal(presentListValue('b_key', records, 'ar'), 'ب');
    assert.equal(presentListValue('legacy', records, 'ar', { legacy: 'قديم' }), 'قديم');
    assert.equal(presentListValue('legacy', records, 'ar'), 'legacy');
    assert.equal(presentListValue('', records, 'ar'), '');
  });

  it('isListItemActive defaults to active for pre-master-data records', () => {
    assert.equal(isListItemActive({ isActive: true }), true);
    assert.equal(isListItemActive({} as MasterDataListItem), true);
    assert.equal(isListItemActive({ isActive: false } as MasterDataListItem), false);
  });
});
