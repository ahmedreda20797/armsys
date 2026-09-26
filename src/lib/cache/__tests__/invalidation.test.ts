// ══════════════════════════════════════════════════════════════
//  §47 tests — mutation-aware targeted invalidation (§18-§23, §44)
//
//  Verifies the DEPENDENCY MAP hits exactly the affected domains,
//  never "everything", and that mutation surfaces derive the
//  subject-scoped Employee 360 keys only from an explicit context.
//  Runs against a REAL QueryClient so prefix matching semantics are
//  the production ones.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import {
  DOMAIN_DEPENDENCIES,
  invalidateDomain,
  invalidateDomains,
  REFRESH_ALL_DOMAINS,
} from '../invalidation';
import { permissionsSignature } from '../permissions-signature';

function freshClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function keysOf(client: QueryClient): string[] {
  return client.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey));
}

function seed(client: QueryClient, key: readonly unknown[], data = { v: 1 }): void {
  client.setQueryData(key as string[], data);
}

describe('mutation-aware invalidation dependency map (§44)', () => {
  it('follow-up mutation reaches the follow-up surfaces AND the Home metric (§18/§38)', () => {
    assert.ok(DOMAIN_DEPENDENCIES.followUps.some((k) => k[0] === 'followUps'));
    assert.ok(DOMAIN_DEPENDENCIES.followUps.some((k) => k[0] === 'home' && k[1] === 'stats'));
  });

  it('deal mutation reaches the deal list, Home metrics and risk (§19)', () => {
    const domains = DOMAIN_DEPENDENCIES.travel.map((k) => k.join(':'));
    assert.ok(domains.includes('travel'));
    assert.ok(domains.includes('home:stats'));
    assert.ok(domains.includes('riskCenter'));
    // §40: KPI snapshots are observation-driven — deals must NOT
    // invalidate the KPI pipeline.
    assert.ok(!domains.some((k) => k.startsWith('kpi')));
  });

  it('quality observation mutation reaches KPI, legacy quality, Home, risk (§20)', () => {
    const domains = DOMAIN_DEPENDENCIES.qualityObservations.map((k) => k.join(':'));
    assert.ok(domains.includes('kpi:observations'));
    assert.ok(domains.includes('kpi:dashboard'));
    assert.ok(domains.includes('kpi:snapshots'));
    assert.ok(domains.includes('quality'));
    assert.ok(domains.includes('home:stats'));
    assert.ok(domains.includes('riskCenter'));
  });

  it('notification mutation invalidates NOTHING via this map (§22)', () => {
    // Mark-read updates its own cache directly — the map must not
    // fan out into notification keys.
    for (const [domain, keys] of Object.entries(DOMAIN_DEPENDENCIES)) {
      for (const key of keys) {
        assert.ok(
          key[0] !== 'notifications' && key[0] !== 'notification-popover',
          `${domain} must not invalidate notification caches`,
        );
      }
    }
  });

  it('no dependency row is unboundedly broad (no global invalidation, §23)', () => {
    // Domain roots — first tokens allowed to appear in the map.
    const ROOTS = new Set([
      'employees', 'home', 'organization', 'dashboard', 'attendance',
      'requests', 'rules', 'quality', 'kpi', 'travel', 'biometrics',
      'followUps', 'capaCases', 'complaints', 'knowledgeBase',
      'hrDeductions', 'riskCenter', 'profile', 'userPreferences',
    ]);
    // Namespace prefixes that would sweep whole families — never legal
    // as a dependency row on their own.
    const BARE = new Set([JSON.stringify(['kpi']), JSON.stringify(['home'])]);
    for (const [domain, keys] of Object.entries(DOMAIN_DEPENDENCIES)) {
      for (const key of keys) {
        assert.ok(key.length >= 1 && typeof key[0] === 'string', `${domain} has malformed key`);
        assert.ok(ROOTS.has(key[0]), `${domain} maps unknown root ${key[0]}`);
        assert.ok(!BARE.has(JSON.stringify(key)), `${domain} maps a family-sweeping prefix: ${JSON.stringify(key)}`);
      }
    }
  });
});

describe('invalidateDomain against a real QueryClient', () => {
  it('marks ONLY affected entries stale and leaves others fresh', () => {
    const qc = freshClient();
    seed(qc, ['followUps', 'list']);
    seed(qc, ['home', 'stats']);
    seed(qc, ['employees']);
    seed(qc, ['quality', 'list', false]);
    seed(qc, ['kpi', 'observations', 'status=open']);
    seed(qc, ['unseen', 'summary']);

    // Mark everything fresh first.
    qc.invalidateQueries();
    for (const q of qc.getQueryCache().getAll()) q.setData({ v: 1 });

    invalidateDomain(qc, 'followUps');

    const isStale = (key: readonly unknown[]) =>
      qc.getQueryState(key)?.isInvalidated === true;

    assert.ok(isStale(['followUps', 'list']), 'followUps list must be invalidated');
    assert.ok(isStale(['home', 'stats']), 'Home metric must be invalidated (§38)');
    assert.ok(!isStale(['employees']), 'employees must NOT be touched (§18)');
    assert.ok(!isStale(['quality', 'list', false]), 'quality must NOT be touched');
    assert.ok(!isStale(['kpi', 'observations', 'status=open']), 'KPI must NOT be touched');
    assert.ok(!isStale(['unseen', 'summary']), 'unseen badges must NOT be touched (§22)');
  });

  it('subject-scoped invalidation touches only THAT employee 360 (§39)', () => {
    const qc = freshClient();
    seed(qc, ['employee360', 'E1']);
    seed(qc, ['employee360', 'E2']);
    seed(qc, ['employee-performance', 'E1', 'career', '']);
    seed(qc, ['employee-performance', 'E2', 'career', '']);

    invalidateDomain(qc, 'travel', { employeeId: 'E1' });

    assert.equal(qc.getQueryState(['employee360', 'E1'])?.isInvalidated, true);
    assert.equal(qc.getQueryState(['employee360', 'E2'])?.isInvalidated, false);
    assert.equal(qc.getQueryState(['employee-performance', 'E1', 'career', ''])?.isInvalidated, true);
    assert.equal(qc.getQueryState(['employee-performance', 'E2', 'career', ''])?.isInvalidated, false);
  });

  it('without a context, no Employee 360 entry is touched at all', () => {
    const qc = freshClient();
    seed(qc, ['employee360', 'E1']);
    invalidateDomain(qc, 'travel');
    assert.equal(qc.getQueryState(['employee360', 'E1'])?.isInvalidated, false);
  });

  it('deal mutation never invalidates KPI snapshot entries (§15/§40)', () => {
    const qc = freshClient();
    seed(qc, ['kpi', 'snapshots', '2026-09']);
    seed(qc, ['travel']);
    seed(qc, ['home', 'stats']);

    invalidateDomain(qc, 'travel');

    assert.equal(qc.getQueryState(['kpi', 'snapshots', '2026-09'])?.isInvalidated, false);
    assert.equal(qc.getQueryState(['travel'])?.isInvalidated, true);
    assert.equal(qc.getQueryState(['home', 'stats'])?.isInvalidated, true);
  });

  it('coalesces duplicates and never throws', () => {
    const qc = freshClient();
    assert.doesNotThrow(() => {
      invalidateDomains(qc, ['followUps', 'followUps', 'homeStats']);
    });
    // followUps prefix listed once per domain call — still just entries.
    assert.ok(keysOf(qc).length === 0); // nothing seeded → nothing created
  });

  it('REFRESH_ALL_DOMAINS is an explicit, bounded opt-in (§26/§23)', () => {
    assert.ok(REFRESH_ALL_DOMAINS.length > 0);
    assert.ok(REFRESH_ALL_DOMAINS.length < 20);
    assert.ok(!REFRESH_ALL_DOMAINS.includes('userPreferences' as never));
    assert.ok(!REFRESH_ALL_DOMAINS.includes('profile' as never));
  });
});

describe('permission-context signature (§34)', () => {
  it('is deterministic across object construction order', () => {
    const a = permissionsSignature({ employees: 'edit', home: 'view' });
    const b = permissionsSignature({ home: 'view', employees: 'edit' });
    assert.equal(a, b);
  });

  it('detects an authorization-context change', () => {
    const before = permissionsSignature({ employees: 'none', home: 'view' });
    const after = permissionsSignature({ employees: 'edit', home: 'view' });
    assert.notEqual(before, after);
  });

  it('is stable when the context is unchanged (5-min refresh produces same sig)', () => {
    const a = permissionsSignature({ employees: 'edit', nested: { x: 1, y: [1, 2] } });
    const b = permissionsSignature({ nested: { y: [1, 2], x: 1 }, employees: 'edit' });
    assert.equal(a, b);
  });

  it('handles null and primitive edge cases without crashing', () => {
    assert.equal(permissionsSignature(null), 'null');
    assert.equal(permissionsSignature(undefined), 'null');
    assert.equal(permissionsSignature('edit'), 'edit');
  });
});
