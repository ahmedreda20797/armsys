// ══════════════════════════════════════════════════════════════
//  §DEAL-DATES — the DEAL_CLOSED dimension (تاريخ تقفيل الديل)
//  + the four canonical date bases (focused tests)
//
//  Mandatory scenarios (spec §35 DATE MODEL):
//    1/2  dealClosedAt defaults to today on creation (default
//         doctrine helpers) and is editable when authorized
//         (route contract — travel-write-guards.test.ts)
//    4    dealClosedAt is distinct from createdAt
//    5    dealClosedAt is distinct from departureDate
//    6    dealClosedAt is distinct from closedAt
//    7    completing a deal creates closedAt
//    8    completed → completed preserves closedAt
//    9    reopening clears closedAt
//    10   completing again creates a NEW closedAt
//    11   historical null closedAt remains unknown
//    12   historical dealClosedAt is never inferred from another date
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDealBusinessDate,
  getDealDate,
  getDealDateMonthKey,
  getDealMonthKey,
  parseDealDateBasis,
  closedAtForStatusTransition,
  DEAL_DATE_BASES,
  type DealDateSource,
} from '@/lib/deal-dates';
import { isValidDisplayDate, todayDisplayDate } from '@/lib/date-utils';

function deal(over: Partial<DealDateSource>): DealDateSource {
  return {
    createdAt: '2026-08-01T09:00:00.000Z',
    departureDate: '15/09/2026',
    closedAt: null,
    dealClosedAt: null,
    ...over,
  };
}

describe('§35.1 — dealClosedAt defaults to TODAY on creation (default doctrine)', () => {
  it('todayDisplayDate produces the DD/MM/YYYY contract and validates strictly', () => {
    const today = todayDisplayDate();
    assert.match(today, /^\d{2}\/\d{2}\/\d{4}$/);
    assert.equal(isValidDisplayDate(today), true);
  });
});

describe('§35.4-6 — the four business dates are DISTINCT dimensions', () => {
  const d = deal({
    dealClosedAt: '26/09/2026', // closed with the employee
    departureDate: '10/10/2026', // travel
    closedAt: '2026-10-08T14:00:00.000Z', // completed
    createdAt: '2026-09-26T08:00:00.000Z', // technical creation
  });

  it('each basis resolves to its OWN field — no borrowing across dimensions', () => {
    assert.equal(getDealDate(d, 'dealClosedAt'), '26/09/2026');
    assert.equal(getDealDate(d, 'departureDate'), '10/10/2026');
    assert.equal(getDealDate(d, 'closedAt'), '2026-10-08T14:00:00.000Z');
    assert.equal(getDealDate(d, 'createdAt'), '2026-09-26T08:00:00.000Z');
  });

  it('the DEAL_CLOSED dimension resolves dealClosedAt (not closedAt)', () => {
    assert.equal(getDealBusinessDate(d, 'DEAL_CLOSED'), '26/09/2026');
    assert.equal(getDealBusinessDate(d, 'CLOSED'), '2026-10-08T14:00:00.000Z');
  });

  it('month keys attribute each dimension to its own month', () => {
    assert.equal(getDealDateMonthKey(d, 'dealClosedAt'), '2026-09');
    assert.equal(getDealDateMonthKey(d, 'departureDate'), '2026-10');
    assert.equal(getDealDateMonthKey(d, 'closedAt'), '2026-10');
    assert.equal(getDealDateMonthKey(d, 'createdAt'), '2026-09');
  });

  it('the same September deal is NOT a September completion (closedAt is October)', () => {
    // §36 TEST B: September + تاريخ تقفيل الديل → appears; September +
    // تاريخ الاكتمال → does NOT appear (deal completed in October).
    assert.equal(getDealDateMonthKey(d, 'dealClosedAt') === '2026-09', true);
    assert.notEqual(getDealDateMonthKey(d, 'closedAt'), '2026-09');
  });
});

describe('§35.12 — historical dealClosedAt is never inferred from another date', () => {
  it('a legacy deal with no dealClosedAt is UNKNOWN in that dimension', () => {
    const legacy = deal({ dealClosedAt: null, departureDate: '10/10/2026', createdAt: '2026-09-26T08:00:00.000Z', closedAt: '2026-10-08T00:00:00.000Z' });
    assert.equal(getDealDate(legacy, 'dealClosedAt'), null);
    assert.equal(getDealDateMonthKey(legacy, 'dealClosedAt'), null);
  });
});

describe('basis parsing — untrusted basis strings fail closed', () => {
  it('accepts exactly the four canonical bases', () => {
    assert.deepEqual(
      DEAL_DATE_BASES,
      ['dealClosedAt', 'createdAt', 'departureDate', 'closedAt'],
    );
    for (const b of DEAL_DATE_BASES) assert.equal(parseDealDateBasis(b), b);
  });
  it('rejects garbage, aliases and the invented cancellation basis', () => {
    assert.equal(parseDealDateBasis('canceled'), null);
    assert.equal(parseDealDateBasis('cancellation'), null);
    assert.equal(parseDealDateBasis('departure'), null);
    assert.equal(parseDealDateBasis(''), null);
    assert.equal(parseDealDateBasis(undefined), null);
    assert.equal(parseDealDateBasis(42), null);
  });
});

describe('§35.7-11 — the closedAt completion ledger (server-side lifecycle)', () => {
  it('entering completed stamps closedAt (7)', () => {
    const stamp = closedAtForStatusTransition({ previousStatus: 'in_progress', nextStatus: 'completed', now: new Date('2026-10-08T14:00:00.000Z') });
    assert.equal(stamp, '2026-10-08T14:00:00.000Z');
  });
  it('staying completed preserves the stored value verbatim (8)', () => {
    const stamp = closedAtForStatusTransition({ previousStatus: 'completed', nextStatus: 'completed', existingClosedAt: '2026-10-08T14:00:00.000Z' });
    assert.equal(stamp, '2026-10-08T14:00:00.000Z');
  });
  it('leaving completed clears closedAt (9)', () => {
    assert.equal(closedAtForStatusTransition({ previousStatus: 'completed', nextStatus: 'in_progress', existingClosedAt: '2026-10-08T14:00:00.000Z' }), null);
  });
  it('completing again creates a NEW closedAt (10)', () => {
    const second = closedAtForStatusTransition({ previousStatus: 'in_progress', nextStatus: 'completed', existingClosedAt: null, now: new Date('2026-10-20T09:00:00.000Z') });
    assert.equal(second, '2026-10-20T09:00:00.000Z');
  });
  it('a historical completed record without closedAt stays UNKNOWN (11)', () => {
    const stamp = closedAtForStatusTransition({ previousStatus: 'completed', nextStatus: 'completed', existingClosedAt: null });
    assert.equal(stamp, null);
  });
  it('any transition whose target is not completed clears closedAt', () => {
    assert.equal(closedAtForStatusTransition({ previousStatus: 'completed', nextStatus: 'canceled', existingClosedAt: '2026-10-08T14:00:00.000Z' }), null);
    assert.equal(closedAtForStatusTransition({ previousStatus: 'upcoming', nextStatus: 'upcoming', existingClosedAt: '2026-10-08T14:00:00.000Z' }), null);
  });
});

describe('month attribution helpers stay dimension-pure', () => {
  it('a DD/MM/YYYY dealClosedAt and an ISO closedAt both attribute deterministically', () => {
    const d = deal({ dealClosedAt: '05/09/2026', closedAt: '2026-09-30T23:59:59.000Z' });
    assert.equal(getDealMonthKey(d, 'DEAL_CLOSED'), '2026-09');
    assert.equal(getDealMonthKey(d, 'CLOSED'), '2026-09');
  });
  it('unparseable dates attribute to NOTHING (never a guessed bucket)', () => {
    const d = deal({ dealClosedAt: 'not-a-date', departureDate: '' });
    assert.equal(getDealDateMonthKey(d, 'dealClosedAt'), null);
    assert.equal(getDealDateMonthKey(d, 'departureDate'), null);
  });
});
