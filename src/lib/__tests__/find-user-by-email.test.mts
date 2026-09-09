// ══════════════════════════════════════════════════════════════
//  findUserByEmail — targeted RTDB login lookup
//
//  Covers the indexed query (hit / miss / duplicate cap), the
//  transparent fallback to the legacy table scan when the deployed
//  RTDB rules are missing `".indexOn": ["email"]`, and propagation of
//  unrelated errors. The Firebase Admin DB is mocked at the
//  firebase-server boundary — no real database needed.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ─── Fake RTDB state ───────────────────────────────────────────
interface FakeRow {
  id: string;
  email: string;
  name?: string;
  password?: string;
}

const fake = {
  rows: [] as FakeRow[],
  indexError: false,
  otherError: null as Error | null,
  hangIndexed: false,
  lastQuery: null as { field: string; value: string; limit: number } | null,
  indexedGetCalls: 0,
  plainGetCalls: 0,
};

function resetFake(rows: FakeRow[]) {
  fake.rows = rows;
  fake.indexError = false;
  fake.otherError = null;
  fake.hangIndexed = false;
  fake.lastQuery = null;
  fake.indexedGetCalls = 0;
  fake.plainGetCalls = 0;
}

/** Snapshot shaped like firebase-admin RTDB snapshots. */
function makeSnapshot(obj: Record<string, unknown>) {
  return {
    exists: () => Object.keys(obj).length > 0,
    val: () => obj,
  };
}

/** Strips the synthetic id so the shape matches raw RTDB nodes. */
function stripId(row: FakeRow): Record<string, unknown> {
  const { id: _id, ...rest } = row;
  return rest;
}

const fakeDb = {
  ref(path: string) {
    assert.equal(path, 'arm_erp/users');
    return {
      orderByChild(field: string) {
        return {
          equalTo(value: string) {
            return {
              limitToFirst(limit: number) {
                return {
                  async get() {
                    fake.indexedGetCalls += 1;
                    fake.lastQuery = { field, value, limit };
                    if (fake.hangIndexed) return new Promise(() => {}); // never settles
                    if (fake.otherError) throw fake.otherError;
                    if (fake.indexError) {
                      throw new Error(
                        '[Error client] Index not defined. Consider using ".indexOn": "email"\n at /arm_erp/users'
                      );
                    }
                    const matches = fake.rows.filter((r) => r.email === value).slice(0, limit);
                    return makeSnapshot(Object.fromEntries(matches.map((r) => [r.id, stripId(r)])));
                  },
                };
              },
            };
          },
        };
      },
      // Plain full-node read — the getAll fallback path.
      async get() {
        fake.plainGetCalls += 1;
        return makeSnapshot(Object.fromEntries(fake.rows.map((r) => [r.id, stripId(r)])));
      },
    };
  },
};

mock.module('@/lib/firebase-server', {
  exports: {
    getAdminDb: () => fakeDb,
  },
});

const { findUserByEmail, invalidateCache } = await import('@/lib/db');

describe('findUserByEmail — targeted RTDB login lookup', () => {
  beforeEach(() => {
    invalidateCache(); // the fallback scan populates the table TTL cache
  });

  it('returns the matching user with id injected, using the normalized email in the query', async () => {
    resetFake([
      { id: 'u1', email: 'other@arm.com', password: 'h1' },
      { id: 'u2', email: 'admin@arm.com', password: 'h2', name: 'Admin' },
    ]);
    const user = await findUserByEmail<any>('  Admin@ARM.COM ');
    assert.equal(user.id, 'u2');
    assert.equal(user.email, 'admin@arm.com');
    assert.equal(user.password, 'h2');
    assert.deepEqual(fake.lastQuery, { field: 'email', value: 'admin@arm.com', limit: 2 });
    assert.equal(fake.plainGetCalls, 0); // no table scan happened
  });

  it('returns null for a miss without falling back to a scan', async () => {
    resetFake([{ id: 'u1', email: 'other@arm.com' }]);
    const user = await findUserByEmail('ghost@arm.com');
    assert.equal(user, null);
    assert.equal(fake.plainGetCalls, 0);
  });

  it('caps the indexed query at two records', async () => {
    resetFake([{ id: 'u1', email: 'a@arm.com' }, { id: 'u2', email: 'a@arm.com' }]);
    await findUserByEmail('a@arm.com');
    assert.equal(fake.lastQuery?.limit, 2);
  });

  it('falls back to the table scan when the index is missing, and still finds the user', async () => {
    resetFake([
      { id: 'u1', email: 'other@arm.com' },
      { id: 'u2', email: 'admin@arm.com', password: 'h2' },
    ]);
    fake.indexError = true;
    const user = await findUserByEmail<any>('admin@arm.com');
    assert.equal(user.id, 'u2'); // from the scan, id injected like getAll
    assert.equal(fake.plainGetCalls, 1);
  });

  it('falls back and returns null when the index is missing and no user matches', async () => {
    resetFake([{ id: 'u1', email: 'other@arm.com' }]);
    fake.indexError = true;
    assert.equal(await findUserByEmail('ghost@arm.com'), null);
  });

  it('falls back to the scan when the indexed query HANGS past the cap (proven path serves login)', async () => {
    resetFake([
      { id: 'u1', email: 'other@arm.com' },
      { id: 'u2', email: 'admin@arm.com', password: 'h2' },
    ]);
    fake.hangIndexed = true; // never resolves — the observed production failure
    const user = await findUserByEmail<any>('admin@arm.com', { queryTimeoutMs: 50 });
    assert.equal(user.id, 'u2'); // served by the scan fallback
    assert.equal(fake.plainGetCalls, 1);
  });

  it('falls back to the scan on a network error instead of failing login', async () => {
    resetFake([{ id: 'u1', email: 'admin@arm.com', password: 'h1' }]);
    fake.otherError = new Error('connection ECONNREFUSED');
    const user = await findUserByEmail<any>('admin@arm.com');
    assert.equal(user.id, 'u1');
    assert.equal(fake.plainGetCalls, 1);
  });

  it('falls back and returns null when the query fails and no user matches', async () => {
    resetFake([{ id: 'u1', email: 'other@arm.com' }]);
    fake.otherError = new Error('connection reset');
    assert.equal(await findUserByEmail('ghost@arm.com'), null);
  });
});
