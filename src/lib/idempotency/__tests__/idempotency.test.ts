// ══════════════════════════════════════════════════════════════
//  Tests for src/lib/idempotency/index.ts (pure functions only)
//
//  Only generateRequestWindow() is a pure function; dedupByClientRequest
//  hits the database and is therefore covered by integration tests.
//
//  Run: npx tsx --test src/lib/idempotency/__tests__/idempotency.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { generateRequestWindow } from '../index';

// ══════════════════════════════════════════════════════════════

describe('generateRequestWindow', () => {
  it('returns a non-empty clientRequestId', () => {
    const w = generateRequestWindow();
    assert.ok(typeof w.clientRequestId === 'string');
    assert.ok(w.clientRequestId.length > 0);
  });

  it('each call yields a unique id', () => {
    const a = generateRequestWindow();
    const b = generateRequestWindow();
    assert.notEqual(a.clientRequestId, b.clientRequestId);
  });

  it('expiresAt is a valid ISO date in the future (default 30 min)', () => {
    const before = Date.now();
    const w = generateRequestWindow();
    const after = Date.now();
    const expires = new Date(w.expiresAt as string).getTime();

    // expiry should be ~30 min ahead of "now".
    assert.ok(expires > after, 'expiresAt must be in the future');
    assert.ok(expires - before >= 29 * 60 * 1000, 'default window should be ~30 min');
    assert.ok(expires - before <= 31 * 60 * 1000);
  });

  it('respects a custom duration', () => {
    const before = Date.now();
    const w = generateRequestWindow(5 * 60 * 1000); // 5 min
    const expires = new Date(w.expiresAt as string).getTime();
    assert.ok(expires - before >= 4 * 60 * 1000);
    assert.ok(expires - before <= 6 * 60 * 1000);
  });

  it('expiresAt parses as a valid Date', () => {
    const w = generateRequestWindow();
    const d = new Date(w.expiresAt as string);
    assert.ok(!Number.isNaN(d.getTime()), 'expiresAt must be a valid ISO timestamp');
  });
});
