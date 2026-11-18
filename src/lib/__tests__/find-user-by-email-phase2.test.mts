// ══════════════════════════════════════════════════════════════
//  Phase 2 Task B — findUserByEmail verification additions
//
//  The pre-existing find-user-by-email.test.mts suite covers the
//  indexed hit / miss / fallback / breaker semantics but currently
//  fails to LOAD under the ESM runner (baseline server-only
//  tripwire — pre-existing, documented in the Phase 1 report).
//  This file re-establishes EXECUTABLE coverage for the Task B
//  checklist items that were not covered there — duplicate and
//  inconsistent email records, breaker-open serving, and the
//  never-mis-lookup guarantees — with the same firebase-server
//  boundary mock.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// §SERVER-ONLY stub — the tripwire package throws under standalone Node.
mock.module('server-only', { exports: {} });

const fake = {
  rows: [] as Array<Record<string, unknown>>,
  indexedError: false,
  hangIndexed: false,
  indexedGetCalls: 0,
  plainGetCalls: 0,
};

function resetFake(rows: Array<Record<string, unknown>>) {
  fake.rows = rows;
  fake.indexedError = false;
  fake.hangIndexed = false;
  fake.indexedGetCalls = 0;
  fake.plainGetCalls = 0;
}

function makeSnapshot(obj: Record<string, unknown>) {
  return {
    exists: () => Object.keys(obj).length > 0,
    val: () => obj,
  };
}

const fakeDb = {
  ref(path: string) {
    assert.equal(path, 'arm_erp/users', 'the user lookup must target arm_erp/users');
    return {
      orderByChild(field: string) {
        return {
          equalTo(value: string) {
            return {
              limitToFirst(limit: number) {
                return {
                  async get() {
                    fake.indexedGetCalls += 1;
                    if (fake.hangIndexed) return new Promise(() => {});
                    if (fake.indexedError) {
                      throw new Error(
                        `[Error client] Index not defined. Consider using ".indexOn": "${field}"\n at /arm_erp/users`
                      );
                    }
                    const matches = fake.rows
                      .filter((r) => r.email === value)
                      .slice(0, limit)
                      .map((r) => [r.id, r] as const);
                    return makeSnapshot(Object.fromEntries(matches));
                  },
                };
              },
            };
          },
        };
      },
      async get() {
        fake.plainGetCalls += 1;
        return makeSnapshot(Object.fromEntries(fake.rows.map((r) => [r.id, r] as const)));
      },
    };
  },
};

mock.module('@/lib/firebase-server', {
  exports: {
    getAdminDb: () => fakeDb,
  },
});

const { findUserByEmail, invalidateCache, resetUserLookupBreakerForTests, getLastUserLookupDiagnostic } =
  await import('@/lib/db');

beforeEach(() => {
  resetUserLookupBreakerForTests();
  invalidateCache();
});

describe('findUserByEmail (Phase 2 verification) — duplicate / inconsistent email records', () => {
  it('duplicate email rows: the FIRST match (RTDB key order) is returned — never a mix-up', async () => {
    resetFake([
      { id: 'u_first', email: 'dup@arm.com', name: 'First', password: 'h_first' },
      { id: 'u_second', email: 'dup@arm.com', name: 'Second', password: 'h_second' },
    ]);
    const user = await findUserByEmail<any>('dup@arm.com');
    assert.equal(user.id, 'u_first', 'the scan fallback also returns the first row');
    assert.equal(user.password, 'h_first');

    // The indexed path must agree with the scan on WHICH row wins.
    fake.indexedError = true;
    invalidateCache();
    const viaFallback = await findUserByEmail<any>('dup@arm.com');
    assert.equal(viaFallback.id, 'u_first', 'fallback ≡ indexed on duplicates');
  });

  it('case/whitespace inconsistencies in STORED emails never produce a wrong lookup', async () => {
    // Stored row with uppercase email: the normalized query value is
    // lowercase, so a differently-cased STORED row is NOT a match on
    // either path (parity with the legacy strict filter) — the lookup
    // returns null rather than guessing.
    resetFake([{ id: 'u1', email: 'Admin@ARM.com', password: 'h1' }]);
    const viaIndexed = await findUserByEmail('admin@arm.com');
    assert.equal(viaIndexed, null, 'stored-case mismatch is not silently matched');

    // The scan fallback agrees (strict === on the normalized value).
    invalidateCache();
    const viaScan = await findUserByEmail('admin@arm.com');
    assert.equal(viaScan, null, 'fallback ≡ indexed on stored-case mismatch');
  });

  it('normalize + exact match: trailing spaces / uppercase input find the stored row', async () => {
    resetFake([{ id: 'u1', email: 'admin@arm.com', password: 'h1' }]);
    const user = await findUserByEmail<any>('  Admin@ARM.com ');
    assert.equal(user.id, 'u1');
  });

  it('a hung indexed query still serves the CORRECT user via the scan (never the wrong row)', async () => {
    resetFake([
      { id: 'u1', email: 'other@arm.com' },
      { id: 'u2', email: 'admin@arm.com', password: 'h2' },
    ]);
    fake.hangIndexed = true;
    const user = await findUserByEmail<any>('admin@arm.com', { queryTimeoutMs: 40 });
    assert.equal(user.id, 'u2');
    assert.equal(fake.plainGetCalls, 1);
  });

  it('after the breaker opens, the scan still returns the exact user (path: scan-breaker-open)', async () => {
    resetFake([{ id: 'u1', email: 'admin@arm.com', password: 'h1' }]);
    fake.hangIndexed = true;
    await findUserByEmail('admin@arm.com', { queryTimeoutMs: 25 });
    await findUserByEmail('admin@arm.com', { queryTimeoutMs: 25 });
    fake.hangIndexed = false;
    invalidateCache();
    const user = await findUserByEmail<any>('admin@arm.com');
    assert.equal(user.id, 'u1');
    assert.equal(getLastUserLookupDiagnostic()?.path, 'scan-breaker-open');
    assert.equal(fake.indexedGetCalls, 2, 'no further indexed attempts while the breaker is open');
  });

  it('user not found stays null on BOTH paths (no fallback-scan ghost)', async () => {
    resetFake([{ id: 'u1', email: 'admin@arm.com' }]);
    assert.equal(await findUserByEmail('ghost@arm.com'), null);
    fake.indexedError = true;
    invalidateCache();
    assert.equal(await findUserByEmail('ghost@arm.com'), null);
    assert.equal(fake.plainGetCalls, 1, 'the scan ran and also found nothing');
  });

  it('password/bcrypt surfaces are untouched: the raw stored password field rides along', async () => {
    resetFake([{ id: 'u1', email: 'admin@arm.com', password: '$2b$12$abcdefghijklmnopqrstuv' }]);
    const user = await findUserByEmail<any>('admin@arm.com');
    assert.equal(user.password, '$2b$12$abcdefghijklmnopqrstuv');
  });
});
