// ══════════════════════════════════════════════════════════════
//  §DEAL-DATES — canonical deal date semantics (focused tests)
//
//  Run: npx tsx --test src/lib/__tests__/deal-dates.test.ts
//
//  Proves the three canonical dimensions are INDEPENDENT:
//    CREATED → createdAt   (intake / record activity)
//    CLOSED  → closedAt    (successful completion / productivity)
//    TRAVEL  → departureDate (customer travel / operations)
//
//  Mandatory scenarios (spec §17):
//    1  closed Aug 28 / travel Sep 15 → different periods per dimension
//    2  closed Sep 5 / travel Oct 10  → different periods per dimension
//    3  closedAt null / departureDate populated → CLOSED unknown,
//       NEVER derived from the travel date
//    8  upcoming travel resolves through the TRAVEL dimension
//    9  near-travel keeps using the travel date (travel-status lib)
//   10  created-deal metrics resolve through the CREATED dimension
//   14  the same deal belongs to different periods for sales vs travel
//   15  no travelDate fallback for closed-deal attribution
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDealBusinessDate,
  getDealMonthKey,
  isCompletedDeal,
  closedAtForStatusTransition,
  countClosedDealsForMonth,
  type DealDateSource,
} from '@/lib/deal-dates';
import { isNearDeparture, travelDaysUntil } from '@/lib/travel-status';

function deal(over: Partial<DealDateSource> & { status?: string }): DealDateSource {
  return {
    createdAt: '2026-08-01T09:00:00.000Z',
    departureDate: '15/09/2026',
    closedAt: null,
    ...over,
  };
}

describe('countClosedDealsForMonth — the CLOSED-dimension period count', () => {
  it('§17.4 — Employee 360 / employee closed-deal counts attribute by closedAt only', () => {
    const deals = [
      // completed AND closed in September → counts for September.
      { ...deal({ status: 'completed', closedAt: '2026-09-03T10:00:00.000Z', departureDate: '15/10/2026' }), status: 'completed' as const },
      // departing in September but completed in August → August closure, NOT September.
      { ...deal({ status: 'completed', closedAt: '2026-08-28T10:00:00.000Z' }), status: 'completed' as const },
      // completed with no closure timestamp → UNKNOWN (never attributed).
      { ...deal({ status: 'completed', closedAt: null }), status: 'completed' as const },
      // active/canceled deals never count as closures.
      { ...deal({ status: 'upcoming', closedAt: null }), status: 'upcoming' as const },
    ];
    const september = countClosedDealsForMonth(deals, '2026-09');
    assert.equal(september.closed, 1);
    assert.equal(september.unknown, 1);
    const august = countClosedDealsForMonth(deals, '2026-08');
    assert.equal(august.closed, 1);
    assert.equal(august.unknown, 1);
  });

  it('§17.11/§17.12 — MTD and historical months are answered by the same closedAt attribution', () => {
    const deals = [
      { ...deal({ status: 'completed', closedAt: '2026-07-15T10:00:00.000Z', departureDate: '01/08/2026' }), status: 'completed' as const },
      { ...deal({ status: 'completed', closedAt: '2026-09-20T10:00:00.000Z', departureDate: '02/10/2026' }), status: 'completed' as const },
    ];
    assert.equal(countClosedDealsForMonth(deals, '2026-07').closed, 1); // historical
    assert.equal(countClosedDealsForMonth(deals, '2026-09').closed, 1); // MTD/current
    assert.equal(countClosedDealsForMonth(deals, '2026-10').closed, 0); // travel month ≠ closure month
  });
});

describe('getDealBusinessDate — one canonical date per dimension', () => {
  it('returns the dimension OWN date and never borrows from another dimension', () => {
    const d = deal({ createdAt: '2026-08-20T10:00:00.000Z', departureDate: '15/09/2026', closedAt: '2026-08-28T14:00:00.000Z' });
    assert.equal(getDealBusinessDate(d, 'CREATED'), '2026-08-20T10:00:00.000Z');
    assert.equal(getDealBusinessDate(d, 'CLOSED'), '2026-08-28T14:00:00.000Z');
    assert.equal(getDealBusinessDate(d, 'TRAVEL'), '15/09/2026');
  });

  it('CLOSED stays null when closedAt is missing — no departureDate fallback (§17.15)', () => {
    const d = deal({ departureDate: '15/09/2026', closedAt: null });
    assert.equal(getDealBusinessDate(d, 'CLOSED'), null);
    assert.equal(getDealMonthKey(d, 'CLOSED'), null);
  });

  it('TRAVEL stays null when departureDate is missing — no createdAt fallback', () => {
    const d = deal({ createdAt: '2026-08-20T10:00:00.000Z', departureDate: '' });
    assert.equal(getDealBusinessDate(d, 'TRAVEL'), null);
    assert.equal(getDealMonthKey(d, 'TRAVEL'), null);
  });
});

describe('non-negotiable period examples (spec §2)', () => {
  it('§17.1 — closed 28/08, travel 15/09: the same deal belongs to August (closed) and September (travel)', () => {
    const d = deal({ createdAt: '2026-08-20T10:00:00.000Z', closedAt: '2026-08-28T14:00:00.000Z', departureDate: '15/09/2026' });
    assert.equal(getDealMonthKey(d, 'CLOSED'), '2026-08');
    assert.equal(getDealMonthKey(d, 'TRAVEL'), '2026-09');
    assert.equal(getDealMonthKey(d, 'CREATED'), '2026-08');
  });

  it('§17.2 — closed 05/09, travel 10/10: closed September, travel October, created August', () => {
    const d = deal({ createdAt: '2026-08-20T10:00:00.000Z', closedAt: '2026-09-05T11:30:00.000Z', departureDate: '10/10/2026' });
    assert.equal(getDealMonthKey(d, 'CLOSED'), '2026-09');
    assert.equal(getDealMonthKey(d, 'TRAVEL'), '2026-10');
    assert.equal(getDealMonthKey(d, 'CREATED'), '2026-08');
  });

  it('§17.3 — closedAt null with a travel date populated: closed stays unknown, travel still resolves', () => {
    const d = deal({ createdAt: '2026-09-01T08:00:00.000Z', closedAt: null, departureDate: '20/12/2026' });
    assert.equal(getDealMonthKey(d, 'CLOSED'), null);
    assert.equal(getDealMonthKey(d, 'TRAVEL'), '2026-12');
    assert.equal(getDealMonthKey(d, 'CREATED'), '2026-09');
  });
});

describe('dimension independence (§17.14 — one deal, many periods)', () => {
  it('created July, closed August, traveled September — three truthful answers', () => {
    const d = deal({ createdAt: '2026-07-02T09:00:00.000Z', closedAt: '2026-08-30T16:45:00.000Z', departureDate: '12/09/2026' });
    assert.equal(getDealMonthKey(d, 'CREATED'), '2026-07');
    assert.equal(getDealMonthKey(d, 'CLOSED'), '2026-08');
    assert.equal(getDealMonthKey(d, 'TRAVEL'), '2026-09');
  });

  it('unparseable stored dates are unknown, never guessed into a bucket', () => {
    const d = deal({ createdAt: 'not-a-date', departureDate: '32/13/2026', closedAt: '2026-08-28T14:00:00.000Z' });
    assert.equal(getDealMonthKey(d, 'CREATED'), null);
    assert.equal(getDealMonthKey(d, 'TRAVEL'), null);
    assert.equal(getDealMonthKey(d, 'CLOSED'), '2026-08');
  });
});

describe('operational travel logic keeps the TRAVEL dimension (§17.8/§17.9)', () => {
  /** DD/MM/YYYY display string relative to today (the app's contract). */
  const displayDate = (offsetDays: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };

  it('near-travel is computed from the departure date, not the closure date (§17.9)', () => {
    // Closed last month but traveling tomorrow → still a near-travel deal.
    const closedLastMonthTravelingTomorrow = deal({
      closedAt: '2026-08-20T10:00:00.000Z',
      departureDate: displayDate(1),
    });
    assert.equal(isCompletedDeal({ status: 'completed' }), true);
    const days = travelDaysUntil(closedLastMonthTravelingTomorrow.departureDate);
    assert.equal(days, 1);
    assert.equal(isNearDeparture(days), true);
  });

  it('a deal closed today for travel next month is NOT a near-travel deal', () => {
    const closedTodayTravelNextMonth = deal({
      closedAt: new Date().toISOString(),
      departureDate: displayDate(35),
    });
    const days = travelDaysUntil(closedTodayTravelNextMonth.departureDate);
    assert.equal(days, 35);
    assert.equal(isNearDeparture(days), false);
  });
});

describe('closedAt ledger — server-side status transitions', () => {
  const now = new Date('2026-09-21T10:00:00.000Z');

  it('entering completed stamps the observed moment', () => {
    assert.equal(closedAtForStatusTransition({ previousStatus: 'in_progress', nextStatus: 'completed', existingClosedAt: null, now }), now.toISOString());
    assert.equal(closedAtForStatusTransition({ previousStatus: 'upcoming', nextStatus: 'completed', existingClosedAt: null, now }), now.toISOString());
  });

  it('staying completed keeps the existing value verbatim (legacy null stays null)', () => {
    assert.equal(
      closedAtForStatusTransition({ previousStatus: 'completed', nextStatus: 'completed', existingClosedAt: '2026-08-28T14:00:00.000Z', now }),
      '2026-08-28T14:00:00.000Z',
    );
    assert.equal(closedAtForStatusTransition({ previousStatus: 'completed', nextStatus: 'completed', existingClosedAt: null, now }), null);
  });

  it('leaving completed clears the stamp (the earlier closure no longer stands)', () => {
    assert.equal(closedAtForStatusTransition({ previousStatus: 'completed', nextStatus: 'in_progress', existingClosedAt: '2026-08-28T14:00:00.000Z', now }), null);
    assert.equal(closedAtForStatusTransition({ previousStatus: 'completed', nextStatus: 'canceled', existingClosedAt: '2026-08-28T14:00:00.000Z', now }), null);
  });

  it('client-supplied closedAt never flows through a non-transition update', () => {
    // No status in the update → no closedAt decision at all (route strips the field).
    assert.equal(closedAtForStatusTransition({ previousStatus: 'upcoming', nextStatus: 'upcoming', existingClosedAt: null, now }), null);
  });
});
