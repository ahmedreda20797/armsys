// ══════════════════════════════════════════════════════════════
//  §SESSION-REVOKE-GUARD (Phase 2 Task A) — revokeAllUserRefreshTokens
//
//  The Phase 1 audit flagged this function as an UNGUARDED
//  orderByChild('userId') query — the same query shape observed to
//  hang indefinitely on this network. The Phase 2 guard adds: a hard
//  timeout, the project's circuit-breaker pattern, a
//  correctness-preserving full-scan fallback, orphaned-query
//  draining, concurrent-duplicate protection and EXPLICIT failure
//  handling (a timeout/failure can never be reported as a successful
//  revocation while valid refresh tokens remain active).
//
//  The Firebase Admin DB is mocked at the firebase-server boundary —
//  no real database, no real tokens.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// §SERVER-ONLY stub (same doctrine as db-single-flight.test.mts).
mock.module('server-only', { exports: {} });

// auth.ts refuses to start without a JWT secret — set it BEFORE the
// module under test is imported.
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-value-at-least-32-characters-long!!';

// ─── Fake RTDB state ───────────────────────────────────────────
const fake = {
  sessions: new Map<string, Record<string, unknown>>(), // tokenHash → session record
  indexedError: false,
  hangIndexed: false,
  failPlainGet: false,
  failUpdate: false,
  queryDelayMs: 0,
  indexedGetCalls: 0,
  plainGetCalls: 0,
  indexedRows: 0,
  plainRows: 0,
  updateCalls: 0,
  lastUpdate: null as Record<string, unknown> | null,
  removed: [] as string[],
};

function resetFake() {
  fake.sessions = new Map();
  fake.indexedError = false;
  fake.hangIndexed = false;
  fake.failPlainGet = false;
  fake.failUpdate = false;
  fake.queryDelayMs = 0;
  fake.indexedGetCalls = 0;
  fake.plainGetCalls = 0;
  fake.indexedRows = 0;
  fake.plainRows = 0;
  fake.updateCalls = 0;
  fake.lastUpdate = null;
  fake.removed = [];
}

function seedSessions(rows: Record<string, { userId: string; expiresAt?: number }>) {
  for (const [key, val] of Object.entries(rows)) fake.sessions.set(key, val);
}

function sessionKeysOf(userId: string): string[] {
  return [...fake.sessions.entries()]
    .filter(([, val]) => val.userId === userId)
    .map(([key]) => key);
}

function makeSnapshot(obj: Record<string, unknown> | null) {
  return {
    exists: () => obj !== null && Object.keys(obj).length > 0,
    val: () => obj,
    forEach(cb: (child: { key: string; val: () => unknown }) => void) {
      if (!obj) return false;
      for (const [key, val] of Object.entries(obj)) cb({ key, val: () => val });
      return true;
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fakeDb = {
  ref(path: string) {
    if (path !== 'arm_erp/sessions' && !path.startsWith('arm_erp/sessions/')) {
      throw new Error(`unexpected ref path: ${path}`);
    }
    const recordId = path.startsWith('arm_erp/sessions/') ? path.slice('arm_erp/sessions/'.length) : null;

    const sessionsNode = () => Object.fromEntries(fake.sessions);

    return {
      // Full-node read (the scan fallback) or a point-read by hash.
      async get() {
        if (recordId) {
          const rec = fake.sessions.get(recordId) ?? null;
          return makeSnapshot(rec ? { [recordId]: rec } : null);
        }
        fake.plainGetCalls += 1;
        fake.plainRows += fake.sessions.size;
        if (fake.queryDelayMs > 0) await sleep(fake.queryDelayMs);
        if (fake.failPlainGet) throw new Error('RTDB unavailable');
        return makeSnapshot(sessionsNode());
      },
      async set(record: Record<string, unknown>) {
        fake.sessions.set(recordId!, record);
      },
      async remove() {
        fake.sessions.delete(recordId!);
        fake.removed.push(recordId!);
      },
      // The revocation write: multi-path null update.
      async update(patch: Record<string, unknown>) {
        fake.updateCalls += 1;
        fake.lastUpdate = patch;
        if (fake.failUpdate) throw new Error('update failed');
        for (const [key, value] of Object.entries(patch)) {
          if (value === null) fake.sessions.delete(key);
          else fake.sessions.set(key, { ...(fake.sessions.get(key) as Record<string, unknown>), ...value });
        }
      },
      // Indexed query (orderByChild('userId').equalTo(userId)).
      orderByChild(field: string) {
        return {
          equalTo(value: string) {
            return {
              async get() {
                fake.indexedGetCalls += 1;
                if (fake.hangIndexed) return new Promise(() => {}); // never settles
                if (fake.queryDelayMs > 0) await sleep(fake.queryDelayMs);
                if (fake.indexedError) {
                  throw new Error(
                    `[Error client] Index not defined. Consider using ".indexOn": "${field}"\n at /arm_erp/sessions`
                  );
                }
                const matches = Object.entries(sessionsNode())
                  .filter(([, val]) => (val as Record<string, unknown>)?.[field] === value)
                  .map(([key, val]) => [key, val] as const);
                fake.indexedRows += matches.length;
                return makeSnapshot(Object.fromEntries(matches));
              },
            };
          },
        };
      },
    };
  },
};

mock.module('@/lib/firebase-server', {
  exports: {
    getAdminDb: () => fakeDb,
  },
});

const { revokeAllUserRefreshTokens, resetSessionRevokeStateForTests } = await import('@/lib/auth');

beforeEach(() => {
  resetFake();
  resetSessionRevokeStateForTests();
});

// ─── Standard fixture: two users with live sessions ──
const SEED = {
  ses_a1: { userId: 'user_1', expiresAt: Date.now() + 86_400_000 },
  ses_a2: { userId: 'user_1', expiresAt: Date.now() + 86_400_000 },
  ses_b1: { userId: 'user_2', expiresAt: Date.now() + 86_400_000 },
  ses_b2: { userId: 'user_2', expiresAt: Date.now() - 1 }, // expired, different user
};

describe('§SESSION-REVOKE-GUARD — correct revocation behavior', () => {
  it('successful indexed query: revokes ONLY the target user’s sessions', async () => {
    seedSessions(SEED);
    await revokeAllUserRefreshTokens('user_1');
    assert.deepEqual(sessionKeysOf('user_1'), [], 'all user_1 sessions revoked');
    assert.deepEqual(sessionKeysOf('user_2').sort(), ['ses_b1', 'ses_b2'], 'other users untouched');
    assert.equal(fake.updateCalls, 1, 'one multi-path null update');
    assert.deepEqual(Object.keys(fake.lastUpdate!).sort(), ['ses_a1', 'ses_a2']);
    assert.equal(fake.plainGetCalls, 0, 'no scan happened');
    assert.equal(fake.indexedGetCalls, 1);
  });

  it('empty result (no sessions for the user): resolves without any write', async () => {
    seedSessions(SEED);
    await revokeAllUserRefreshTokens('user_ghost');
    assert.equal(fake.updateCalls, 0, 'nothing to revoke — no update issued');
    assert.equal(fake.plainGetCalls, 0);
  });

  it('revocation targets every matching session regardless of expiry (legacy parity)', async () => {
    seedSessions({
      ses_x1: { userId: 'user_x', expiresAt: Date.now() + 86_400_000 },
      ses_x2: { userId: 'user_x', expiresAt: Date.now() - 1 }, // expired session of the SAME user
    });
    await revokeAllUserRefreshTokens('user_x');
    assert.deepEqual(sessionKeysOf('user_x'), [], 'expired matches revoked too (unchanged legacy behavior)');
  });
});

describe('§SESSION-REVOKE-GUARD — fallback correctness', () => {
  it('missing index → the full-scan fallback finds and revokes the same set', async () => {
    seedSessions(SEED);
    fake.indexedError = true;
    await revokeAllUserRefreshTokens('user_1');
    assert.deepEqual(sessionKeysOf('user_1'), []);
    assert.deepEqual(sessionKeysOf('user_2').sort(), ['ses_b1', 'ses_b2']);
    assert.equal(fake.plainGetCalls, 1, 'the scan served the revocation');
    assert.equal(fake.updateCalls, 1);
  });

  it('successful fallback: a TIMEOUT still revokes (timeout ≠ skipped revocation)', async () => {
    seedSessions(SEED);
    fake.hangIndexed = true;
    await revokeAllUserRefreshTokens('user_1');
    assert.deepEqual(sessionKeysOf('user_1'), [], 'the fallback scan revoked the sessions');
    assert.deepEqual(sessionKeysOf('user_2').sort(), ['ses_b1', 'ses_b2']);
  });

  it('FAILED fallback (both indexed and scan broken) REJECTS — never a false success', async () => {
    seedSessions(SEED);
    fake.indexedError = true;
    fake.failPlainGet = true;
    await assert.rejects(
      () => revokeAllUserRefreshTokens('user_1'),
      /RTDB unavailable/,
      'the caller must observe the failure — tokens were NOT revoked',
    );
    assert.deepEqual(sessionKeysOf('user_1').sort(), ['ses_a1', 'ses_a2'], 'sessions survive');
    assert.equal(fake.updateCalls, 0, 'no revocation write was attempted on an unknown set');
  });

  it('a failing revocation UPDATE propagates (explicit failure)', async () => {
    seedSessions(SEED);
    fake.failUpdate = true;
    await assert.rejects(() => revokeAllUserRefreshTokens('user_1'), /update failed/);
    assert.deepEqual(sessionKeysOf('user_1').sort(), ['ses_a1', 'ses_a2'], 'sessions survive');
  });
});

describe('§SESSION-REVOKE-GUARD — circuit breaker', () => {
  it('opens after TWO consecutive timeouts; later revocations skip the hung query', async () => {
    seedSessions(SEED);
    fake.hangIndexed = true;
    await revokeAllUserRefreshTokens('user_1');
    await revokeAllUserRefreshTokens('user_1');
    const indexedCallsAfterHangs = fake.indexedGetCalls;
    assert.ok(indexedCallsAfterHangs >= 2);

    fake.hangIndexed = false;
    resetFake();
    seedSessions(SEED);
    await revokeAllUserRefreshTokens('user_1');
    assert.equal(fake.indexedGetCalls, 0, 'breaker open — the hung query was skipped');
    assert.equal(fake.plainGetCalls, 1, 'the scan served directly');
    assert.deepEqual(sessionKeysOf('user_1'), []);
  });

  it('a single timeout does not open the breaker', async () => {
    seedSessions(SEED);
    fake.hangIndexed = true;
    await revokeAllUserRefreshTokens('user_1');
    fake.hangIndexed = false;
    resetFake();
    seedSessions(SEED);
    await revokeAllUserRefreshTokens('user_1');
    assert.equal(fake.indexedGetCalls, 1, 'the indexed path is still being tried');
  });

  it('a fast indexed ERROR does not open the breaker', async () => {
    seedSessions(SEED);
    fake.indexedError = true;
    await revokeAllUserRefreshTokens('user_1');
    await revokeAllUserRefreshTokens('user_1');
    assert.equal(fake.indexedGetCalls, 2, 'errors are not the hang signature');
  });
});

describe('§SESSION-REVOKE-GUARD — delayed original + duplicate protection', () => {
  it('an orphaned hanging query never produces a second revocation or a crash', async () => {
    seedSessions(SEED);
    fake.hangIndexed = true;
    await revokeAllUserRefreshTokens('user_1'); // fallback revoked already
    assert.deepEqual(sessionKeysOf('user_1'), []);
    // The orphaned query never settles — the drain handler keeps it
    // inert. The test completing without an unhandled rejection IS
    // the assertion.
  });

  it('concurrent revocations for the SAME user share one operation', async () => {
    seedSessions(SEED);
    await Promise.all([
      revokeAllUserRefreshTokens('user_1'),
      revokeAllUserRefreshTokens('user_1'),
      revokeAllUserRefreshTokens('user_1'),
    ]);
    assert.equal(fake.indexedGetCalls, 1, 'one lookup, not three');
    assert.equal(fake.updateCalls, 1, 'one null-update, not three');
    assert.deepEqual(sessionKeysOf('user_1'), []);
  });

  it('concurrent revocations for DIFFERENT users run independently', async () => {
    seedSessions(SEED);
    await Promise.all([
      revokeAllUserRefreshTokens('user_1'),
      revokeAllUserRefreshTokens('user_2'),
    ]);
    assert.deepEqual(sessionKeysOf('user_1'), []);
    assert.deepEqual(sessionKeysOf('user_2'), [], 'user_2 sessions revoked by its own call');
    assert.equal(fake.indexedGetCalls, 2, 'two distinct lookups');
  });

  it('[measure] sessions.userId lookup: legacy full scan vs indexed query (rows downloaded)', async () => {
    // 20 users × 10 sessions = 200 rows; the target user owns 10.
    const seeded: Record<string, { userId: string; expiresAt?: number }> = {};
    for (let u = 0; u < 20; u++) {
      for (let s = 0; s < 10; s++) {
        seeded[`ses_${u}_${s}`] = { userId: `user_${String(u).padStart(2, '0')}`, expiresAt: Date.now() + 86_400_000 };
      }
    }
    seedSessions(seeded);

    const before = { indexed: fake.indexedRows, plain: fake.plainRows };
    fake.indexedError = true; // force the legacy computation (full scan)
    await revokeAllUserRefreshTokens('user_07');
    const legacyRows = fake.plainRows - before.plain;

    resetFake();
    seedSessions(seeded);
    await revokeAllUserRefreshTokens('user_07');
    const indexedRows = fake.indexedRows;

    console.log(`[measure] sessions.userId: BEFORE 1 full scan, ${legacyRows} rows downloaded → AFTER 1 indexed query, ${indexedRows} rows downloaded`);
    assert.equal(indexedRows, 10, 'one user = 10 session rows');
    assert.equal(legacyRows, 200, 'the scan downloads the whole table');
  });

  it('a FAILED revocation frees its slot — the next caller retries fresh', async () => {
    seedSessions(SEED);
    fake.indexedError = true;
    fake.failPlainGet = true;
    await assert.rejects(() => revokeAllUserRefreshTokens('user_1'));

    // Retry now succeeds (the failure is not joined or memoized).
    resetFake();
    seedSessions(SEED);
    await revokeAllUserRefreshTokens('user_1');
    assert.deepEqual(sessionKeysOf('user_1'), [], 'the retried revocation succeeded');
  });
});
