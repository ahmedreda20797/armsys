// ══════════════════════════════════════════════════════════════
//  §TRAVEL-FILTERS — the ONE canonical Travel filter pipeline
//
//  The Travel GET route delegates ALL filtering/sorting/month-list
//  logic here so the summary (Home) and the detail view (Travel)
//  cannot drift: both sides consume the same pure functions over the
//  same canonical deal-date semantics (§DEAL-DATES).
//
//  §10 COUNTING GUARANTEE: the pipeline dedupes by deal id FIRST —
//  the filtered list length is always the number of UNIQUE matching
//  deals (never booking items, join artifacts or repeated rows).
//
//  §9 INDEPENDENCE: the date basis and the status filter are
//  orthogonal — (basis=dealClosedAt, status=all, month=M) returns ALL
//  deals closed with employees in M regardless of current status;
//  (basis=closedAt, status=completed, month=M) returns deals
//  COMPLETED in M; (basis=departureDate, month=M) returns travel in M.
// ══════════════════════════════════════════════════════════════

import type { TravelDeal } from '@/types';
import { getDaysRemaining } from '@/lib/date-utils';
import { isTomorrow } from '@/lib/travel-status';
import {
  getDealDateMonthKey,
  isCompletedDeal,
  parseDealDateBasis,
  uniqueDealsById,
  type DealDateBasis,
} from '@/lib/deal-dates';

export type TravelTab = 'all' | 'upcoming' | 'in_progress' | 'returned' | 'canceled';
export type TravelStatusFilter = TravelDeal['status'] | 'all';

/** Operational category — derived from the TRAVEL dates, not the status. */
export type TripCategory = 'upcoming' | 'in_progress' | 'returned';

export function getTripCategory(depDate: string, retDate: string | null): TripCategory {
  const retDays = retDate ? getDaysRemaining(retDate) : null;
  if (retDays !== null && retDays < 0) return 'returned';
  if (getDaysRemaining(depDate) < 0) return 'in_progress';
  return 'upcoming';
}

export const TRAVEL_TABS: readonly TravelTab[] = ['all', 'upcoming', 'in_progress', 'returned', 'canceled'] as const;

export const TRAVEL_STATUS_FILTERS: readonly TravelStatusFilter[] = ['all', 'upcoming', 'in_progress', 'completed', 'canceled'] as const;

export interface TravelQueryFilters {
  tab: TravelTab;
  employeeId: string;
  /** Period applied to the SELECTED date basis (YYYY-MM or 'all'). */
  month: string;
  /** §DEAL-DATES — which canonical date the period means. */
  dateBasis: DealDateBasis;
  /** §9 — independent current-status filter (vocabulary verbatim). */
  status: TravelStatusFilter;
  /** LEGACY deep-link param (closedAt month, completed only) — kept
   *  working for old persisted links; new callers pass dateBasis+status. */
  closedMonth: string;
  tomorrowDeparture: boolean;
  tomorrowReturn: boolean;
  search: string;
}

function tabOf(v: string | null): TravelTab {
  return (TRAVEL_TABS as readonly string[]).includes(v ?? '') ? (v as TravelTab) : 'all';
}

function statusOf(v: string | null): TravelStatusFilter {
  return (TRAVEL_STATUS_FILTERS as readonly string[]).includes(v ?? '') ? (v as TravelStatusFilter) : 'all';
}

/** Parse untrusted query params into canonical filters (fail-closed defaults). */
export function parseTravelQueryFilters(searchParams: URLSearchParams): TravelQueryFilters {
  return {
    tab: tabOf(searchParams.get('tab')),
    employeeId: searchParams.get('employeeId') || '',
    month: searchParams.get('month') || 'all',
    dateBasis: parseDealDateBasis(searchParams.get('dateBasis')) ?? 'departureDate',
    status: statusOf(searchParams.get('status')),
    closedMonth: /^\d{4}-\d{2}$/.test(searchParams.get('closedMonth') || '') ? searchParams.get('closedMonth')! : '',
    tomorrowDeparture: searchParams.get('tomorrowDeparture') === '1',
    tomorrowReturn: searchParams.get('tomorrowReturn') === '1',
    search: searchParams.get('search') || '',
  };
}

// ── §7/§31 — Travel deep-link resolution ──
// One pure resolver turns untrusted navParams into the semantic filter
// seed the page applies DETERMINISTICALLY. Any explicit navigation
// intent (Home card, Employee360 drill, evidence link) wins over the
// persisted page state for that mount — a stale persisted
// departure-month filter can never silently intersect a deep-linked
// dataset (the "7 vs 1" regression).

export interface TravelNavResolution {
  dateBasis: DealDateBasis | null;
  month: string | null;
  status: TravelStatusFilter | null;
  employeeId: string | null;
  /** LEGACY param (pre-basis deep links): completed deals by closedAt month. */
  closedMonthLegacy: string | null;
  /** True when ANY explicit navigation intent exists — the caller must
   *  skip the persisted-state restore and seed from this resolution. */
  hasNavIntent: boolean;
}

export function resolveTravelNavLink(params: {
  month?: unknown;
  dateBasis?: unknown;
  status?: unknown;
  employeeId?: unknown;
  closedMonth?: unknown;
}): TravelNavResolution {
  const month = typeof params.month === 'string' && /^\d{4}-\d{2}$/.test(params.month) ? params.month : null;
  const dateBasis = parseDealDateBasis(params.dateBasis);
  const status = typeof params.status === 'string' && (TRAVEL_STATUS_FILTERS as readonly string[]).includes(params.status)
    ? (params.status as TravelStatusFilter)
    : null;
  const employeeId = typeof params.employeeId === 'string' && params.employeeId ? params.employeeId : null;
  const closedMonthLegacy = typeof params.closedMonth === 'string' && /^\d{4}-\d{2}$/.test(params.closedMonth)
    ? params.closedMonth
    : null;
  // LEGACY closedMonth semantics preserved: completed deals attributed
  // by their closedAt month (basis=closedAt + status=completed).
  return {
    dateBasis: dateBasis ?? (closedMonthLegacy ? 'closedAt' : null),
    month: month ?? closedMonthLegacy,
    status: status ?? (closedMonthLegacy ? 'completed' : null),
    employeeId,
    closedMonthLegacy,
    hasNavIntent: !!(month || dateBasis || status || employeeId || closedMonthLegacy),
  };
}

/** Deal status predicate for tab counting (canceled is status-based). */
export function isCanceledDeal(t: Pick<TravelDeal, 'status'>): boolean {
  return t.status === 'canceled';
}

/** Month key of a DD/MM/YYYY display date ('غير محدد' when missing/invalid). */
export function displayMonthKey(dateStr: string): string {
  if (!dateStr) return 'غير محدد';
  const p = dateStr.split('/');
  if (p.length !== 3) return 'غير محدد';
  const month = p[1].padStart(2, '0');
  return `${p[2]}-${month}`;
}

/**
 * The month key of a deal ON THE SELECTED BASIS (null = the deal has
 * no date in that dimension — it can never match a period filter).
 */
export function dealMonthKeyOnBasis(deal: TravelDeal, basis: DealDateBasis): string | null {
  return getDealDateMonthKey(deal, basis);
}

/** Deal row the pipeline consumes — TravelDeal plus the optional
 *  employeeName joined by the route's withEmployee (search uses it). */
export type TravelFilterRow = TravelDeal & { employeeName?: string };

/**
 * THE filter pipeline (single source of truth for Travel + any other
 * consumer of the same question). Returns UNIQUE matching deals,
 * unsorted.
 */
export function applyTravelFilters(
  deals: ReadonlyArray<TravelFilterRow>,
  filters: TravelQueryFilters,
): TravelFilterRow[] {
  // §10 — one deal, one row: dedupe before any counting/filtering.
  let filtered = uniqueDealsById(deals);

  // Tab filter (operational category; canceled is status-based)
  if (filters.tab === 'upcoming') {
    filtered = filtered.filter((t) => getTripCategory(t.departureDate, t.returnDate) === 'upcoming' && !isCanceledDeal(t));
  } else if (filters.tab === 'in_progress') {
    filtered = filtered.filter((t) => getTripCategory(t.departureDate, t.returnDate) === 'in_progress' && !isCanceledDeal(t));
  } else if (filters.tab === 'returned') {
    filtered = filtered.filter((t) => getTripCategory(t.departureDate, t.returnDate) === 'returned' && !isCanceledDeal(t));
  } else if (filters.tab === 'canceled') {
    filtered = filtered.filter((t) => isCanceledDeal(t));
  }

  // §9 — independent current-status filter
  if (filters.status !== 'all') {
    filtered = filtered.filter((t) => t.status === filters.status);
  }

  // Employee filter
  if (filters.employeeId) {
    filtered = filtered.filter((t) => t.employeeId === filters.employeeId);
  }

  // §DEAL-DATES — period filter ON THE SELECTED BASIS. The basis and
  // the status filter are independent; the period never silently
  // re-attributes to another date dimension.
  if (filters.month && filters.month !== 'all') {
    filtered = filtered.filter((t) => getDealDateMonthKey(t, filters.dateBasis) === filters.month);
  }

  // LEGACY closure-month deep-link (closedAt month, completed only) —
  // preserved verbatim for old persisted links.
  if (filters.closedMonth) {
    filtered = filtered.filter((t) => isCompletedDeal(t) && getDealDateMonthKey(t, 'closedAt') === filters.closedMonth);
  }

  // §TRAVEL-TOMORROW (canceled trips are not traveling)
  if (filters.tomorrowDeparture) {
    filtered = filtered.filter((t) => !isCanceledDeal(t) && isTomorrow(t.departureDate));
  }
  if (filters.tomorrowReturn) {
    filtered = filtered.filter((t) => !isCanceledDeal(t) && isTomorrow(t.returnDate));
  }

  // Search
  const q = filters.search.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter((t) =>
      [t.employeeName, t.destination, t.dealerName || '', t.customerNames || '', t.departureDate, t.returnDate || '', t.notes || '']
        .some((f) => String(f).toLowerCase().includes(q))
    );
  }

  return filtered;
}

/** Parse DD/MM/YYYY to a comparable number YYYYMMDD for sorting. */
function parseDateToSortable(dateStr: string): number {
  const parts = dateStr.split('/');
  if (parts.length !== 3) return 0;
  const year = parseInt(parts[2], 10) || 0;
  const month = parseInt(parts[1], 10) || 0;
  const day = parseInt(parts[0], 10) || 0;
  return year * 10000 + month * 100 + day;
}

/** THE canonical sort (tab-aware), applied after filtering. */
export function sortTravelDeals(
  deals: TravelDeal[],
  tab: TravelTab,
  categoryOf: (t: TravelDeal) => TripCategory,
): TravelDeal[] {
  const sorted = [...deals];
  sorted.sort((a, b) => {
    if (tab === 'returned' || tab === 'canceled') {
      // Most recently returned/canceled first
      return parseDateToSortable(b.returnDate || b.departureDate) - parseDateToSortable(a.returnDate || a.departureDate);
    }
    if (tab === 'in_progress') {
      // Soonest return date first
      const retA = a.returnDate ? getDaysRemaining(a.returnDate) : getDaysRemaining(a.departureDate);
      const retB = b.returnDate ? getDaysRemaining(b.returnDate) : getDaysRemaining(b.departureDate);
      return retA - retB;
    }
    // 'all' and 'upcoming': upcoming/in_progress first, then canceled, then returned
    const categoryOrder: Record<string, number> = { upcoming: 0, in_progress: 1, canceled: 2, returned: 3 };
    const getCatOrder = (t: TravelDeal) => isCanceledDeal(t) ? categoryOrder.canceled : (categoryOrder[categoryOf(t)] ?? 3);
    const catA = getCatOrder(a);
    const catB = getCatOrder(b);
    if (catA !== catB) return catA - catB;
    return getDaysRemaining(a.departureDate) - getDaysRemaining(b.departureDate);
  });
  return sorted;
}

/**
 * Months WITH data on the given basis (no fabricated months), sorted
 * by distance from the current month. Unattributable deals never
 * contribute a bucket.
 */
export function availableMonthsForBasis(deals: ReadonlyArray<TravelDeal>, basis: DealDateBasis): string[] {
  const monthSet = new Set<string>();
  for (const t of deals) {
    const mk = getDealDateMonthKey(t, basis);
    if (mk) monthSet.add(mk);
  }
  const now = new Date();
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  return Array.from(monthSet).sort((a, b) => {
    const distA = Math.abs((parseInt(a.split('-')[0], 10) - cy) * 12 + parseInt(a.split('-')[1], 10) - cm);
    const distB = Math.abs((parseInt(b.split('-')[0], 10) - cy) * 12 + parseInt(b.split('-')[1], 10) - cm);
    return distA - distB;
  });
}
