// ══════════════════════════════════════════════════════════════
//  Travel write-path guards + §35 PERMISSIONS/CACHE contracts
//
//  Server-side authorization is mandatory (§15): the UI never guards
//  alone. These tests pin the SERVER contracts that keep
//  dealClosedAt / closedAt / bookingItems honest regardless of what
//  any client submits:
//    §35.3/43  dealClosedAt is validated server-side (field auth via
//              the travel:update action gate — the existing permission
//              vocabulary, no new keys)
//    §35.44    closedAt can NEVER be client-controlled
//    §35.45-48 bookingItems payloads are validated server-side;
//              unauthorized mutation is rejected (permission gate)
//    §35.49/50 organizational scope stays enforced on travel writes
//    §35.57-61 cache invalidation wiring: deal mutations refresh
//              Travel + Home + Employee360 through the ONE domain map
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidDisplayDate, todayDisplayDate } from '@/lib/date-utils';
import { closedAtForStatusTransition } from '@/lib/deal-dates';
import { sanitizeBookingItems } from '@/lib/booking-items';
import { DOMAIN_DEPENDENCIES, SUBJECT_SCOPED_DOMAINS } from '@/lib/cache/invalidation';

const PROJECT_ROOT = join(__dirname, '..', '..', '..');

function route(rel: string): string {
  return readFileSync(join(PROJECT_ROOT, rel), 'utf8');
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('travel write-path — permission gates stay pinned (§35.43/45-49)', () => {
  it('POST /api/travel keeps the create gate + target-employee scope', () => {
    const src = stripComments(route('src/app/api/travel/route.ts'));
    assert.match(src, /verifyPermission\(\s*request\s*,\s*'travel'\s*,\s*'create'\s*\)/);
    assert.match(src, /employeeInScope\(/);
  });
  it('PUT /api/travel/[id] keeps the update gate + stored-employee scope', () => {
    const src = stripComments(route('src/app/api/travel/[id]/route.ts'));
    assert.match(src, /verifyPermission\(\s*request\s*,\s*'travel'\s*,\s*'update'\s*\)/);
    assert.match(src, /employeeInScope\(/);
    assert.match(src, /existing\.employeeId/);
  });
});

describe('travel write-path — closedAt is a server-side ledger (§35.44)', () => {
  it('PUT strips the client closedAt and re-derives it from the status transition', () => {
    const src = stripComments(route('src/app/api/travel/[id]/route.ts'));
    assert.match(src, /delete\s+updates\.closedAt/);
    assert.match(src, /closedAtForStatusTransition\(/);
  });
  it('the ledger lifecycle: stamp on enter, preserve on stay, clear on leave', () => {
    const enter = closedAtForStatusTransition({ previousStatus: 'in_progress', nextStatus: 'completed', now: new Date('2026-10-08T00:00:00.000Z') });
    assert.equal(enter, '2026-10-08T00:00:00.000Z');
    const stay = closedAtForStatusTransition({ previousStatus: 'completed', nextStatus: 'completed', existingClosedAt: enter });
    assert.equal(stay, enter);
    const leave = closedAtForStatusTransition({ previousStatus: 'completed', nextStatus: 'canceled', existingClosedAt: enter });
    assert.equal(leave, null);
  });
  it('PUT also strips the technical createdAt/id — never client-writable', () => {
    const src = stripComments(route('src/app/api/travel/[id]/route.ts'));
    assert.match(src, /delete\s+updates\.createdAt/);
    assert.match(src, /delete\s+updates\.id/);
  });
});

describe('travel write-path — dealClosedAt is a validated business date (§35.43)', () => {
  it('POST defaults dealClosedAt to TODAY and validates explicit values', () => {
    const src = stripComments(route('src/app/api/travel/route.ts'));
    assert.match(src, /todayDisplayDate\(\)/);
    assert.match(src, /isValidDisplayDate\(/);
    assert.match(src, /dealClosedAt/);
  });
  it('PUT validates an explicit dealClosedAt and never accepts a cleared one', () => {
    const src = stripComments(route('src/app/api/travel/[id]/route.ts'));
    assert.match(src, /isValidDisplayDate\(updates\.dealClosedAt\)/);
  });
  it('the validator is strict (a real calendar date in DD/MM/YYYY only)', () => {
    assert.equal(isValidDisplayDate('26/09/2026'), true);
    assert.equal(isValidDisplayDate('29/02/2024'), true); // leap year
    assert.equal(isValidDisplayDate('31/02/2026'), false); // impossible date
    assert.equal(isValidDisplayDate('2026-09-26'), false); // ISO shape
    assert.equal(isValidDisplayDate('26-09-2026'), false);
    assert.equal(isValidDisplayDate('26/9/2026'), false);
    assert.equal(isValidDisplayDate(''), false);
    assert.equal(isValidDisplayDate(null), false);
    assert.equal(isValidDisplayDate(undefined), false);
    assert.equal(isValidDisplayDate(todayDisplayDate()), true);
  });
});

describe('travel write-path — bookingItems are sanitized server-side (§35.45-48)', () => {
  it('POST/PUT validate the payload through sanitizeBookingItems (400 on error)', () => {
    const post = stripComments(route('src/app/api/travel/route.ts'));
    assert.match(post, /sanitizeBookingItems\(/);
    const put = stripComments(route('src/app/api/travel/[id]/route.ts'));
    assert.match(put, /sanitizeBookingItems\(/);
    assert.match(put, /projectLegacyServiceFields\(/);
  });
  it('a payload smuggling an unknown type/status/id is REJECTED (not silently fixed)', () => {
    assert.equal(sanitizeBookingItems([{ id: 'x', type: 'yacht', status: 'booked' }]).ok, false);
    assert.equal(sanitizeBookingItems([{ id: 'x', type: 'hotel', status: 'ok' }]).ok, false);
    assert.equal(sanitizeBookingItems([{ id: 'x', type: 'hotel', status: 'booked' }, { id: 'x', type: 'hotel', status: 'booked' }]).ok, false);
  });
});

describe('§35.57-61 — deal mutations refresh every canonical consumer', () => {
  it('the travel domain invalidates the travel list, Home stats and the risk center', () => {
    assert.deepEqual(DOMAIN_DEPENDENCIES.travel, [['travel'], ['home', 'stats'], ['riskCenter']]);
  });
  it('travel is subject-scoped: the owner’s 360/performance surfaces refresh too', () => {
    assert.equal((SUBJECT_SCOPED_DOMAINS as readonly string[]).includes('travel'), true);
  });
  it('no full-refresh fallback was introduced for travel (scoped invalidation only)', () => {
    const src = stripComments(route('src/hooks/use-queries.ts'));
    assert.match(src, /invalidateDomain\(qc, 'travel'/);
    assert.doesNotMatch(src, /invalidateDomain\(qc, 'REFRESH_ALL_DOMAINS'\)/);
  });
});
