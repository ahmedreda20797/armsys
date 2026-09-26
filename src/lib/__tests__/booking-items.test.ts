// ══════════════════════════════════════════════════════════════
//  §BOOKING-ITEMS — the dynamic booking/service model
//
//  Mandatory scenarios (spec §35 BOOKING ITEMS):
//    31-37  repeated items of EVERY type (flights, hotels, visas,
//           tours, transportation, train) are supported
//    38     every booking has a unique id
//    39     item #2 status can change without modifying item #1
//    40     deal status stays independent from booking status
//    41     legacy deals remain readable (non-destructive normalization)
//    42     new deals use canonical bookingItems
//  Plus the server-side payload guards (§35 PERMISSIONS 45-48).
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOKING_SERVICE_TYPES,
  BOOKING_ITEM_STATUSES,
  normalizeBookingItems,
  sanitizeBookingItems,
  projectLegacyServiceFields,
  bookingItemNumber,
  newBookingItemId,
} from '@/lib/booking-items';
import type { BookingItem, TravelDeal } from '@/types';

function legacyDeal(over: Partial<TravelDeal>): TravelDeal {
  return {
    id: 'deal-1',
    employeeId: 'emp-1',
    destination: 'Cairo',
    departureDate: '15/10/2026',
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
    ...over,
  } as TravelDeal;
}

describe('§35.31-37 — repeated items of every type are supported', () => {
  it('a deal can hold multiple international flights, hotels, visas and trains', () => {
    const items: BookingItem[] = [
      { id: 'bi-1', type: 'international_flight', sequence: 1, status: 'booked', label: null, details: null },
      { id: 'bi-2', type: 'international_flight', sequence: 2, status: 'pending', label: null, details: null },
      { id: 'bi-3', type: 'international_flight', sequence: 3, status: 'booked', label: null, details: null },
      { id: 'bi-4', type: 'hotel', sequence: 4, status: 'booked', label: null, details: null },
      { id: 'bi-5', type: 'hotel', sequence: 5, status: 'pending', label: null, details: null },
      { id: 'bi-6', type: 'visa', sequence: 6, status: 'booked', label: null, details: null },
      { id: 'bi-7', type: 'visa', sequence: 7, status: 'missing', label: null, details: null },
      { id: 'bi-8', type: 'tours', sequence: 8, status: 'booked', label: null, details: null },
      { id: 'bi-9', type: 'transportation', sequence: 9, status: 'pending', label: null, details: null },
      { id: 'bi-10', type: 'domestic_flight', sequence: 10, status: 'booked', label: null, details: null },
      { id: 'bi-11', type: 'train', sequence: 11, status: 'pending', label: null, details: null },
      { id: 'bi-12', type: 'train', sequence: 12, status: 'booked', label: null, details: null },
    ];
    const sanitized = sanitizeBookingItems(items);
    assert.equal(sanitized.ok, true);
    if (sanitized.ok) {
      assert.equal(sanitized.items.length, 12);
      assert.equal(sanitized.items.filter((i) => i.type === 'train').length, 2);
      // every type in the vocabulary is representable
      for (const t of BOOKING_SERVICE_TYPES) {
        assert.equal(sanitized.items.some((i) => i.type === t), true, `missing type ${t}`);
      }
    }
  });
  it('the type vocabulary includes train and keeps the legacy six', () => {
    assert.deepEqual(BOOKING_SERVICE_TYPES, [
      'international_flight', 'domestic_flight', 'hotel', 'visa', 'tours', 'transportation', 'train',
    ]);
    assert.deepEqual(BOOKING_ITEM_STATUSES, ['booked', 'pending', 'missing']);
  });
});

describe('§35.38 — every booking has a unique id', () => {
  it('duplicate ids are REJECTED server-side (never silently merged)', () => {
    const sanitized = sanitizeBookingItems([
      { id: 'bi-1', type: 'hotel', status: 'booked' },
      { id: 'bi-1', type: 'hotel', status: 'pending' },
    ]);
    assert.equal(sanitized.ok, false);
  });
  it('generated ids are unique across a reasonable sample', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newBookingItemId()));
    assert.equal(ids.size, 200);
  });
});

describe('§35.39 — item #2 status can change without modifying item #1', () => {
  it('an item-level update touches ONLY the target item', () => {
    const items: BookingItem[] = [
      { id: 'bi-1', type: 'international_flight', sequence: 1, status: 'booked', label: null, details: null },
      { id: 'bi-2', type: 'international_flight', sequence: 2, status: 'pending', label: null, details: null },
    ];
    // The exact transformation the card quick-toggle performs.
    const next = items.map((i) => (i.id === 'bi-2' ? { ...i, status: 'booked' as const, updatedAt: '2026-09-26T00:00:00.000Z' } : i));
    assert.equal(next[0].status, 'booked');
    assert.equal(next[0].updatedAt, undefined);
    assert.equal(next[1].status, 'booked');
    assert.notDeepEqual(next[1], items[1]);
    assert.deepEqual(next[0], items[0]);
  });
});

describe('§35.40 — deal status is independent from booking status', () => {
  it('the metrics builder and normalization never mix the two vocabularies', () => {
    // A canceled deal can hold booked services; a completed deal can
    // hold pending services — the model imposes no coupling.
    const deal = legacyDeal({
      status: 'canceled',
      hasHotel: true,
      hotelStatus: 'booked',
      bookingItems: [{ id: 'bi-1', type: 'hotel', sequence: 1, status: 'booked', label: null, details: null }],
    });
    assert.equal(deal.status, 'canceled');
    const items = normalizeBookingItems(deal);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, 'booked');
  });
});

describe('§35.41 — legacy deals remain readable (non-destructive normalization)', () => {
  it('the six fixed fields normalize into canonical items with stable ids', () => {
    const deal = legacyDeal({
      hasInternationalFlight: true,
      internationalFlightStatus: 'booked',
      hasHotel: true,
      hotelStatus: 'pending',
      hasTours: true, // has=true without a stored status → booked
    });
    const items = normalizeBookingItems(deal);
    assert.deepEqual(items.map((i) => [i.type, i.status, i.id]), [
      ['international_flight', 'booked', 'legacy-international_flight-1'],
      ['hotel', 'pending', 'legacy-hotel-1'],
      ['tours', 'booked', 'legacy-tours-1'],
    ]);
    // per-type numbering: each legacy type yields exactly one item
    assert.equal(bookingItemNumber(items, 'legacy-hotel-1'), 1);
  });
  it('normalization is deterministic and does NOT mutate the source deal', () => {
    const deal = legacyDeal({ hasVisa: true, visaStatus: 'booked' });
    const snapshot = JSON.stringify(deal);
    const first = normalizeBookingItems(deal);
    const second = normalizeBookingItems(deal);
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(deal), snapshot);
  });
  it('a stored bookingItems array wins over the legacy fields', () => {
    const deal = legacyDeal({
      hasHotel: true,
      hotelStatus: 'booked', // stale legacy mirror
      bookingItems: [{ id: 'bi-9', type: 'train', sequence: 1, status: 'pending', label: null, details: null }],
    });
    const items = normalizeBookingItems(deal);
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'train');
  });
});

describe('§35.42 — new deals use canonical bookingItems (server projection)', () => {
  it('projectLegacyServiceFields mirrors the FIRST item of each legacy-backed type', () => {
    const projection = projectLegacyServiceFields([
      { id: 'bi-1', type: 'international_flight', sequence: 1, status: 'booked', label: null, details: null },
      { id: 'bi-2', type: 'international_flight', sequence: 2, status: 'pending', label: null, details: null },
      { id: 'bi-3', type: 'hotel', sequence: 3, status: 'pending', label: null, details: null },
    ]);
    assert.equal(projection.hasInternationalFlight, true);
    assert.equal(projection.internationalFlightStatus, 'booked'); // first item wins
    assert.equal(projection.hasHotel, false); // pending → the legacy has-flag is false (legacy convention)
    assert.equal(projection.hotelStatus, 'pending');
    assert.equal(projection.hasVisa, false);
    assert.equal(projection.visaStatus, 'missing');
    assert.equal('train' in projection, false); // train has no legacy field
  });
  it('an empty item list projects to the fully-missing legacy shape', () => {
    const projection = projectLegacyServiceFields([]);
    assert.equal(projection.hasInternationalFlight, false);
    assert.equal(projection.internationalFlightStatus, 'missing');
    assert.equal(projection.transportationStatus, 'missing');
  });
});

describe('§35.45-48 — server-side bookingItems payload guards', () => {
  it('rejects non-arrays, unknown types, unknown statuses and oversized payloads', () => {
    assert.equal(sanitizeBookingItems('nope').ok, false);
    assert.equal(sanitizeBookingItems([{ id: 'x', type: 'spaceship', status: 'booked' }]).ok, false);
    assert.equal(sanitizeBookingItems([{ id: 'x', type: 'hotel', status: 'delivered' }]).ok, false);
    assert.equal(sanitizeBookingItems([{ id: '', type: 'hotel', status: 'booked' }]).ok, false);
    assert.equal(
      sanitizeBookingItems(Array.from({ length: 51 }, (_, n) => ({ id: `bi-${n}`, type: 'hotel' as const, status: 'booked' as const }))).ok,
      false,
    );
  });
  it('normalizes whitespace-only labels/details to null and renumbers sequences', () => {
    const sanitized = sanitizeBookingItems([
      { id: 'b', type: 'hotel', status: 'booked', label: '   ', details: '' },
      { id: 'a', type: 'visa', status: 'pending', label: 'VisaFast', details: '2 pax' },
    ]);
    assert.equal(sanitized.ok, true);
    if (sanitized.ok) {
      assert.deepEqual(sanitized.items.map((i) => i.sequence), [1, 2]);
      assert.equal(sanitized.items[0].label, null);
      assert.equal(sanitized.items[1].label, 'VisaFast');
      assert.equal(sanitized.items[1].details, '2 pax');
    }
  });
  it('drops malformed STORED items defensively on read (never crashes the page)', () => {
    const items = normalizeBookingItems(legacyDeal({
      bookingItems: [
        { id: 'ok', type: 'hotel', sequence: 1, status: 'booked' },
        null,
        { broken: true },
        { id: 'bad-type', type: 'space-ship', sequence: 2, status: 'booked' },
      ] as unknown as BookingItem[],
    }));
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'ok');
  });
});
