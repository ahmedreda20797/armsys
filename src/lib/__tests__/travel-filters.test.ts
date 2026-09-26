// ══════════════════════════════════════════════════════════════
//  §TRAVEL-FILTERS — the ONE canonical Travel filter pipeline
//
//  Mandatory scenarios (spec §35 TRAVEL FILTERS + COUNTING):
//    13   September + dealClosedAt → deals closed with employees in Sept
//    14   September + departureDate → travel in Sept
//    15   September + closedAt → deals completed in Sept
//    16   dateBasis is explicit (untrusted param fails closed)
//    17   Home deep-link applies dealClosedAt
//    18   stale Travel state cannot override an explicit Home deep-link
//         (hasNavIntent → skipRestore)
//    19   count equals unique matching deal ids (dedup FIRST)
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTravelFilters,
  availableMonthsForBasis,
  parseTravelQueryFilters,
  resolveTravelNavLink,
  type TravelQueryFilters,
} from '@/lib/travel-filters';
import type { TravelDeal } from '@/types';

function deal(id: string, over: Partial<TravelDeal>): TravelDeal {
  return {
    id,
    employeeId: 'emp-1',
    destination: 'Cairo',
    departureDate: '15/09/2026',
    returnDate: null,
    dealerName: null,
    customerNames: null,
    hasInternationalFlight: false,
    hasDomesticFlight: false,
    hasHotel: false,
    hasVisa: false,
    hasTours: false,
    hasTransportation: false,
    internationalFlightStatus: null,
    domesticFlightStatus: null,
    hotelStatus: null,
    visaStatus: null,
    toursStatus: null,
    transportationStatus: null,
    notes: null,
    status: 'upcoming',
    createdAt: '2026-09-01T09:00:00.000Z',
    dealClosedAt: '01/09/2026',
    closedAt: null,
    bookingItems: null,
    ...over,
  };
}

/** §36 TEST D dataset (+ a TRAVEL-September deal for the basis tests). */
const testD: TravelDeal[] = [
  deal('A', { dealClosedAt: '01/09/2026', status: 'in_progress', departureDate: '10/10/2026' }),
  deal('B', { dealClosedAt: '15/09/2026', status: 'completed', departureDate: '20/10/2026', closedAt: '2026-10-08T10:00:00.000Z' }),
  deal('C', { dealClosedAt: '02/10/2026', status: 'completed', departureDate: '25/10/2026', closedAt: '2026-09-25T10:00:00.000Z' }),
  // Travels in September but was closed with the employee in October.
  deal('D', { dealClosedAt: '01/10/2026', status: 'upcoming', departureDate: '15/09/2026' }),
];

function filters(over: Partial<TravelQueryFilters>): TravelQueryFilters {
  return {
    tab: 'all',
    employeeId: '',
    month: 'all',
    dateBasis: 'departureDate',
    status: 'all',
    closedMonth: '',
    tomorrowDeparture: false,
    tomorrowReturn: false,
    search: '',
    ...over,
  };
}

function ids(deals: TravelDeal[]): string[] {
  return deals.map((d) => d.id).sort();
}

describe('§35.13 — September + dealClosedAt (ANY status) → closed with employees in Sept', () => {
  it('returns A + B regardless of current status', () => {
    const out = applyTravelFilters(testD, filters({ dateBasis: 'dealClosedAt', month: '2026-09' }));
    assert.deepEqual(ids(out), ['A', 'B']);
  });
});

describe('§35.14 — September + departureDate → travel in September', () => {
  it('attributes by the travel date, independent of dealClosedAt', () => {
    const out = applyTravelFilters(testD, filters({ dateBasis: 'departureDate', month: '2026-09' }));
    assert.deepEqual(ids(out), ['D']);
  });
});

describe('§35.15 — September + closedAt + completed → deals completed in September', () => {
  it('returns C only (B completed in October)', () => {
    const out = applyTravelFilters(testD, filters({ dateBasis: 'closedAt', month: '2026-09', status: 'completed' }));
    assert.deepEqual(ids(out), ['C']);
  });
  it('§9 independence: the basis alone does NOT imply completed', () => {
    const out = applyTravelFilters(testD, filters({ dateBasis: 'closedAt', month: '2026-09', status: 'all' }));
    assert.deepEqual(ids(out), ['C']);
    const septClosureBasis = applyTravelFilters(testD, filters({ dateBasis: 'dealClosedAt', month: '2026-09', status: 'completed' }));
    assert.deepEqual(ids(septClosureBasis), ['B']);
  });
});

describe('§35.16 — the date basis is explicit and fails closed', () => {
  it('an untrusted basis param falls back to departureDate', () => {
    const sp = new URLSearchParams('dateBasis=canceledAt&month=2026-09');
    const f = parseTravelQueryFilters(sp);
    assert.equal(f.dateBasis, 'departureDate');
  });
  it('a trusted basis param passes through', () => {
    const sp = new URLSearchParams('dateBasis=dealClosedAt&month=2026-09&status=all');
    const f = parseTravelQueryFilters(sp);
    assert.equal(f.dateBasis, 'dealClosedAt');
    assert.equal(f.status, 'all');
    assert.equal(f.month, '2026-09');
  });
});

describe('§35.17 — the Home deep-link resolves to dealClosedAt + period + status all', () => {
  it('the Home params produce the SAME dataset the summary counted', () => {
    const nav = resolveTravelNavLink({ dateBasis: 'dealClosedAt', month: '2026-09', status: 'all' });
    assert.equal(nav.hasNavIntent, true);
    assert.equal(nav.dateBasis, 'dealClosedAt');
    assert.equal(nav.month, '2026-09');
    assert.equal(nav.status, 'all');
    const out = applyTravelFilters(testD, filters({ dateBasis: nav.dateBasis!, month: nav.month!, status: nav.status! }));
    assert.deepEqual(ids(out), ['A', 'B']);
  });
});

describe('§35.18 — legacy closedMonth links keep their exact historical semantics', () => {
  it('closedMonth maps to basis=closedAt + status=completed', () => {
    const nav = resolveTravelNavLink({ closedMonth: '2026-09' });
    assert.equal(nav.dateBasis, 'closedAt');
    assert.equal(nav.month, '2026-09');
    assert.equal(nav.status, 'completed');
    assert.equal(nav.hasNavIntent, true);
    // And the server-side legacy param keeps the same semantics.
    const sp = new URLSearchParams('closedMonth=2026-09');
    const f = parseTravelQueryFilters(sp);
    assert.deepEqual(ids(applyTravelFilters(testD, f)), ['C']);
  });
  it('no nav params → no navigation intent (persisted state may restore)', () => {
    assert.equal(resolveTravelNavLink({}).hasNavIntent, false);
    assert.equal(resolveTravelNavLink({ month: 'garbage' }).hasNavIntent, false);
  });
});

describe('§35.19 — count equals unique matching deal ids (dedup FIRST)', () => {
  it('repeated rows (join/traversal artifacts) count once; items never counted', () => {
    const a = deal('A', { dealClosedAt: '05/09/2026' });
    const duplicated = [a, { ...a }, a];
    const out = applyTravelFilters(
      duplicated as TravelDeal[],
      filters({ dateBasis: 'dealClosedAt', month: '2026-09' }),
    );
    assert.equal(out.length, 1);
    // A deal with booking items is ONE deal.
    const withItems = deal('W', {
      dealClosedAt: '05/09/2026',
      bookingItems: [1, 2, 3].map((n) => ({ id: `bi-${n}`, type: 'hotel' as const, sequence: n, status: 'booked' as const })),
    });
    assert.equal(applyTravelFilters([withItems], filters({ dateBasis: 'dealClosedAt', month: '2026-09' })).length, 1);
  });
  it('the list length equals pagination.total (summary/detail agreement)', () => {
    const out = applyTravelFilters(testD, filters({ dateBasis: 'dealClosedAt', month: '2026-09' }));
    assert.equal(out.length, 2); // == Home closedThisMonth for the same scope/basis/period
  });
});

describe('employee narrowing + unknown dates', () => {
  it('the employee filter narrows the authorized set', () => {
    const out = applyTravelFilters(testD, filters({ dateBasis: 'dealClosedAt', month: '2026-09', employeeId: 'emp-2' }));
    assert.equal(out.length, 0);
  });
  it('deals with an unknown date on the selected basis never match a period', () => {
    const legacy = deal('legacy', { dealClosedAt: null, departureDate: '05/09/2026' });
    assert.equal(applyTravelFilters([legacy], filters({ dateBasis: 'dealClosedAt', month: '2026-09' })).length, 0);
    assert.equal(applyTravelFilters([legacy], filters({ dateBasis: 'departureDate', month: '2026-09' })).length, 1);
  });
});

describe('availableMonthsForBasis — months WITH data on the basis only', () => {
  it('the month list follows the basis (no fabricated months)', () => {
    const months = availableMonthsForBasis(testD, 'dealClosedAt');
    assert.deepEqual(months.sort(), ['2026-09', '2026-10']);
    const closedMonths = availableMonthsForBasis(testD, 'closedAt');
    assert.deepEqual(closedMonths.sort(), ['2026-09', '2026-10']);
  });
});
