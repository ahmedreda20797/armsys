// ══════════════════════════════════════════════════════════════
//  Mutation-Aware Targeted Invalidation — §CACHE-INVALIDATION
//
//  ONE dependency map: which cache domains are AFFECTED by each
//  mutation family (§18-§23, §44). Mutations call
//  `invalidateDomain(queryClient, domain, ctx)` instead of scattering
//  raw invalidateQueries calls — this is what makes
//  "mutation → only affected UI updates" hold everywhere.
//
//  WHY PREFIX INVALIDATION IS SAFE AND CHEAP:
//  invalidateQueries only REFETCHES queries that are currently
//  mounted; unmounted entries are just marked stale (zero network).
//  So listing the true dependents (Home aggregates, risk center,
//  Employee 360) costs nothing when those surfaces are not open, and
//  updates exactly them when they are (§38/§39). There is deliberately
//  NO "invalidate everything" default (§23) — AOCC-style full refresh
//  is an explicit opt-in via REFRESH_ALL_DOMAINS.
//
//  WHAT IS DELIBERATELY EXCLUDED:
//    • ['kpi','snapshots'] from deal/attendance/follow-up mutations —
//      KPI month snapshots are computed from qualityObservations only;
//      broad invalidation would recompute frozen-month surfaces for
//      nothing (§15/§40).
//    • Notification keys — mark-read updates its own cache directly
//      (NotificationContext local state + popover query); no list
//      refetch per mark-read (§22).
//    • ['unseen','summary'] — badge counts derive from per-user
//      lastSeenAt vs createdAt with a 90s poll; a mutation on this
//      user's behalf must not clear other users' badge semantics.
// ══════════════════════════════════════════════════════════════

import type { QueryClient } from '@tanstack/react-query';

/** The subject of a scoped mutation, when known. */
export interface InvalidationContext {
  /** Employee the mutated record belongs to — scopes Employee 360 /
   *  performance invalidation to that subject only (§39). */
  employeeId?: string;
}

/** Canonical domain names shared with CACHE_FRESHNESS (cache-policy). */
export type MutationDomain =
  | 'homeStats'
  | 'employees'
  | 'organization'
  | 'dashboardUsers'
  | 'attendance'
  | 'requests'
  | 'rules'
  | 'quality'
  | 'qualityObservations'
  | 'travel'
  | 'biometrics'
  | 'followUps'
  | 'capaCases'
  | 'complaints'
  | 'knowledgeBase'
  | 'hrDeductions'
  | 'riskCenter'
  | 'employee360'
  | 'employeePerformance'
  | 'kpiSnapshots'
  | 'kpiDashboard'
  | 'profile'
  | 'userPreferences';

/**
 * The dependency map. Values are key PREFIXES (partial keys match all
 * entries beneath them — React Query structural sharing). Employee
 * subject keys are appended at call time from the context.
 */
export const DOMAIN_DEPENDENCIES: Record<MutationDomain, readonly (readonly string[])[]> = {
  // Home stats themselves (manual refresh / direct updates).
  homeStats: [['home', 'stats']],

  // Employee create/update/delete: headcount feeds Home; the org tree
  // counts employees; the subject's 360 changes.
  employees: [
    ['employees'],
    ['home', 'stats'],
    ['organization'],
    ['riskCenter'],
  ],

  // Org moves already refresh employees+organization (preserved).
  organization: [['organization'], ['employees'], ['employees', 'org-nodes']],

  // dashboard/users feeds manager pickers and role selects.
  dashboardUsers: [['dashboard', 'users']],

  // Attendance: Home today-attendance metric + the subject's 360.
  attendance: [['attendance'], ['home', 'stats']],

  // Requests: Home pending-requests metric (existing behavior).
  requests: [['requests'], ['home', 'stats']],

  // Rules rarely affect aggregates; keep the existing narrow behavior.
  rules: [['rules']],

  // Legacy quality deductions.
  quality: [['quality'], ['home', 'stats'], ['riskCenter']],

  // Quality observations drive the whole KPI pipeline + derived
  // surfaces (existing kpi-queries invalidations, plus Home/risk/360).
  qualityObservations: [
    ['kpi', 'observations'],
    ['kpi', 'dashboard'],
    ['kpi', 'snapshots'],
    ['quality'],
    ['home', 'stats'],
    ['riskCenter'],
  ],

  // Deals: the deal list, Home travel/closed metrics, risk, and the
  // owner's 360/performance surfaces (§19). KPI snapshots excluded —
  // the KPI pipeline is observation-driven (§40).
  travel: [['travel'], ['home', 'stats'], ['riskCenter']],

  biometrics: [['biometrics']],

  // Follow-ups: the follow-up surfaces, Home today's follow-ups, risk
  // signals (§18/§44).
  followUps: [['followUps'], ['home', 'stats'], ['riskCenter']],

  capaCases: [['capaCases'], ['home', 'stats'], ['riskCenter']],

  complaints: [['complaints'], ['home', 'stats'], ['riskCenter']],

  knowledgeBase: [['knowledgeBase']],

  hrDeductions: [['hrDeductions'], ['home', 'stats'], ['riskCenter']],

  riskCenter: [['riskCenter']],

  employee360: [], // subject-scoped — built from ctx (see invalidateDomain)
  employeePerformance: [], // subject-scoped — built from ctx

  // Month close/reopen: the affected month + any snapshot lists +
  // the KPI dashboard (existing behavior preserved).
  kpiSnapshots: [['kpi', 'snapshots'], ['kpi', 'dashboard']],

  kpiDashboard: [['kpi', 'dashboard']],

  profile: [['profile']],

  userPreferences: [['userPreferences']],
};

/** Subjects whose 360/performance caches depend on the mutation. */
export const SUBJECT_SCOPED_DOMAINS: readonly MutationDomain[] = [
  'employees',
  'quality',
  'qualityObservations',
  'travel',
  'attendance',
  'followUps',
  'capaCases',
  'complaints',
  'hrDeductions',
];

function pushKeysForDomain(
  out: string[][],
  domain: MutationDomain,
  ctx?: InvalidationContext,
): void {
  if (domain === 'employee360') {
    if (ctx?.employeeId) out.push(['employee360', ctx.employeeId]);
    return;
  }
  if (domain === 'employeePerformance') {
    if (ctx?.employeeId) out.push(['employee-performance', ctx.employeeId]);
    return;
  }

  for (const key of DOMAIN_DEPENDENCIES[domain]) {
    out.push([...key]);
  }

  // Subject-scoped surfaces: invalidate the mutated record's Employee
  // 360 + performance caches — only those subjects, never all (§39).
  if (ctx?.employeeId && SUBJECT_SCOPED_DOMAINS.includes(domain)) {
    out.push(['employee360', ctx.employeeId]);
    out.push(['employee-performance', ctx.employeeId]);
  }
}

/**
 * Invalidate every cache entry affected by a mutation of `domain`.
 * Deduplicated and order-stable; never throws.
 */
export function invalidateDomain(
  queryClient: QueryClient,
  domain: MutationDomain,
  ctx?: InvalidationContext,
): void {
  const keys: string[][] = [];
  pushKeysForDomain(keys, domain, ctx);

  const seen = new Set<string>();
  for (const key of keys) {
    const id = JSON.stringify(key);
    if (seen.has(id)) continue;
    seen.add(id);
    queryClient.invalidateQueries({ queryKey: key });
  }
}

/**
 * Invalidate several domains with one coalesced pass (§23) — e.g. the
 * AOCC manual refresh or a mutation that legitimately spans domains.
 */
export function invalidateDomains(
  queryClient: QueryClient,
  domains: readonly MutationDomain[],
  ctx?: InvalidationContext,
): void {
  for (const domain of domains) {
    invalidateDomain(queryClient, domain, ctx);
  }
}

/**
 * Explicit full-refresh opt-in (AOCC header refresh, manual reloads).
 * NOT used by ordinary mutations (§23).
 */
export const REFRESH_ALL_DOMAINS: readonly MutationDomain[] = [
  'homeStats',
  'employees',
  'attendance',
  'requests',
  'travel',
  'followUps',
  'quality',
  'qualityObservations',
  'capaCases',
  'complaints',
  'riskCenter',
  'dashboardUsers',
];
