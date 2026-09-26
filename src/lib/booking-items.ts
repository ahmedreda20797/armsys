// ══════════════════════════════════════════════════════════════
//  §BOOKING-ITEMS — canonical dynamic booking/service model
//
//  One deal carries ANY number of independent booking rows (multiple
//  international flights, hotels, visas, trains...). The item identity
//  is its `id` — never the type. Each item owns an independent status
//  drawn from the EXISTING service-status vocabulary ('booked' |
//  'pending' | 'missing'), which is deliberately distinct from the
//  deal-level lifecycle status (upcoming/in_progress/completed/canceled).
//
//  LEGACY COMPATIBILITY (§24): deals stored before this model carry
//  only the six fixed has*/\*Status fields. They normalize at READ
//  time into canonical items (non-destructive — original fields are
//  never mutated by normalization). When a deal is SAVED through the
//  API, the canonical items are projected back onto the legacy fields
//  (first item of each legacy-backed type wins) so every existing
//  reader of those fields stays correct. 'train' has no legacy field.
// ══════════════════════════════════════════════════════════════

import type { BookingItem, BookingItemStatus, BookingServiceType, TravelDeal } from '@/types';

/** All supported booking types, in canonical display order. */
export const BOOKING_SERVICE_TYPES: readonly BookingServiceType[] = [
  'international_flight',
  'domestic_flight',
  'hotel',
  'visa',
  'tours',
  'transportation',
  'train',
] as const;

/** The EXISTING service-status vocabulary (verbatim — never invent states). */
export const BOOKING_ITEM_STATUSES: readonly BookingItemStatus[] = ['booked', 'pending', 'missing'] as const;

/** Arabic source labels (the app's SOURCE language — EN via en-map/i18n). */
export const BOOKING_TYPE_LABELS_AR: Record<BookingServiceType, string> = {
  international_flight: 'طيران دولي',
  domestic_flight: 'طيران داخلي',
  hotel: 'فندق',
  visa: 'تأشيرة',
  tours: 'جولة',
  transportation: 'مواصلات',
  train: 'قطار',
};

/** Icons per type (UI). */
export const BOOKING_TYPE_ICONS: Record<BookingServiceType, string> = {
  international_flight: '✈️',
  domestic_flight: '🛫',
  hotel: '🏨',
  visa: '🛂',
  tours: '🗺️',
  transportation: '🚐',
  train: '🚆',
};

/** Legacy fixed fields each type mirrors onto (train has none). */
const LEGACY_FIELD_BY_TYPE: Partial<Record<BookingServiceType, { has: keyof TravelDeal; status: keyof TravelDeal }>> = {
  international_flight: { has: 'hasInternationalFlight', status: 'internationalFlightStatus' },
  domestic_flight: { has: 'hasDomesticFlight', status: 'domesticFlightStatus' },
  hotel: { has: 'hasHotel', status: 'hotelStatus' },
  visa: { has: 'hasVisa', status: 'visaStatus' },
  tours: { has: 'hasTours', status: 'toursStatus' },
  transportation: { has: 'hasTransportation', status: 'transportationStatus' },
};

const MAX_BOOKING_ITEMS = 50;
const MAX_TEXT_LENGTH = 500;

function isBookingServiceType(v: unknown): v is BookingServiceType {
  return typeof v === 'string' && (BOOKING_SERVICE_TYPES as readonly string[]).includes(v);
}

function isBookingItemStatus(v: unknown): v is BookingItemStatus {
  return typeof v === 'string' && (BOOKING_ITEM_STATUSES as readonly string[]).includes(v);
}

/**
 * Normalize ONE deal into its canonical booking items.
 *
 *   • deal.bookingItems (array)  → sanitized copy of the stored items.
 *   • otherwise (legacy deal)    → deterministic read-time normalization
 *     of the six fixed fields: a type yields an item when has* is true
 *     OR its stored status is booked/pending; per-type numbering starts
 *     at 1. Original fields are never touched (non-destructive).
 *
 * Deterministic and pure — the same deal always produces the same items.
 */
export function normalizeBookingItems(
  deal: Pick<TravelDeal, 'bookingItems'> & Partial<TravelDeal>,
): BookingItem[] {
  if (Array.isArray(deal.bookingItems)) {
    return deal.bookingItems.filter(isValidStoredItem);
  }

  const items: BookingItem[] = [];
  const perTypeCount = new Map<BookingServiceType, number>();
  for (const type of BOOKING_SERVICE_TYPES) {
    const legacy = LEGACY_FIELD_BY_TYPE[type];
    if (!legacy) continue; // 'train' — no legacy representation
    const has = (deal[legacy.has] as boolean | undefined) === true;
    const storedStatus = deal[legacy.status] as string | null | undefined;
    const status: BookingItemStatus | null =
      isBookingItemStatus(storedStatus) && storedStatus !== 'missing' ? storedStatus
        : has ? 'booked' : null;
    if (!status) continue;
    const sequence = (perTypeCount.get(type) ?? 0) + 1;
    perTypeCount.set(type, sequence);
    items.push({
      id: `legacy-${type}-${sequence}`,
      type,
      sequence: items.length + 1,
      label: null,
      status,
      details: null,
    });
  }
  return items;
}

function isValidStoredItem(item: unknown): item is BookingItem {
  if (!item || typeof item !== 'object') return false;
  const it = item as Record<string, unknown>;
  return typeof it.id === 'string' && it.id.length > 0 && isBookingServiceType(it.type);
}

/**
 * Server-side payload validation for client-submitted bookingItems
 * (§16 — the API is authoritative; the UI is not trusted). Returns the
 * sanitized canonical items or an explicit error — never a partial
 * guess. Sequences are RENUMBERED deterministically from the array
 * order (the client's ordering is the display order).
 */
export function sanitizeBookingItems(
  input: unknown,
): { ok: true; items: BookingItem[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) {
    return { ok: false, error: 'bookingItems must be an array' };
  }
  if (input.length > MAX_BOOKING_ITEMS) {
    return { ok: false, error: `bookingItems exceeds ${MAX_BOOKING_ITEMS} items` };
  }
  const seenIds = new Set<string>();
  const items: BookingItem[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: 'booking item must be an object' };
    }
    const it = raw as Record<string, unknown>;
    if (typeof it.id !== 'string' || it.id.length === 0 || it.id.length > 64) {
      return { ok: false, error: 'booking item id is required (string ≤ 64 chars)' };
    }
    if (seenIds.has(it.id)) {
      return { ok: false, error: `duplicate booking item id: ${it.id}` };
    }
    seenIds.add(it.id);
    if (!isBookingServiceType(it.type)) {
      return { ok: false, error: `unknown booking item type: ${String(it.type)}` };
    }
    if (!isBookingItemStatus(it.status)) {
      return { ok: false, error: `unknown booking item status: ${String(it.status)}` };
    }
    const label = it.label == null ? null : (String(it.label).trim().slice(0, 120) || null);
    const details = it.details == null ? null : (String(it.details).trim().slice(0, MAX_TEXT_LENGTH) || null);
    items.push({
      id: it.id,
      type: it.type,
      sequence: items.length + 1,
      label: label && label.length > 0 ? label : null,
      status: it.status,
      details: details && details.length > 0 ? details : null,
      updatedAt: typeof it.updatedAt === 'string' ? it.updatedAt : null,
    });
  }
  return { ok: true, items };
}

/**
 * Project canonical items back onto the legacy fixed fields (server
 * write-path). First item of each legacy-backed type wins; a type with
 * no items maps to has*=false / status='missing' — the exact shape the
 * legacy form produced. 'train' is not projected (no legacy field).
 */
export function projectLegacyServiceFields(items: ReadonlyArray<BookingItem>): Partial<TravelDeal> {
  const out: Partial<TravelDeal> = {};
  const firstByType = new Map<BookingServiceType, BookingItem>();
  for (const item of items) {
    if (!firstByType.has(item.type)) firstByType.set(item.type, item);
  }
  for (const type of BOOKING_SERVICE_TYPES) {
    const legacy = LEGACY_FIELD_BY_TYPE[type];
    if (!legacy) continue;
    const first = firstByType.get(type);
    (out as Record<string, unknown>)[legacy.has] = first ? first.status === 'booked' : false;
    (out as Record<string, unknown>)[legacy.status] = first ? first.status : 'missing';
  }
  return out;
}

/** Display ordering: stored sequence, then array order. */
export function sortBookingItems(items: ReadonlyArray<BookingItem>): BookingItem[] {
  return [...items].sort((a, b) => a.sequence - b.sequence);
}

/** 1-based per-type position of an item (طيران دولي 1 / طيران دولي 2 …). */
export function bookingItemNumber(items: ReadonlyArray<BookingItem>, itemId: string): number {
  const item = items.find((i) => i.id === itemId);
  if (!item) return 1;
  let n = 0;
  for (const i of items) {
    if (i.type === item.type) {
      n += 1;
      if (i.id === itemId) break;
    }
  }
  return Math.max(1, n);
}

/** Generate a collision-safe id for a new item (client or server). */
export function newBookingItemId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `bi-${Date.now().toString(36)}-${rand}`;
}
