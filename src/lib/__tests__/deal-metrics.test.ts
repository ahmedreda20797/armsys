// ══════════════════════════════════════════════════════════════
//  §CANONICAL-DEAL-METRICS — the ONE deterministic metrics builder
//
//  Mandatory scenarios (spec §35 COUNTING + EMPLOYEE METRICS):
//    19   Home count equals unique matching deal ids
//    20/21 duplicates (repeated rows/joins/aggregation) never inflate
//    22   booking items are never counted as deals
//    23   the same deal reached through multiple relationships counts once
//    24   employee closed-deal total uses dealClosedAt
//    25   employee monthly closed deals uses dealClosedAt
//    26   employee completed total uses current status
//    27   employee monthly completed uses closedAt
//    28   current canceled deals stay in historical closed totals
//    29   Home and Employee360 count through the SAME builder
//    36 TEST D — closed-with-employee vs completed-by-period separation
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDealMetrics, type DealMetricsInput } from '@/lib/deal-dates';

type Deal = {
  id: string;
  status: 'upcoming' | 'in_progress' | 'completed' | 'canceled';
  dealClosedAt: string | null;
  departureDate: string;
  createdAt: string;
  closedAt: string | null;
};

function d(id: string, over: Partial<Deal>): Deal {
  return {
    id,
    status: 'upcoming',
    dealClosedAt: '01/09/2026',
    departureDate: '15/10/2026',
    createdAt: '2026-09-01T09:00:00.000Z',
    closedAt: null,
    ...over,
  };
}

const SEPT: DealMetricsInput = { periodMonthKey: '2026-09', windowMonths: ['2026-08', '2026-09', '2026-10'] };

describe('§35.19/21 — the count equals UNIQUE matching deal ids', () => {
  it('duplicate rows (repeated Firebase traversal / joins / buckets) count ONCE', () => {
    const deal = d('deal-1', { dealClosedAt: '05/09/2026' });
    const metrics = buildDealMetrics([deal, { ...deal }, { ...deal }], SEPT);
    assert.equal(metrics.closedWithEmployeeInPeriod, 1);
    assert.equal(metrics.closedWithEmployeeTotal, 1);
    assert.equal(metrics.uniqueDealCount, 1);
  });
});

describe('§35.22/23 — booking items and secondary relationships are never deals', () => {
  it('a deal with 5 booking items is still ONE deal (items are not counted)', () => {
    const deal = {
      ...d('deal-1', { dealClosedAt: '05/09/2026' }),
      // TravelDeal carries booking items — the metrics builder only
      // reads ids/dates/status, so items cannot inflate any count.
      bookingItems: [1, 2, 3, 4, 5].map((n) => ({ id: `bi-${n}`, type: 'hotel' as const, sequence: n, status: 'booked' as const })),
    };
    const metrics = buildDealMetrics([deal], SEPT);
    assert.equal(metrics.closedWithEmployeeInPeriod, 1);
    assert.equal(metrics.uniqueDealCount, 1);
  });
});

describe('§35.24/25 — closed-with-employee counts attribute by dealClosedAt', () => {
  it('totals span the whole history; period counts use the dealClosedAt month (ANY status)', () => {
    const deals: Deal[] = [
      d('a', { dealClosedAt: '05/09/2026' }),                       // closed with employee in Sept
      d('b', { dealClosedAt: '20/08/2026', status: 'completed' }),  // closed in Aug, completed now
      d('c', { dealClosedAt: '10/10/2026' }),                       // closed in Oct
    ];
    const metrics = buildDealMetrics(deals, SEPT);
    assert.equal(metrics.closedWithEmployeeTotal, 3);
    assert.equal(metrics.closedWithEmployeeInPeriod, 1);
    assert.deepEqual(metrics.closedWithEmployeeMonthly, [
      { month: '2026-08', count: 1 },
      { month: '2026-09', count: 1 },
      { month: '2026-10', count: 1 },
    ]);
  });
  it('legacy deals without dealClosedAt surface as UNKNOWN — never guessed into a month', () => {
    const deals: Deal[] = [
      d('legacy', { dealClosedAt: null }),
      d('new', { dealClosedAt: '05/09/2026' }),
    ];
    const metrics = buildDealMetrics(deals, SEPT);
    assert.equal(metrics.closedWithEmployeeUnknownMonth, 1);
    assert.equal(metrics.closedWithEmployeeInPeriod, 1);
    assert.equal(metrics.closedWithEmployeeTotal, 2); // still part of the historical total
  });
});

describe('§35.26/27 — completed counts: status snapshot vs closedAt period', () => {
  it('completedTotal = current status=completed count; period counts use closedAt', () => {
    const deals: Deal[] = [
      d('a', { status: 'completed', closedAt: '2026-09-08T10:00:00.000Z' }),
      d('b', { status: 'completed', closedAt: '2026-10-08T10:00:00.000Z' }),
      d('c', { status: 'completed', closedAt: null }), // historical unknown
      d('e', { status: 'in_progress', closedAt: null }),
    ];
    const metrics = buildDealMetrics(deals, SEPT);
    assert.equal(metrics.completedTotal, 3);
    assert.equal(metrics.byStatus.completed, 3);
    assert.equal(metrics.byStatus.in_progress, 1);
    assert.equal(metrics.completedInPeriod, 1);
    assert.equal(metrics.completedUnknownMonth, 1);
  });
});

describe('§36 TEST D — closed-with-employee NEVER merges with completed-by-period', () => {
  const deals: Deal[] = [
    // A: closed with employee in Sept, still in progress
    d('A', { dealClosedAt: '01/09/2026', status: 'in_progress', departureDate: '10/10/2026', closedAt: null }),
    // B: closed with employee in Sept, completed in OCTOBER
    d('B', { dealClosedAt: '15/09/2026', status: 'completed', closedAt: '2026-10-08T10:00:00.000Z', departureDate: '20/10/2026' }),
    // C: closed with employee in OCTOBER, completed in SEPTEMBER
    d('C', { dealClosedAt: '02/10/2026', status: 'completed', closedAt: '2026-09-25T10:00:00.000Z', departureDate: '25/10/2026' }),
  ];

  it('"الصفقات المغلقة — سبتمبر" includes A + B only', () => {
    const metrics = buildDealMetrics(deals, SEPT);
    assert.equal(metrics.closedWithEmployeeInPeriod, 2);
  });
  it('"الصفقات المكتملة — سبتمبر" includes C only', () => {
    const metrics = buildDealMetrics(deals, SEPT);
    assert.equal(metrics.completedInPeriod, 1);
  });
});

describe('§35.28 — current canceled deals stay in the historical closed totals', () => {
  it('a canceled deal counts in closed-with-employee totals AND in the canceled status count', () => {
    const deals: Deal[] = [
      d('a', { dealClosedAt: '05/09/2026', status: 'canceled' }),
      d('b', { dealClosedAt: '06/09/2026' }),
    ];
    const metrics = buildDealMetrics(deals, SEPT);
    assert.equal(metrics.closedWithEmployeeTotal, 2);
    assert.equal(metrics.closedWithEmployeeInPeriod, 2);
    assert.equal(metrics.byStatus.canceled, 1);
    // …but a canceled deal is never a COMPLETION.
    assert.equal(metrics.completedInPeriod, 0);
    assert.equal(metrics.completedTotal, 0);
  });
});

describe('§35.30 — status narrowing is one option on the SAME builder', () => {
  it('status=completed narrows every metric to completed deals (evaluation consumers)', () => {
    const deals: Deal[] = [
      d('a', { dealClosedAt: '05/09/2026', status: 'completed', closedAt: '2026-09-20T00:00:00.000Z' }),
      d('b', { dealClosedAt: '06/09/2026', status: 'canceled' }),
    ];
    const all = buildDealMetrics(deals, SEPT);
    const completedOnly = buildDealMetrics(deals, { ...SEPT, status: 'completed' });
    assert.equal(all.closedWithEmployeeInPeriod, 2);
    assert.equal(completedOnly.closedWithEmployeeInPeriod, 1);
    assert.equal(completedOnly.completedInPeriod, 1);
  });
});

describe('travel + created dimensions stay available from the same builder', () => {
  it('travelInPeriod attributes by departureDate; createdInPeriod by createdAt', () => {
    const deals: Deal[] = [
      d('a', { dealClosedAt: '01/09/2026', departureDate: '10/10/2026', createdAt: '2026-09-01T00:00:00.000Z' }),
      d('b', { dealClosedAt: '01/10/2026', departureDate: '05/09/2026', createdAt: '2026-10-01T00:00:00.000Z' }),
    ];
    const metrics = buildDealMetrics(deals, SEPT);
    assert.equal(metrics.travelInPeriod, 1);
    assert.equal(metrics.createdInPeriod, 1);
    assert.deepEqual(metrics.travelMonthly, [{ month: '2026-09', count: 1 }, { month: '2026-10', count: 1 }]);
  });
});
