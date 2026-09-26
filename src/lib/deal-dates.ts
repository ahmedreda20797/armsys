// ══════════════════════════════════════════════════════════════
//  Deal dates — THE canonical semantic date contract (§DEAL-DATES)
//
//  A travel deal carries FOUR independent business dates. Every
//  deal-derived metric in Qnalys must resolve its reporting period
//  through THIS module — no page, report or export may privately
//  decide that "the deal's month" means any particular field:
//
//    DEAL_CLOSED → dealClosedAt   the business date the deal was
//                                 CLOSED WITH THE EMPLOYEE and entered
//                                 into Qnalys (تاريخ تقفيل الديل) —
//                                 "الصفقات المغلقة"
//    CREATED     → createdAt      technical record creation /
//                                 intake activity
//    CLOSED      → closedAt       observed COMPLETION of the deal /
//                                 trip (تاريخ الاكتمال) — server
//                                 ledger stamped on the completed
//                                 transition
//    TRAVEL      → departureDate  the customer's travel date
//                                 (تاريخ السفر)
//
//  The same deal legitimately belongs to DIFFERENT reporting periods
//  for different metrics. Attribution is DETERMINISTIC and
//  CONSERVATIVE: a dimension whose date is missing/unparseable is
//  UNKNOWN (null) — there is NO hidden fallback between dimensions
//  (a missing closedAt is never replaced by departureDate or
//  createdAt, and vice versa).
//
//  NO CANCELLATION BASIS: the model carries no canonical cancellation
//  date field, so no 'canceled' date basis exists (cancelled deals are
//  counted by CURRENT STATUS, never by an invented date).
// ══════════════════════════════════════════════════════════════

import type { TravelDeal } from '@/types';
import { monthKeyOfDisplayDate, monthKeyOfIso } from '@/lib/performance-intelligence/month-attribution';
import type { MonthlyCount } from '@/lib/performance-intelligence/types';

/** The four canonical deal date dimensions. */
export type DealDateDimension = 'DEAL_CLOSED' | 'CREATED' | 'CLOSED' | 'TRAVEL';

/**
 * The canonical DATE BASES a filter/detail view may be attributed by —
 * the API/UI-facing names of the dimensions (one basis = one dimension;
 * no aliasing, no mixing).
 */
export const DEAL_DATE_BASES = ['dealClosedAt', 'createdAt', 'departureDate', 'closedAt'] as const;
export type DealDateBasis = (typeof DEAL_DATE_BASES)[number];

function isDealDateBasis(v: unknown): v is DealDateBasis {
  return typeof v === 'string' && (DEAL_DATE_BASES as readonly string[]).includes(v);
}

/** Parse an untrusted string into a basis (null → caller applies default). */
export function parseDealDateBasis(v: unknown): DealDateBasis | null {
  return isDealDateBasis(v) ? v : null;
}

const BASIS_TO_DIMENSION: Record<DealDateBasis, DealDateDimension> = {
  dealClosedAt: 'DEAL_CLOSED',
  createdAt: 'CREATED',
  departureDate: 'TRAVEL',
  closedAt: 'CLOSED',
};

/** Arabic labels making the semantic meaning explicit wherever a period is shown. */
export const DEAL_DATE_DIMENSION_LABELS_AR: Record<DealDateDimension, string> = {
  DEAL_CLOSED: 'تاريخ تقفيل الديل',
  CREATED: 'تاريخ تسجيل الصفقة',
  CLOSED: 'تاريخ اكتمال الديل',
  TRAVEL: 'تاريخ السفر (المغادرة)',
};

/** Arabic labels for the filter-facing bases (أساس التاريخ options). */
export const DEAL_DATE_BASIS_LABELS_AR: Record<DealDateBasis, string> = {
  dealClosedAt: 'تاريخ تقفيل الديل',
  createdAt: 'تاريخ التسجيل',
  departureDate: 'تاريخ السفر',
  closedAt: 'تاريخ الاكتمال',
};

/** Minimal structural slice any caller must provide. */
export type DealDateSource = Pick<TravelDeal, 'createdAt' | 'departureDate'> & {
  closedAt?: string | null;
  dealClosedAt?: string | null;
};

/**
 * The canonical business date for one dimension.
 *
 *   DEAL_CLOSED → dealClosedAt (DD/MM/YYYY display contract) — null
 *                 when the closure-with-employee date is unknown
 *                 (legacy records); NEVER a derived fallback
 *   CREATED     → createdAt (ISO engine timestamp)
 *   CLOSED      → closedAt  (ISO engine timestamp) — null when the
 *                 completion moment is unknown; NEVER a derived fallback
 *   TRAVEL      → departureDate (the app's DD/MM/YYYY display contract)
 *
 * Returns null when the dimension's own date is missing — never a
 * date borrowed from another dimension.
 */
export function getDealBusinessDate(deal: DealDateSource, dimension: DealDateDimension): string | null {
  switch (dimension) {
    case 'DEAL_CLOSED':
      return typeof deal.dealClosedAt === 'string' && deal.dealClosedAt.length > 0 ? deal.dealClosedAt : null;
    case 'CREATED':
      return typeof deal.createdAt === 'string' && deal.createdAt.length > 0 ? deal.createdAt : null;
    case 'CLOSED':
      return typeof deal.closedAt === 'string' && deal.closedAt.length > 0 ? deal.closedAt : null;
    case 'TRAVEL':
      return typeof deal.departureDate === 'string' && deal.departureDate.length > 0 ? deal.departureDate : null;
  }
}

/** §DEAL-DATES — the ONE canonical basis resolver: date for a basis. */
export function getDealDate(deal: DealDateSource, basis: DealDateBasis): string | null {
  return getDealBusinessDate(deal, BASIS_TO_DIMENSION[basis]);
}

/**
 * Canonical YYYY-MM reporting month for one dimension, reusing the
 * project's single month-attribution layer (display DD/MM/YYYY and
 * ISO shapes). Null = unattributable (unknown month) — callers
 * surface that as "unknown", never as a guessed bucket.
 */
export function getDealMonthKey(deal: DealDateSource, dimension: DealDateDimension): string | null {
  const date = getDealBusinessDate(deal, dimension);
  if (!date) return null;
  return date.includes('/') ? monthKeyOfDisplayDate(date) : monthKeyOfIso(date);
}

/** §DEAL-DATES — the ONE canonical basis resolver: month for a basis. */
export function getDealDateMonthKey(deal: DealDateSource, basis: DealDateBasis): string | null {
  return getDealMonthKey(deal, BASIS_TO_DIMENSION[basis]);
}

/** Operational completion state (status vocabulary, verbatim). */
export function isCompletedDeal(deal: Pick<TravelDeal, 'status'>): boolean {
  return deal.status === 'completed';
}

/**
 * §DEAL-DATES — server-side closedAt ledger for the 'completed'
 * status transition. The closure moment is the moment the SERVER
 * observes the transition; client-supplied closedAt values are
 * never trusted.
 *
 *   leaving 'completed'            → null (the earlier closure no longer stands)
 *   entering 'completed'           → now  (observed transition moment)
 *   staying 'completed'            → existing value verbatim
 *                                     (legacy null stays null — unknown,
 *                                      never fabricated from another date)
 */
export function closedAtForStatusTransition(args: {
  previousStatus?: string | null;
  nextStatus?: string | null;
  existingClosedAt?: string | null;
  now?: Date;
}): string | null {
  const { previousStatus, nextStatus, existingClosedAt } = args;
  if (nextStatus !== 'completed') return null;
  if (previousStatus === 'completed') return typeof existingClosedAt === 'string' ? existingClosedAt : null;
  return (args.now ?? new Date()).toISOString();
}

/** Result of counting the CLOSED dimension for one reporting month. */
export interface DealClosurePeriodCounts {
  /** Completed deals whose closedAt month equals the requested month. */
  closed: number;
  /** Completed deals whose closure month is unknown (no closedAt) —
   *  surfaced as unknown, never attributed to any month. */
  unknown: number;
}

/**
 * CLOSED-dimension period count for a set of deals (e.g. one
 * employee's travel deals): completed deals attributed by closedAt.
 * Callers must not filter by departureDate for completion-period
 * numbers. NOTE: "الصفقات المغلقة" (closed with the employee) is the
 * DEAL_CLOSED dimension — use countDealsForMonth(deals, 'dealClosedAt', month)
 * or buildDealMetrics; this helper answers the COMPLETION question.
 */
export function countClosedDealsForMonth(
  deals: ReadonlyArray<DealDateSource & { status: TravelDeal['status'] }>,
  monthKey: string,
): DealClosurePeriodCounts {
  let closed = 0;
  let unknown = 0;
  for (const d of uniqueDealsById(deals)) {
    if (!isCompletedDeal(d)) continue;
    const mk = getDealMonthKey(d, 'CLOSED');
    if (mk === monthKey) closed += 1;
    else if (mk === null) unknown += 1;
  }
  return { closed, unknown };
}

// ─────────────────────────────────────────────────────────────
//  §CANONICAL-DEAL-METRICS — the ONE deterministic metrics builder
//
//  Every consumer (Home stats, Travel details, Employee360,
//  evaluation, reports) answers deal questions through THIS builder
//  — never through a private page-side filter/count. Counting is
//  over UNIQUE deal ids (a deal is counted exactly once, never as a
//  booking item, join artifact or repeated aggregation bucket).
// ─────────────────────────────────────────────────────────────

export type DealStatusVocabulary = TravelDeal['status'];

export interface DealMetricsInput {
  /** The reporting period's YYYY-MM key (null → period counts are 0). */
  periodMonthKey?: string | null;
  /** Months forming the analysis window (monthly series buckets). */
  windowMonths?: ReadonlyArray<string>;
  /** Optional current-status narrowing applied to EVERY metric. */
  status?: DealStatusVocabulary | 'all';
}

export interface DealMetrics {
  /** A. CLOSED WITH EMPLOYEE — the DEAL_CLOSED dimension (dealClosedAt). */
  /** Total deals closed with the employee across the provided history
   *  (a deal exists in Qnalys only after closure with the employee). */
  closedWithEmployeeTotal: number;
  /** Closed with the employee during the period month (ANY current status). */
  closedWithEmployeeInPeriod: number;
  /** Monthly series (months with data only — no fabricated months). */
  closedWithEmployeeMonthly: MonthlyCount[];
  /** Deals with an UNKNOWN deal-closure date (legacy) — surfaced, never attributed. */
  closedWithEmployeeUnknownMonth: number;

  /** B. CURRENT STATUS snapshot over the whole provided history (verbatim vocabulary). */
  byStatus: Record<DealStatusVocabulary, number>;

  /** C. COMPLETED BY PERIOD — the CLOSED dimension (closedAt, completed deals). */
  completedTotal: number;
  completedInPeriod: number;
  completedMonthly: MonthlyCount[];
  completedUnknownMonth: number;

  /** D. TRAVEL BY PERIOD — the TRAVEL dimension (departureDate). */
  travelInPeriod: number;
  travelMonthly: MonthlyCount[];

  /** CREATED dimension (createdAt — intake activity). */
  createdInPeriod: number;
  createdMonthly: MonthlyCount[];

  /** The unique deals the metrics were built from (traceability). */
  uniqueDealCount: number;
}

/** Defensive §10 guarantee: a dataset of deals counted ONCE per id.
 *  Records without a usable id pass through (dedupe impossible) —
 *  canonical datasets always carry ids. */
export function uniqueDealsById<T>(deals: ReadonlyArray<T>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const d of deals) {
    if (!d || typeof d !== 'object') continue;
    const id = (d as { id?: unknown }).id;
    if (typeof id === 'string' && id.length > 0) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(d);
  }
  return out;
}

function monthlyOf(deals: ReadonlyArray<DealDateSource>, basis: DealDateBasis, windowSet: ReadonlySet<string>): MonthlyCount[] {
  const map = new Map<string, number>();
  for (const d of deals) {
    const mk = getDealDateMonthKey(d, basis);
    if (mk && windowSet.has(mk)) map.set(mk, (map.get(mk) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * THE canonical deal metrics builder (§11): one place that turns a
 * deal dataset + period into every deal metric the app reports.
 * Status-independent by construction — the CLOSED-WITH-EMPLOYEE
 * family never requires status='completed', the COMPLETED family
 * always does, and the two never merge.
 */
export function buildDealMetrics(
  deals: ReadonlyArray<DealDateSource & { id: string; status: DealStatusVocabulary }>,
  options: DealMetricsInput = {},
): DealMetrics {
  const period = options.periodMonthKey ?? null;
  const windowMonths = options.windowMonths ?? (period ? [period] : []);
  const windowSet = new Set(windowMonths);
  const statusFilter = options.status ?? 'all';

  // §10 — count UNIQUE deals exactly once (ids deduped, first wins).
  const unique = uniqueDealsById(deals);
  const scoped = statusFilter === 'all'
    ? unique
    : unique.filter((d) => d.status === statusFilter);

  const byStatus: DealMetrics['byStatus'] = { upcoming: 0, in_progress: 0, completed: 0, canceled: 0 };
  let closedWithEmployeeUnknownMonth = 0;
  let completedUnknownMonth = 0;
  let completedTotal = 0;
  for (const d of scoped) {
    if (byStatus[d.status] !== undefined) byStatus[d.status] += 1;
    const dealClosedMonth = getDealDateMonthKey(d, 'dealClosedAt');
    if (!dealClosedMonth) closedWithEmployeeUnknownMonth += 1;
    if (d.status === 'completed') {
      completedTotal += 1;
      if (!getDealDateMonthKey(d, 'closedAt')) completedUnknownMonth += 1;
    }
  }

  const closedWithEmployeeInPeriod = period
    ? scoped.filter((d) => getDealDateMonthKey(d, 'dealClosedAt') === period).length
    : 0;
  const completedInPeriod = period
    ? scoped.filter((d) => d.status === 'completed' && getDealDateMonthKey(d, 'closedAt') === period).length
    : 0;
  const travelInPeriod = period
    ? scoped.filter((d) => getDealDateMonthKey(d, 'departureDate') === period).length
    : 0;
  const createdInPeriod = period
    ? scoped.filter((d) => getDealDateMonthKey(d, 'createdAt') === period).length
    : 0;

  return {
    closedWithEmployeeTotal: scoped.length,
    closedWithEmployeeInPeriod,
    closedWithEmployeeMonthly: monthlyOf(scoped, 'dealClosedAt', windowSet),
    closedWithEmployeeUnknownMonth,
    byStatus,
    completedTotal,
    completedInPeriod,
    completedMonthly: monthlyOf(scoped.filter(isCompletedDeal), 'closedAt', windowSet),
    completedUnknownMonth,
    travelInPeriod,
    travelMonthly: monthlyOf(scoped, 'departureDate', windowSet),
    createdInPeriod,
    createdMonthly: monthlyOf(scoped, 'createdAt', windowSet),
    uniqueDealCount: scoped.length,
  };
}
