// ══════════════════════════════════════════════════════════════
//  M0.1 security tests — health (no user data, no users-table scan)
//  §14: the firebase/test SSRF describe was removed together with
//  the /api/firebase/test route — the standalone Firebase settings
//  page it served no longer exists (Firebase itself is unchanged).
// ══════════════════════════════════════════════════════════════

import './m01-test-support';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  calls,
  resetTestData,
  dbStubs,
} from './m01-test-support';

interface HealthRoute {
  GET: () => Promise<Response>;
}

describe('M0.1 — health GET (no user data, no users-table scan)', () => {
  let route: HealthRoute;

  before(async () => {
    route = (await import('@/app/api/health/route')) as unknown as HealthRoute;
  });

  it('returns ok without any user identity information', async () => {
    resetTestData();
    const res = await route.GET();
    assert.equal(res.status, 200);
    const text = JSON.stringify(await res.json());
    assert.equal(JSON.parse(text).status, 'ok');
    for (const forbidden of ['firstUser', 'email', 'role', 'usersCount']) {
      assert.ok(!text.includes(forbidden), `health response leaks "${forbidden}"`);
    }
  });

  it('does not read the users table (single-record ping only)', async () => {
    resetTestData();
    await route.GET();
    const usersScans = calls.filter((c) => c.fn === 'getAll' && c.args[0] === 'users');
    assert.equal(usersScans.length, 0, 'health endpoint scanned the users table');
    assert.ok(calls.some((c) => c.fn === 'pingDatabase'), 'health endpoint did not use the ping');
  });

  it('reports 500 (not ok) when the database is unreachable', async () => {
    const originalPing = dbStubs.pingDatabase;
    dbStubs.pingDatabase = async () => {
      throw new Error('unreachable');
    };
    try {
      const res = await route.GET();
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.status, 'error');
    } finally {
      dbStubs.pingDatabase = originalPing;
    }
  });
});
