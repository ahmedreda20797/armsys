// ══════════════════════════════════════════════════════════════
//  Deal dates — THE canonical semantic date contract (§DEAL-DATES)
//
//  A travel deal carries THREE independent business dates. Every
//  deal-derived metric in Qnalys must resolve its reporting period
//  through THIS module — no page, report or export may privately
//  decide that "the deal's month" means any particular field:
//
//    CREATED → createdAt      record creation / intake activity
//    CLOSED  → closedAt       observed successful completion
//                             (productivity, closed-deal counts)
//    TRAVEL  → departureDate  the customer's travel date
//                             (travel operations, travel volume)
//
//  The same deal legitimately belongs to DIFFERENT reporting periods
//  for different metrics. Attribution is DETERMINISTIC and
//  CONSERVATIVE: a dimension whose date is missing/unparseable is
//  UNKNOWN (null) — there is NO hidden fallback between dimensions
//  (a missing closedAt is never replaced by departureDate or
//  createdAt, and vice versa).
// ══════════════════════════════════════════════════════════════

import type { TravelDeal } from '@/types';
import { monthKeyOfDisplayDate, monthKeyOfIso } from '@/lib/performance-intelligence/month-attribution';

/** The three canonical deal date dimensions. */
export type DealDateDimension = 'CREATED' | 'CLOSED' | 'TRAVEL';

/** Arabic labels making the semantic meaning explicit wherever a period is shown. */
export const DEAL_DATE_DIMENSION_LABELS_AR: Record<DealDateDimension, string> = {
  CREATED: 'تاريخ إنشاء الصفقة',
  CLOSED: 'تاريخ إغلاق الصفقة',
  TRAVEL: 'تاريخ السفر (المغادرة)',
};

/** Minimal structural slice any caller must provide. */
export type DealDateSource = Pick<TravelDeal, 'createdAt' | 'departureDate'> & {
  closedAt?: string | null;
};

/**
 * The canonical business date for one dimension.
 *
 *   CREATED → createdAt (ISO engine timestamp)
 *   CLOSED  → closedAt  (ISO engine timestamp) — null when the
 *             closure moment is unknown; NEVER a derived fallback
 *   TRAVEL  → departureDate (the app's DD/MM/YYYY display contract)
 *
 * Returns null when the dimension's own date is missing — never a
 * date borrowed from another dimension.
 */
export function getDealBusinessDate(deal: DealDateSource, dimension: DealDateDimension): string | null {
  switch (dimension) {
    case 'CREATED':
      return typeof deal.createdAt === 'string' && deal.createdAt.length > 0 ? deal.createdAt : null;
    case 'CLOSED':
      return typeof deal.closedAt === 'string' && deal.closedAt.length > 0 ? deal.closedAt : null;
    case 'TRAVEL':
      return typeof deal.departureDate === 'string' && deal.departureDate.length > 0 ? deal.departureDate : null;
  }
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
 * The canonical entry point for "closed deals in month X" — callers
 * must not filter by departureDate for sales/productivity numbers.
 */
export function countClosedDealsForMonth(
  deals: ReadonlyArray<DealDateSource & { status: TravelDeal['status'] }>,
  monthKey: string,
): DealClosurePeriodCounts {
  let closed = 0;
  let unknown = 0;
  for (const d of deals) {
    if (!isCompletedDeal(d)) continue;
    const mk = getDealMonthKey(d, 'CLOSED');
    if (mk === monthKey) closed += 1;
    else if (mk === null) unknown += 1;
  }
  return { closed, unknown };
}
