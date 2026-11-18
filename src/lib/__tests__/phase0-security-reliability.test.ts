// ══════════════════════════════════════════════════════════════
//  Phase 0 — Security & Reliability regression tests
//
//  Covers the 2026-11-17 audit findings implemented in Phase 0:
//    A (S-4)  database.rules.json — deny-all RTDB with the single
//             sanctioned client read (erp/notifications broadcast).
//    B (S-3)  middleware CSP — production nonce + strict-dynamic,
//             no unsafe-eval; dev allowances preserved.
//    C (K-1)  avgApprovalHours computed from approval history
//             (null when not computable — never a silent zero).
//    D (K-2)  top/bottom leaderboards disjoint for small workforces.
//    E (K-3)  rolling-average baseline is SELF-INCLUSIVE by written
//             contract — behavior locked by tests.
//
//  Run: npm test (tsx --test via scripts/run-tests.mjs)
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  computeApprovalStats,
  approvalDurationHoursOf,
  computeMonthSnapshot,
  computeTrend,
} from '@/lib/metrics/kpiMetrics';
import type { ObservationLike } from '@/lib/metrics/kpiMetrics';
import type {
  KpiSettings,
  MonthSnapshot,
  ApprovalEvent,
} from '@/types/quality-kpi';
import { middleware } from '@/middleware';

// ── Shared fixtures ──

const SETTINGS: KpiSettings = {
  id: 'singleton',
  schemaVersion: 1,
  defaultScore: 100,
  minimumScore: 0,
  allowBonus: false,
  maximumBonus: 0,
  approvalRequired: true,
  leaderboardEnabled: true,
  closeMonthLock: true,
  trendCalculation: 'rollingAverage',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

/** Observation shape including the optional §PHASE0-K1 duration source. */
type ObsWithDurationSource = ObservationLike & {
  approvalHistory?: ApprovalEvent[];
  createdAt?: string;
};

function makeObs(overrides: Partial<ObsWithDurationSource> = {}): ObsWithDurationSource {
  return {
    id: 'obs_1',
    employeeId: 'emp_1',
    month: '2026-08',
    applyPointDeduction: true,
    points: 5,
    isBonus: false,
    approvalStatus: 'approved',
    categoryId: 'cat_late',
    categoryWeight: 1,
    status: 'closed',
    ...overrides,
  };
}

function event(action: ApprovalEvent['action'], timestamp: string): ApprovalEvent {
  return { action, actorId: 'u1', actorName: 'مُعتمِد', timestamp, notes: '' };
}

/** One scored observation per employee (distinct deduction → distinct score). */
function scoredObservationsFor(count: number, pointsOf?: (index: number) => number): ObservationLike[] {
  return Array.from({ length: count }, (_, i) =>
    makeObs({
      id: `obs_${i + 1}`,
      employeeId: `emp_${String(i + 1).padStart(3, '0')}`,
      points: pointsOf ? pointsOf(i) : i + 1,
    }),
  );
}

function employeesMapFor(count: number) {
  const map = new Map<string, { id: string; name: string; department: string | null; position: string | null }>();
  for (let i = 1; i <= count; i++) {
    const id = `emp_${String(i).padStart(3, '0')}`;
    map.set(id, { id, name: `موظف ${i}`, department: 'قسم', position: 'موظف' });
  }
  return map;
}

function snapshotWithScore(score: number): MonthSnapshot {
  return {
    employeeScores: {
      e1: {
        employeeSnapshot: { employeeId: 'e1', employeeName: 'موظف', departmentId: 'د', departmentName: 'د', position: '', supervisorId: null },
        score,
        deductionPoints: 0,
        bonusPoints: 0,
        weightedPoints: 0,
        observationCount: 0,
        approvedCount: 0,
        pendingCount: 0,
        rejectedCount: 0,
        categoryTotals: {},
        rank: 1,
        dept: 'د',
      },
    },
  } as unknown as MonthSnapshot;
}

function fakeNextRequest(pathname: string) {
  return {
    headers: new Headers(),
    method: 'GET',
    nextUrl: new URL(`http://localhost${pathname}`),
  } as unknown as Parameters<typeof middleware>[0];
}

// ══════════════════════════════════════════════════════════════
//  A — RTDB security rules (S-4)
//
//  §PHASE0-RTDB-RULES (final correction): RTDB rules CASCADE from
//  parent to descendant — a child rule can never re-grant access a
//  parent denied. The interim design (root deny + read carve-out on
//  erp/notifications) could therefore never work; worse, the direct
//  client listener it served had NO recipient filtering, exposing
//  every employee's notifications to any browser client. The final
//  model: FULLY STATIC DENY-ALL rules + removal of the direct client
//  listener — notification delivery flows exclusively through the
//  authenticated /api/notifications poll (server-side recipient
//  filtering). The Firebase Admin SDK bypasses rules entirely, so
//  server-mediated operations are unaffected.
// ══════════════════════════════════════════════════════════════

describe('Phase 0 A — database.rules.json (S-4, corrected)', () => {
  const ROOT = process.cwd();
  const rulesPath = join(ROOT, 'database.rules.json');

  /** Effective read/write decision for a path: rules cascade, so the
   *  FIRST truthy/falsey `.read`/`.write` from the root wins and
   *  children cannot override it. Mirrors the RTDB evaluation model. */
  function effective(ruleSet: Record<string, unknown>, segments: string[]): { read: boolean; write: boolean } {
    let read: boolean | null = null;
    let write: boolean | null = null;
    let node: Record<string, unknown> | undefined = ruleSet;
    for (const segment of ['', ...segments]) {
      if (!node) break;
      if (typeof node['.read'] === 'boolean' && read === null) read = node['.read'] as boolean;
      if (typeof node['.write'] === 'boolean' && write === null) write = node['.write'] as boolean;
      node = segment === '' ? node : (node[segment] as Record<string, unknown> | undefined);
    }
    return { read: read ?? false, write: write ?? false };
  }

  it('rules file exists and firebase.json references it', () => {
    assert.equal(existsSync(rulesPath), true, 'database.rules.json must exist at the repo root');
    const firebaseJson = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
    assert.equal(firebaseJson.database?.rules, 'database.rules.json');
  });

  it('business data (arm_erp) cannot be READ by browser clients — at any depth', () => {
    const rules = JSON.parse(readFileSync(rulesPath, 'utf8')).rules;
    assert.equal(rules['.read'], false);
    assert.equal(rules.arm_erp?.['.read'], false);
    for (const path of [['arm_erp'], ['arm_erp', 'employees'], ['arm_erp', 'qualityObservations'], ['arm_erp', 'notifications'], ['arm_erp', 'hrDeductions']]) {
      assert.equal(effective(rules, path).read, false, `${path.join('/')} must not be readable`);
    }
  });

  it('business data (arm_erp) cannot be WRITTEN by browser clients — at any depth', () => {
    const rules = JSON.parse(readFileSync(rulesPath, 'utf8')).rules;
    assert.equal(rules['.write'], false);
    assert.equal(rules.arm_erp?.['.write'], false);
    for (const path of [['arm_erp'], ['arm_erp', 'employees'], ['arm_erp', 'attendance'], ['arm_erp', 'monthSnapshots']]) {
      assert.equal(effective(rules, path).write, false, `${path.join('/')} must not be writable`);
    }
  });

  it('NO unintended path is publicly readable — the file contains zero read grants', () => {
    const rules = JSON.parse(readFileSync(rulesPath, 'utf8')).rules;
    // Cascade-correct check: a read grant anywhere would leak. Assert
    // no node at any depth carries a truthy `.read` (string rules or
    // boolean true are both grants).
    const grants: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === '.read') {
          if (value === true || (typeof value === 'string' && value.trim() !== 'false')) {
            grants.push(path || '<root>');
          }
        } else {
          walk(value, path ? `${path}/${key}` : key);
        }
      }
    };
    walk(rules, '');
    assert.deepEqual(grants, [], 'no path may grant client read access');
    // erp/notifications specifically: read DENIED (the interim
    // carve-out is gone — delivery moved to the authenticated API).
    assert.equal(effective(rules, ['erp', 'notifications']).read, false);
  });

  it('ALL client-side writes are denied (no write grants anywhere)', () => {
    const rules = JSON.parse(readFileSync(rulesPath, 'utf8')).rules;
    const grants: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === '.write' && value !== false) grants.push(path || '<root>');
        else if (key !== '.read') walk(value, path ? `${path}/${key}` : key);
      }
    };
    walk(rules, '');
    assert.deepEqual(grants, [], 'no path may grant client write access');
  });

  it('cascade semantics: parent denial CANNOT be overridden by any child rule', () => {
    // Regression for the original defect: prove the file itself never
    // relies on (broken) child-level exceptions, and that under the
    // cascade model the effective decision for EVERY declared path is
    // the root denial. A hypothetical erp/notifications/.read: true
    // under a root .read: false would evaluate to FALSE — the file
    // must contain no such dead grants (asserted above) and the
    // effective evaluation for the notification path is deny.
    const rules = JSON.parse(readFileSync(rulesPath, 'utf8')).rules;
    for (const path of [['erp'], ['erp', 'notifications'], ['erp', 'notifications', 'abc123'], ['arm_erp', 'users']]) {
      const decision = effective(rules, path);
      assert.equal(decision.read, false, `${path.join('/')} effective read must be deny`);
      assert.equal(decision.write, false, `${path.join('/')} effective write must be deny`);
    }
  });

  it('rules are pure static denies — nothing for the Admin SDK path to interact with', () => {
    // The Firebase Admin SDK bypasses security rules entirely, so
    // server-mediated operations (arm_erp reads/writes via
    // firebase-admin) are unaffected by construction. As a guard, the
    // rules file must not contain auth/data/root expressions that
    // would ever conditionally allow CLIENT access.
    const raw = readFileSync(rulesPath, 'utf8');
    assert.ok(!raw.includes('auth.'), 'no auth-based grants');
    assert.ok(!raw.includes('data.'), 'no data-based grants');
    assert.ok(!raw.includes('root.'), 'no root-based grants');
    assert.ok(!raw.includes('true'), 'only explicit false denials');
  });

  it('notification delivery has NO direct client RTDB access (authenticated poll only)', () => {
    // §PHASE0-RTDB-RULES — the browser must never read the RTDB
    // directly. The notification context must not import the RTDB
    // client SDK or open listeners; delivery is /api/notifications
    // (JWT-authenticated, server-side recipient filtering).
    const contextSource = readFileSync(join(ROOT, 'src', 'contexts', 'NotificationContext.tsx'), 'utf8');
    assert.ok(!contextSource.includes("from 'firebase/database'"), 'no RTDB client import');
    assert.ok(!contextSource.includes('onChildAdded'), 'no RTDB listener');
    assert.ok(!contextSource.includes('initializeFirebaseClient'), 'no client SDK init');
    assert.ok(contextSource.includes('/api/notifications'), 'delivery via the authenticated API');
  });
});

// ══════════════════════════════════════════════════════════════
//  B — CSP hardening (S-3)
// ══════════════════════════════════════════════════════════════

describe('Phase 0 B — middleware CSP (S-3)', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  // Next.js types NODE_ENV as read-only; tests legitimately flip the
  // runtime value the middleware reads.
  const setNodeEnv = (value: string) => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = value;
  };

  function scriptSrcOf(csp: string): string {
    const directive = csp.split(';').find((d) => d.trim().startsWith('script-src'));
    assert.ok(directive, 'CSP must contain a script-src directive');
    return directive!;
  }

  it('production CSP: nonce + strict-dynamic, NO unsafe-eval / unsafe-inline in script-src', () => {
    try {
      setNodeEnv('production');
      const res = middleware(fakeNextRequest('/'));
      const csp = res.headers.get('Content-Security-Policy') ?? '';
      const scriptSrc = scriptSrcOf(csp);
      assert.match(scriptSrc, /'nonce-[^']+'/);
      assert.match(scriptSrc, /'strict-dynamic'/);
      assert.ok(!scriptSrc.includes('unsafe-eval'), 'production must not allow unsafe-eval');
      assert.ok(!scriptSrc.includes('unsafe-inline'), 'production must not allow unsafe-inline scripts');
      // Nonce is per-request: two requests never share one.
      const csp2 = middleware(fakeNextRequest('/')).headers.get('Content-Security-Policy') ?? '';
      const nonce1 = scriptSrcOf(csp).match(/'nonce-([^']+)'/)![1];
      const nonce2 = scriptSrcOf(csp2).match(/'nonce-([^']+)'/)![1];
      assert.notEqual(nonce1, nonce2);
    } finally {
      setNodeEnv(ORIGINAL_NODE_ENV ?? 'test');
    }
  });

  // §CSP-ORDER (production CSP recovery) — the CSP/nonce must be
  // snapshotted into the request headers BEFORE NextResponse.next()
  // is constructed. Next.js forwards the init's request headers to
  // the SSR renderer as `x-middleware-request-*` (its renderer nonces
  // its scripts from that request CSP), and the middleware contract
  // is observable through exactly those headers on the response.
  // Regression for the production failure: the CSP was set on the
  // Headers object AFTER the constructor call, so the renderer never
  // received it and every script was emitted WITHOUT a nonce.
  it('middleware forwards the CSP + nonce to the SSR renderer on the REQUEST headers', () => {
    try {
      setNodeEnv('production');
      const res = middleware(fakeNextRequest('/'));
      const responseCsp = res.headers.get('Content-Security-Policy') ?? '';
      assert.ok(responseCsp.includes("'strict-dynamic'"), 'fixture sanity: production CSP');

      const forwardedCsp = res.headers.get('x-middleware-request-content-security-policy');
      assert.ok(forwardedCsp, 'the CSP must travel on the request headers (renderer nonce source)');
      assert.equal(
        forwardedCsp,
        responseCsp,
        'the forwarded request CSP must be byte-identical to the enforced response CSP',
      );

      const responseNonce = scriptSrcOf(responseCsp).match(/'nonce-([^']+)'/)![1];
      const requestNonce = scriptSrcOf(forwardedCsp!).match(/'nonce-([^']+)'/)![1];
      assert.equal(requestNonce, responseNonce, 'the renderer nonce and the enforced nonce must be identical');

      // The nonce must be independently available to server components
      // (the root layout reads it for the next-themes boot script).
      const forwardedNonceHeader = res.headers.get('x-middleware-request-x-nonce');
      assert.equal(forwardedNonceHeader, responseNonce);
    } finally {
      setNodeEnv(ORIGINAL_NODE_ENV ?? 'test');
    }
  });

  it('production CSP preserves the other security directives', () => {
    try {
      setNodeEnv('production');
      const csp = middleware(fakeNextRequest('/')).headers.get('Content-Security-Policy') ?? '';
      assert.match(csp, /default-src 'self'/);
      // style-src keeps unsafe-inline (documented: Next/framer-motion runtime styles)
      assert.match(csp, /style-src 'self' 'unsafe-inline'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /form-action 'self'/);
      assert.match(csp, /base-uri 'self'/);
      assert.match(csp, /img-src [^;]*firebasestorage\.googleapis\.com/);
      assert.match(csp, /connect-src [^;]*firebasedatabase\.app/);
    } finally {
      setNodeEnv(ORIGINAL_NODE_ENV ?? 'test');
    }
  });

  it('development CSP keeps HMR allowances (unsafe-eval) and still carries the nonce', () => {
    try {
      setNodeEnv('development');
      const csp = middleware(fakeNextRequest('/')).headers.get('Content-Security-Policy') ?? '';
      const scriptSrc = scriptSrcOf(csp);
      assert.match(scriptSrc, /'nonce-[^']+'/);
      assert.ok(scriptSrc.includes('unsafe-eval'), 'dev HMR needs eval');
    } finally {
      setNodeEnv(ORIGINAL_NODE_ENV ?? 'test');
    }
  });

  it('other security headers remain set', () => {
    const res = middleware(fakeNextRequest('/'));
    assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(res.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  });

  it('API authentication gate unchanged: missing Bearer → 401', () => {
    const res = middleware(fakeNextRequest('/api/kpi-reports/employee'));
    assert.equal(res.status, 401);
  });
});

// ══════════════════════════════════════════════════════════════
//  C — avgApprovalHours (K-1)
// ══════════════════════════════════════════════════════════════

describe('Phase 0 C — approvalDurationHoursOf (K-1)', () => {
  it('valid submit→approve span returns hours', () => {
    const hours = approvalDurationHoursOf(
      [event('submit', '2026-08-01T10:00:00.000Z'), event('approve', '2026-08-01T12:00:00.000Z')],
    );
    assert.equal(hours, 2);
  });

  it('uses the LAST approve and LAST submit (reopen + re-approve cycle)', () => {
    const hours = approvalDurationHoursOf([
      event('submit', '2026-08-01T10:00:00.000Z'),
      event('approve', '2026-08-01T11:00:00.000Z'),
      event('reopen', '2026-08-02T09:00:00.000Z'),
      event('submit', '2026-08-02T10:00:00.000Z'),
      event('approve', '2026-08-02T13:00:00.000Z'),
    ]);
    assert.equal(hours, 3);
  });

  it('falls back to createdAt for legacy records without a submit event', () => {
    const hours = approvalDurationHoursOf(
      [event('approve', '2026-08-01T14:00:00.000Z')],
      '2026-08-01T12:30:00.000Z',
    );
    assert.equal(hours, 1.5);
  });

  it('missing history and no createdAt → null (never guessed)', () => {
    assert.equal(approvalDurationHoursOf(undefined), null);
    assert.equal(approvalDurationHoursOf([]), null);
    assert.equal(approvalDurationHoursOf(undefined, undefined), null);
  });

  it('invalid/unparseable timestamps are excluded', () => {
    assert.equal(approvalDurationHoursOf([event('submit', 'not-a-date'), event('approve', '2026-08-01T12:00:00.000Z')]), null);
    assert.equal(approvalDurationHoursOf([event('submit', '2026-08-01T10:00:00.000Z'), event('approve', '')]), null);
  });

  it('negative duration (approve before submit — anomalous history) → null', () => {
    assert.equal(
      approvalDurationHoursOf([event('submit', '2026-08-01T12:00:00.000Z'), event('approve', '2026-08-01T10:00:00.000Z')]),
      null,
    );
  });

  it('zero-duration (same-instant approval) is legitimate', () => {
    const ts = '2026-08-01T10:00:00.000Z';
    assert.equal(approvalDurationHoursOf([event('submit', ts), event('approve', ts)]), 0);
  });
});

describe('Phase 0 C — computeApprovalStats average (K-1)', () => {
  const history = (submitIso: string, approveIso: string) => [event('submit', submitIso), event('approve', approveIso)];

  it('single eligible approval → its duration', () => {
    const stats = computeApprovalStats([
      { ...makeObs(), approvalHistory: history('2026-08-01T10:00:00.000Z', '2026-08-01T13:00:00.000Z') },
    ]);
    assert.equal(stats.approved, 1);
    assert.equal(stats.avgApprovalHours, 3);
  });

  it('multiple approvals → mean rounded to 1 decimal, invalid excluded', () => {
    const stats = computeApprovalStats([
      { ...makeObs({ id: 'a' }), approvalHistory: history('2026-08-01T10:00:00.000Z', '2026-08-01T11:00:00.000Z') }, // 1h
      { ...makeObs({ id: 'b' }), approvalHistory: history('2026-08-01T10:00:00.000Z', '2026-08-01T12:30:00.000Z') }, // 2.5h
      { ...makeObs({ id: 'c' }), approvalHistory: [event('submit', 'bad-date'), event('approve', '2026-08-01T12:00:00.000Z')] }, // approved but NO computable duration
      { ...makeObs({ id: 'd', approvalStatus: 'pending' }) }, // not approved — excluded
    ]);
    // c is still an APPROVED record (counts in the status totals); only
    // its duration is excluded from the average.
    assert.equal(stats.approved, 3);
    assert.equal(stats.total, 4);
    assert.equal(stats.pending, 1);
    assert.equal(stats.avgApprovalHours, 1.8); // (1 + 2.5) / 2, c excluded
  });

  it('no eligible records → null (NOT a misleading zero)', () => {
    assert.equal(computeApprovalStats([]).avgApprovalHours, null);
    assert.equal(computeApprovalStats([{ ...makeObs({ approvalStatus: 'pending' }) }]).avgApprovalHours, null);
    assert.equal(computeApprovalStats([{ ...makeObs({ approvalStatus: 'rejected' }) }]).avgApprovalHours, null);
  });

  it('approved records without computable durations → null, counts unaffected', () => {
    const stats = computeApprovalStats([
      { ...makeObs({ id: 'a' }) }, // approved, no history/createdAt
      { ...makeObs({ id: 'b' }) },
    ]);
    assert.equal(stats.approved, 2);
    assert.equal(stats.avgApprovalHours, null);
  });

  it('lean discovery records (no duration source) still compile and count statuses', () => {
    const stats = computeApprovalStats([
      { applyPointDeduction: true, approvalStatus: 'approved' },
      { applyPointDeduction: true, approvalStatus: 'pending' },
    ]);
    assert.deepEqual(
      { total: stats.total, pending: stats.pending, approved: stats.approved, rejected: stats.rejected },
      { total: 2, pending: 1, approved: 1, rejected: 0 },
    );
    assert.equal(stats.avgApprovalHours, null);
  });

  it('computeMonthSnapshot carries the computed average into approvalStats', () => {
    const obs = [
      makeObs({ employeeId: 'emp_1', points: 2, approvalHistory: history('2026-08-01T08:00:00.000Z', '2026-08-01T09:30:00.000Z') }),
    ];
    const snapshot = computeMonthSnapshot(obs, '2026-08', employeesMapFor(1), new Map(), SETTINGS);
    assert.equal(snapshot.approvalStats.avgApprovalHours, 1.5);
  });
});

// ══════════════════════════════════════════════════════════════
//  D — leaderboard disjointness (K-2)
// ══════════════════════════════════════════════════════════════

describe('Phase 0 D — top/bottom leaderboards never overlap (K-2)', () => {
  function snapshotFor(count: number, pointsOf?: (index: number) => number) {
    return computeMonthSnapshot(
      scoredObservationsFor(count, pointsOf),
      '2026-08',
      employeesMapFor(count),
      new Map(),
      SETTINGS,
    );
  }

  function assertDisjoint(snapshot: ReturnType<typeof snapshotFor>) {
    const topIds = snapshot.topEmployees.map((e) => e.employeeId);
    const bottomIds = snapshot.bottomEmployees.map((e) => e.employeeId);
    const overlap = topIds.filter((id) => bottomIds.includes(id));
    assert.deepEqual(overlap, [], 'an employee may never appear in both lists');
    // Deterministic: bottom is the WORST-first tail of the ranking order.
    const ranked = Object.values(snapshot.employeeScores)
      .sort((a, b) => a.rank - b.rank)
      .map((e) => e.employeeSnapshot.employeeId);
    assert.deepEqual(topIds, ranked.slice(0, topIds.length));
    assert.deepEqual(bottomIds, ranked.slice(ranked.length - bottomIds.length).reverse());
  }

  it('0 scored employees → both lists empty', () => {
    const snapshot = snapshotFor(0);
    assert.equal(snapshot.topEmployees.length, 0);
    assert.equal(snapshot.bottomEmployees.length, 0);
  });

  it('1 scored employee → top 1, bottom empty', () => {
    const snapshot = snapshotFor(1);
    assert.equal(snapshot.topEmployees.length, 1);
    assert.equal(snapshot.bottomEmployees.length, 0);
  });

  it('5 scored employees → top 5, bottom empty (everyone is already top)', () => {
    const snapshot = snapshotFor(5);
    assert.equal(snapshot.topEmployees.length, 5);
    assert.equal(snapshot.bottomEmployees.length, 0);
    assertDisjoint(snapshot);
  });

  it('10 scored employees → top 10, bottom empty', () => {
    const snapshot = snapshotFor(10);
    assert.equal(snapshot.topEmployees.length, 10);
    assert.equal(snapshot.bottomEmployees.length, 0);
    assertDisjoint(snapshot);
  });

  it('15 scored employees → top 10, bottom 5, disjoint', () => {
    const snapshot = snapshotFor(15);
    assert.equal(snapshot.topEmployees.length, 10);
    assert.equal(snapshot.bottomEmployees.length, 5);
    assertDisjoint(snapshot);
  });

  it('20 scored employees → top 10, bottom 10, disjoint', () => {
    const snapshot = snapshotFor(20);
    assert.equal(snapshot.topEmployees.length, 10);
    assert.equal(snapshot.bottomEmployees.length, 10);
    assertDisjoint(snapshot);
  });

  it('25 scored employees → top 10, bottom 10 (never wider), disjoint', () => {
    const snapshot = snapshotFor(25);
    assert.equal(snapshot.topEmployees.length, 10);
    assert.equal(snapshot.bottomEmployees.length, 10);
    assertDisjoint(snapshot);
  });

  it('equal scores tie-break deterministically by employeeId and stay disjoint', () => {
    const snapshot = snapshotFor(6, () => 5); // identical scores
    const top = snapshot.topEmployees.map((e) => e.employeeId);
    assert.deepEqual(top, [...top].sort((a, b) => a.localeCompare(b)), 'ties order by employeeId asc');
    assertDisjoint(snapshot);
  });

  it('no employee is dropped from the report: employeeScores holds every scored employee', () => {
    const snapshot = snapshotFor(12);
    assert.equal(Object.keys(snapshot.employeeScores).length, 12);
  });
});

// ══════════════════════════════════════════════════════════════
//  E — rolling-average intentional contract (K-3)
// ══════════════════════════════════════════════════════════════

describe('Phase 0 E — rollingAverage baseline is self-inclusive by contract (K-3)', () => {
  const rolling: KpiSettings = { ...SETTINGS, trendCalculation: 'rollingAverage' };

  it('rising series with delta 4 over 2 snapshots → STABLE (baseline includes the latest)', () => {
    // scores [104, 100]: self-inclusive avg = 102, deviation = 2 ≤ 3 → stable.
    // An EXCLUSIVE baseline would yield deviation 4 → improving. This test
    // LOCKS the documented inclusive contract (§PHASE0-K3).
    const result = computeTrend([snapshotWithScore(104), snapshotWithScore(100)], rolling);
    assert.equal(result.direction, 'stable');
    assert.equal(result.momDelta, 4);
  });

  it('larger deviation still flips the direction (threshold semantics preserved)', () => {
    // scores [110, 100, 90]: avg = 100, deviation = 10 > 3 → improving.
    const improving = computeTrend(
      [snapshotWithScore(110), snapshotWithScore(100), snapshotWithScore(90)],
      rolling,
    );
    assert.equal(improving.direction, 'improving');

    // scores [90, 100, 110]: avg = 100, deviation = −10 → declining.
    const declining = computeTrend(
      [snapshotWithScore(90), snapshotWithScore(100), snapshotWithScore(110)],
      rolling,
    );
    assert.equal(declining.direction, 'declining');
  });

  it('single snapshot → stable (insufficient history handled explicitly)', () => {
    const result = computeTrend([snapshotWithScore(50)], rolling);
    assert.equal(result.direction, 'stable');
    assert.equal(result.sampleSize, 1);
  });

  it('empty history → stable with zeroed metrics', () => {
    const result = computeTrend([], rolling);
    assert.equal(result.direction, 'stable');
    assert.equal(result.sampleSize, 0);
    assert.equal(result.momDelta, 0);
  });

  it('movingScore mode keeps month-over-month thresholds (unchanged behavior)', () => {
    const moving: KpiSettings = { ...SETTINGS, trendCalculation: 'movingScore' };
    const result = computeTrend([snapshotWithScore(104), snapshotWithScore(100)], moving);
    assert.equal(result.direction, 'improving'); // delta 4 > 3
    const stable = computeTrend([snapshotWithScore(103), snapshotWithScore(100)], moving);
    assert.equal(stable.direction, 'stable'); // delta 3 is NOT > 3
  });
});
