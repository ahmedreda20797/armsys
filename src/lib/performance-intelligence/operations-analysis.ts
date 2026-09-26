// ══════════════════════════════════════════════════════════════
//  Employee Performance Intelligence — Operations Analysis (Phase 3)
//
//  PURE aggregations over the employee's EXISTING operational
//  records. Every timing/status definition is REUSED from the
//  canonical metric modules — no second "late"/"overdue" vocabulary:
//    • CAPA       → lib/metrics/capaMetrics (isOverdueCAPA,
//                   capaOverdueDays, ACTIVE/TERMINAL_CAPA_STATUSES)
//    • Follow-ups → lib/metrics/followUpMetrics (isOverdueFollowUp,
//                   isDueToday, followUpOverdueDays, ACTIVE/TERMINAL)
//  Relationships are the ACTUAL stored links — no invented ones:
//    • complaints : direct (optional) employeeId; dealId is a fact
//    • CAPA       : direct (optional) employeeId + relatedEmployeeIds
//    • follow-ups : mandatory employeeId
//    • travel     : mandatory employeeId (operational facts only —
//                   response time does not exist in the model and is
//                   never invented)
// ══════════════════════════════════════════════════════════════

import type { CAPACase, CustomerComplaint, FollowUp, TravelDeal } from '@/types';
import {
  ACTIVE_CAPA_STATUSES,
  isClosedCAPA,
  isOverdueCAPA,
  capaOverdueDays,
} from '@/lib/metrics/capaMetrics';
import {
  isActiveFollowUp,
  isTerminalFollowUp,
  isDueToday,
  isOverdueFollowUp,
  followUpOverdueDays,
} from '@/lib/metrics/followUpMetrics';
import { roundTo2 } from '@/lib/kpi-framework/validation';
import { buildDealMetrics } from '@/lib/deal-dates';
import { displayDateOrderKey } from './month-attribution';
import type {
  CapaFacts,
  ComplaintFacts,
  FollowUpFacts,
  MonthlyCount,
  RepeatedIssueGroup,
  TravelDealFacts,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function byCountThenKey(a: RepeatedIssueGroup, b: RepeatedIssueGroup): number {
  return b.occurrenceCount - a.occurrenceCount || a.issueKey.localeCompare(b.issueKey);
}

function incrementDateBounds(
  bounds: { first: string | null; last: string | null; firstOrder: number; lastOrder: number },
  date: string,
): void {
  const order = displayDateOrderKey(date);
  if (order === null) return;
  if (order < bounds.firstOrder) {
    bounds.firstOrder = order;
    bounds.first = date;
  }
  if (order > bounds.lastOrder) {
    bounds.lastOrder = order;
    bounds.last = date;
  }
}

/** Mean of parseable (createdAt → resolvedAt/closedAt) day spans, rounded to 2. */
function avgDaySpan(
  records: ReadonlyArray<{ start: string | null; end: string | null }>,
): number | null {
  const spans: number[] = [];
  for (const record of records) {
    if (!record.start || !record.end) continue;
    const start = new Date(record.start).getTime();
    const end = new Date(record.end).getTime();
    if (isNaN(start) || isNaN(end) || end < start) continue;
    spans.push((end - start) / DAY_MS);
  }
  if (spans.length === 0) return null;
  return roundTo2(spans.reduce((sum, d) => sum + d, 0) / spans.length);
}

// ─────────────────────────────────────────────────────────────
//  §9  Complaints
// ─────────────────────────────────────────────────────────────

/**
 * Aggregate complaints attributed to the employee (records passed in
 * are ALREADY narrowed to `employeeId === employee` — a complaint
 * without a stored employeeId is never attributed here).
 */
export function aggregateComplaints(args: {
  complaints: ReadonlyArray<CustomerComplaint>;
  minOccurrences?: number;
  /** §14 window trend series (computed by the assembler from attributed records). */
  monthly?: ReadonlyArray<MonthlyCount>;
  now?: Date;
}): ComplaintFacts {
  const min = args.minOccurrences ?? 2;
  const { complaints } = args;

  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const typeGroups = new Map<string, { ids: string[]; bounds: { first: string | null; last: string | null; firstOrder: number; lastOrder: number } }>();

  for (const complaint of complaints) {
    increment(byStatus, complaint.status);
    increment(byType, complaint.complaintType || 'other');
    increment(bySeverity, complaint.severity);
    const typeKey = complaint.complaintType || 'other';
    const group = typeGroups.get(typeKey) ?? {
      ids: [],
      bounds: { first: null, last: null, firstOrder: Number.POSITIVE_INFINITY, lastOrder: Number.NEGATIVE_INFINITY },
    };
    group.ids.push(complaint.id);
    incrementDateBounds(group.bounds, complaint.createdAt);
    typeGroups.set(typeKey, group);
  }

  const repeatedTypes: RepeatedIssueGroup[] = [];
  for (const [issueKey, group] of typeGroups) {
    if (group.ids.length < min) continue;
    repeatedTypes.push({
      issueKey,
      label: issueKey,
      occurrenceCount: group.ids.length,
      firstOccurrence: group.bounds.first,
      lastOccurrence: group.bounds.last,
      observationIds: [...group.ids].sort((a, b) => a.localeCompare(b)),
    });
  }

  return {
    relationship: 'CONFIRMED',
    total: complaints.length,
    byStatus,
    byType,
    bySeverity,
    repeatedTypes: repeatedTypes.sort(byCountThenKey),
    resolvedOrClosed: complaints.filter((c) => c.status === 'resolved' || c.status === 'closed').length,
    stillOpen: complaints.filter((c) => c.status === 'open' || c.status === 'under_investigation' || c.status === 'pending_resolution').length,
    viaDealCount: complaints.filter((c) => typeof c.dealId === 'string' && c.dealId.length > 0).length,
    avgResolutionDays: avgDaySpan(
      complaints.map((c) => ({ start: c.createdAt, end: c.resolvedAt })),
    ),
    monthly: [...(args.monthly ?? [])],
  };
}

// ─────────────────────────────────────────────────────────────
//  §10  CAPA
// ─────────────────────────────────────────────────────────────

/**
 * Aggregate CAPA cases whose PRIMARY link is the employee
 * (`employeeId === employee` — cases passed in are already narrowed).
 * Workflow statuses are counted as stored; overdue uses the
 * canonical capaMetrics definition only.
 */
export function aggregateCapaCases(args: {
  capaCases: ReadonlyArray<CAPACase>;
  /** Cases linked only through relatedEmployeeIds (INDIRECT). */
  indirectCount: number;
  /** §14 window trend series (computed by the assembler from attributed records). */
  monthly?: ReadonlyArray<MonthlyCount>;
  now: Date;
}): CapaFacts {
  const { capaCases, now } = args;

  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const correctiveStatus: CapaFacts['correctiveStatus'] = { not_started: 0, in_progress: 0, completed: 0 };
  const preventiveStatus: CapaFacts['preventiveStatus'] = { not_started: 0, in_progress: 0, completed: 0 };

  let active = 0;
  let terminal = 0;
  let overdue = 0;
  let overdueDaysSum = 0;
  let closedCount = 0;

  for (const capa of capaCases) {
    increment(byStatus, capa.status);
    increment(byPriority, capa.priority);
    increment(bySource, capa.source);
    if (correctiveStatus[capa.correctiveStatus] !== undefined) correctiveStatus[capa.correctiveStatus] += 1;
    if (preventiveStatus[capa.preventiveStatus] !== undefined) preventiveStatus[capa.preventiveStatus] += 1;
    if ((ACTIVE_CAPA_STATUSES as readonly string[]).includes(capa.status)) active += 1;
    if (isClosedCAPA(capa)) closedCount += 1;
    if ((['closed', 'rejected'] as readonly string[]).includes(capa.status)) terminal += 1;
    if (isOverdueCAPA(capa, now)) {
      overdue += 1;
      overdueDaysSum += capaOverdueDays(capa, now);
    }
  }

  return {
    relationship: 'CONFIRMED',
    total: capaCases.length,
    byStatus,
    byPriority,
    bySource,
    active,
    terminal,
    overdue,
    avgOverdueDays: overdue > 0 ? roundTo2(overdueDaysSum / overdue) : null,
    correctiveStatus,
    preventiveStatus,
    closedCount,
    avgClosureDays: avgDaySpan(
      capaCases
        .filter((c) => isClosedCAPA(c))
        .map((c) => ({ start: c.createdAt, end: c.closedAt ?? (c.closureDate || null) })),
    ),
    indirectCount: args.indirectCount,
    monthly: [...(args.monthly ?? [])],
  };
}

// ─────────────────────────────────────────────────────────────
//  §11  Follow-ups
// ─────────────────────────────────────────────────────────────

/**
 * Aggregate follow-ups for the employee (records passed in are
 * already narrowed). Overdue/due-today reuse the CANONICAL
 * followUpMetrics definitions computed on read — no new "late"
 * definition is introduced (spec §11).
 */
export function aggregateFollowUps(args: {
  followUps: ReadonlyArray<FollowUp>;
  /** §14 window trend series (computed by the assembler from attributed records). */
  monthly?: ReadonlyArray<MonthlyCount>;
  now: Date;
}): FollowUpFacts {
  const { followUps, now } = args;

  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byPriority: Record<string, number> = {};

  let active = 0;
  let terminal = 0;
  let overdue = 0;
  let dueToday = 0;
  let overdueDaysSum = 0;

  for (const followUp of followUps) {
    increment(byStatus, followUp.status);
    increment(byType, followUp.followUpType || 'other');
    increment(byPriority, followUp.priorityLevel);
    if (isActiveFollowUp(followUp)) active += 1;
    if (isTerminalFollowUp(followUp)) terminal += 1;
    if (isDueToday(followUp, now)) dueToday += 1;
    if (isOverdueFollowUp(followUp, now)) {
      overdue += 1;
      overdueDaysSum += followUpOverdueDays(followUp, now);
    }
  }

  const completed = followUps.filter((f) => f.status === 'resolved' || f.status === 'closed').length;

  return {
    relationship: 'CONFIRMED',
    total: followUps.length,
    byStatus,
    active,
    terminal,
    overdue,
    dueToday,
    avgOverdueDays: overdue > 0 ? roundTo2(overdueDaysSum / overdue) : null,
    completed,
    completionRate: followUps.length > 0 ? roundTo2((completed / followUps.length) * 100) : null,
    byType,
    byPriority,
    monthly: [...(args.monthly ?? [])],
  };
}

// ─────────────────────────────────────────────────────────────
//  §12  Travel deals (§DEAL-DATES — dimension-explicit)
// ─────────────────────────────────────────────────────────────

/**
 * Aggregate the employee's travel deals with EXPLICIT date
 * dimensions (§DEAL-DATES). The counting core DELEGATES to the ONE
 * canonical builder (buildDealMetrics in lib/deal-dates.ts) — this
 * module projects the builder's result onto the employee-dataset
 * fact shape and adds the period-scope operational snapshot:
 *
 *   DEAL_CLOSED — dealClosedAt attribution → closed WITH the
 *                 employee (الصفقات المغلقة): all-time total,
 *                 in-period count, monthly series; legacy records
 *                 without the field surface as UNKNOWN (never
 *                 attributed, never derived).
 *   TRAVEL      — departure-month attribution → travel volume,
 *                 status snapshot, active/canceled, monthly series.
 *   CLOSED      — closedAt attribution → completed sales for
 *                 productivity; completed deals without a
 *                 trustworthy closure timestamp surface as UNKNOWN.
 *   CREATED     — createdAt attribution → intake activity.
 *
 * The stored status vocabulary is used verbatim ('canceled'
 * spelling included); no sales TARGET is invented — closure counts
 * are observed facts only.
 */
export function aggregateTravelDeals(args: {
  /** TRAVEL-period deals — status/count aggregates (period scope). */
  deals: ReadonlyArray<TravelDeal>;
  /** TRAVEL-window deals — monthly departure series (months with data only). */
  windowDeals: ReadonlyArray<TravelDeal>;
  /** Attributed TRAVEL month (departureDate) per deal id (null = unattributed). */
  monthByDealId: ReadonlyMap<string, string | null>;
  /** All the employee's deals — the period-dimension population. */
  allDeals: ReadonlyArray<TravelDeal>;
  /** Attributed CLOSED month (closedAt) per deal id (null = unknown). */
  closedMonthByDealId: ReadonlyMap<string, string | null>;
  /** Attributed CREATED month (createdAt) per deal id (null = unattributable). */
  createdMonthByDealId: ReadonlyMap<string, string | null>;
  windowMonths: ReadonlyArray<string>;
  /** The reported period's YYYY-MM key (attribution target). */
  periodMonthKey: string;
}): TravelDealFacts {
  const { deals, allDeals, windowMonths, periodMonthKey } = args;

  // ONE canonical counting core (§CANONICAL-DEAL-METRICS) — the same
  // builder Home stats and the Travel detail view count through.
  // (monthByDealId / closedMonthByDealId / createdMonthByDealId stay
  // in the signature for the caller's evidence graph; the counting
  // core derives month keys through the SAME canonical functions.)
  const metrics = buildDealMetrics(allDeals, { periodMonthKey, windowMonths });

  const byStatus: TravelDealFacts['byStatus'] = { upcoming: 0, in_progress: 0, completed: 0, canceled: 0 };
  for (const deal of deals) {
    if (byStatus[deal.status] !== undefined) byStatus[deal.status] += 1;
  }

  const completed = byStatus.completed;

  return {
    relationship: 'CONFIRMED',
    travelTotal: deals.length,
    byStatus,
    canceled: byStatus.canceled,
    active: byStatus.upcoming + byStatus.in_progress,
    completionRate: deals.length > 0 ? roundTo2((completed / deals.length) * 100) : null,
    // TRAVEL window series — from the same canonical core (months with
    // departures inside the window, no fabricated months).
    monthly: metrics.travelMonthly,
    // CLOSED dimension (closedAt) — the completion-period family.
    closedTotal: metrics.completedInPeriod,
    closedMonthly: metrics.completedMonthly,
    closedUnknownMonth: metrics.completedUnknownMonth,
    // CREATED dimension (createdAt) — the intake family.
    createdTotal: metrics.createdInPeriod,
    createdMonthly: metrics.createdMonthly,
    // DEAL_CLOSED dimension (dealClosedAt) — closed WITH the employee.
    closedWithEmployeeTotal: metrics.closedWithEmployeeTotal,
    closedWithEmployeeInPeriod: metrics.closedWithEmployeeInPeriod,
    closedWithEmployeeMonthly: metrics.closedWithEmployeeMonthly,
    closedWithEmployeeUnknownMonth: metrics.closedWithEmployeeUnknownMonth,
    // All-time current-status snapshot.
    statusAllTime: metrics.byStatus,
  };
}
