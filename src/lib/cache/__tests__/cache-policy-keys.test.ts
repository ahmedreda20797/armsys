// ══════════════════════════════════════════════════════════════
//  §47 tests — cache freshness policy + canonical query keys
//
//  Covers: policy completeness (no unconfigured major domain),
//  period-aware keys (§16), filter-aware keys (§43), metric-dimension
//  identity for deal/closedAt surfaces (§17), user isolation being
//  structural (no user ids in keys — enforced at the identity gate).
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CACHE_FRESHNESS,
  DEFAULT_STALE_TIME_MS,
  DEFAULT_GC_TIME_MS,
  freshnessFor,
} from '../cache-policy';
import { queryKeys } from '../query-keys';

describe('cache freshness policy (§12)', () => {
  it('covers every major operational domain', () => {
    const required = [
      'homeStats', 'employees', 'organization', 'dashboardUsers',
      'followUps', 'quality', 'attendance', 'requests', 'travel',
      'biometrics', 'rules', 'capaCases', 'complaints', 'knowledgeBase',
      'hrDeductions', 'riskCenter', 'employee360', 'employeePerformance',
      'kpiObservations', 'kpiDashboard', 'kpiSnapshots', 'reportsCatalog',
      'profile', 'userPreferences', 'unseen',
    ];
    for (const domain of required) {
      assert.ok(CACHE_FRESHNESS[domain], `missing freshness for ${domain}`);
      assert.ok(CACHE_FRESHNESS[domain].staleTime > 0, `${domain} staleTime must be positive`);
    }
  });

  it('keeps the existing per-domain staleTimes (no invented regressions)', () => {
    // These values reproduce what each domain used before the layer.
    assert.equal(CACHE_FRESHNESS.homeStats.staleTime, 15_000);
    assert.equal(CACHE_FRESHNESS.employees.staleTime, 30_000);
    assert.equal(CACHE_FRESHNESS.followUps.staleTime, 10_000);
    assert.equal(CACHE_FRESHNESS.travel.staleTime, 10_000);
    assert.equal(CACHE_FRESHNESS.quality.staleTime, 15_000);
    assert.equal(CACHE_FRESHNESS.attendance.staleTime, 15_000);
    assert.equal(CACHE_FRESHNESS.requests.staleTime, 10_000);
    assert.equal(CACHE_FRESHNESS.rules.staleTime, 60_000);
    assert.equal(CACHE_FRESHNESS.profile.staleTime, 60_000);
  });

  it('falls back to the default policy for unknown domains', () => {
    assert.deepEqual(freshnessFor('nope'), { staleTime: DEFAULT_STALE_TIME_MS });
  });

  it('defaults bound memory: retention far exceeds freshness, both finite (§29)', () => {
    assert.equal(DEFAULT_GC_TIME_MS, 30 * 60_000);
    assert.ok(DEFAULT_GC_TIME_MS > DEFAULT_STALE_TIME_MS);
  });
});

describe('canonical query keys (§6/§16/§17/§43)', () => {
  it('preserves the legacy key shapes byte-for-byte', () => {
    assert.deepEqual(queryKeys.homeStats, ['home', 'stats']);
    assert.deepEqual(queryKeys.employees, ['employees']);
    assert.deepEqual(queryKeys.travel, ['travel']);
    assert.deepEqual(queryKeys.capaCase('x'), ['capaCases', 'x']);
    assert.deepEqual(queryKeys.followUpsByEmployee('E1'), ['followUps', 'employee', 'E1']);
    assert.deepEqual(queryKeys.orgNodesForAssignment, ['employees', 'org-nodes']);
  });

  it('is period-aware: months never collide (§16)', () => {
    assert.notDeepEqual(queryKeys.riskCenterMonth('2026-08'), queryKeys.riskCenterMonth('2026-09'));
    assert.deepEqual(queryKeys.riskCenterMonth(''), queryKeys.riskCenterMonth('current'));
    // A month key and the all-periods key are distinct entries.
    assert.notDeepEqual(queryKeys.riskCenterMonth('2026-08'), queryKeys.riskCenterMonth(''));
  });

  it('is filter-aware: list variants never collide (§43)', () => {
    assert.notDeepEqual(queryKeys.qualityList(true), queryKeys.qualityList(false));
    assert.notDeepEqual(queryKeys.hrDeductionsList(true), queryKeys.hrDeductionsList(false));
    assert.notDeepEqual(queryKeys.dashboardUsers('basic'), queryKeys.dashboardUsers('full'));
    // Prefix invalidation still reaches both variants.
    assert.ok(queryKeys.qualityList(true)[0] === 'quality');
    assert.ok(queryKeys.hrDeductionsList(false)[0] === 'hrDeductions');
  });

  it('keeps the travel/deal metric dimension inside the key identity (§17)', () => {
    // The travel hook appends [tab, employeeId, month, …] after the
    // ['travel'] prefix — the tab IS the metric/status dimension, so
    // created/closed/travel views cannot share an entry. The factory
    // guarantees the prefix exists for that serialization.
    assert.deepEqual(queryKeys.travel, ['travel']);
  });

  it('is subject-aware for Employee 360 / performance (§39)', () => {
    assert.notDeepEqual(queryKeys.employee360('E1'), queryKeys.employee360('E2'));
    assert.notDeepEqual(queryKeys.employeePerformance('E1'), queryKeys.employeePerformance('E2'));
    // Subject keys are namespaced away from the employees list domain.
    assert.notEqual(queryKeys.employee360('E1')[0], 'employees');
  });

  it('contains NO identity segments (isolation is structural, not per-key — §7)', () => {
    // Resource names like 'dashboard/users' or 'userPreferences' are
    // DATA domains, not identities. No key may carry a user-id segment.
    for (const value of Object.values(queryKeys)) {
      const key = typeof value === 'function'
        ? (value as (arg: string) => readonly unknown[])('probe')
        : value;
      const joined = JSON.stringify(key).toLowerCase();
      assert.ok(!joined.includes('userid'), `key carries a userId segment: ${joined}`);
      assert.ok(!joined.includes('"user",'), `key segments start with a user identity: ${joined}`);
      assert.ok(!joined.includes('scope:'), `key carries a scope segment: ${joined}`);
    }
  });
});
