// ══════════════════════════════════════════════════════════════
//  Cache Freshness Policy — §CACHE-POLICY (single source of truth)
//
//  ONE centralized policy for client data-cache freshness. Every
//  domain's staleTime/gcTime is declared here with its derivation —
//  no magic numbers scattered across components (§12).
//
//  DERIVATION RULES (measured from the existing system, not invented):
//    • Per-domain staleTimes reproduce the staleTime each domain
//      ALREADY used in use-queries.ts / use-kpi-queries.ts /
//      use-report-queries.ts / use-aocc.ts before this layer existed.
//    • The default gcTime is raised 5min → 30min so navigating back
//      to a page inside a work session restores the last snapshot
//      instead of a skeleton (§9/§28/§31), while remaining bounded:
//      the QueryClient garbage-collects unused entries, so the cache
//      holds at most the domains touched in the last window (§29).
//    • Reference/organization data gets a longer gcTime — it changes
//      rarely and is cheap to keep (§12 REFERENCE_DATA/ORGANIZATION).
//    • Server-side in-process TTLs (lib/db.ts: DEFAULT 5s, MEDIUM 15s,
//      LONG 30s, STATIC 60s, POLL 30s) remain the server's own layer —
//      unchanged. Client staleTime ≥ server TTL where they pair.
// ══════════════════════════════════════════════════════════════

/** How long a cached snapshot may be shown without a background revalidation. */
export const DEFAULT_STALE_TIME_MS = 30_000;

/**
 * How long an unused cache entry survives after its last observer
 * unmounts. 30 minutes covers a normal work session: leaving a page
 * and coming back restores the snapshot instantly (§28) instead of
 * re-downloading it, while the cache can never grow unbounded (§29).
 */
export const DEFAULT_GC_TIME_MS = 30 * 60_000;

/** Long retention for reference data that rarely changes (§12). */
export const REFERENCE_GC_TIME_MS = 60 * 60_000;

export interface DomainFreshness {
  /** Fresh window — no network request while younger than this. */
  staleTime: number;
  /** Retention after the last consumer unmounts (bounded memory, §29). */
  gcTime?: number;
}

/**
 * Domain freshness policy. Keys are canonical domain ids shared with
 * the invalidation dependency map (lib/cache/invalidation.ts).
 * Each entry's derivation is commented at the domain.
 */
export const CACHE_FRESHNESS: Record<string, DomainFreshness> = {
  // HOME — heavy aggregate; existing useHomeStats staleTime 15s.
  homeStats: { staleTime: 15_000 },

  // EMPLOYEES — reference-ish operational data; existing 30s.
  employees: { staleTime: 30_000, gcTime: REFERENCE_GC_TIME_MS },
  // Org nodes for the assignment picker; existing 60s.
  orgNodesForAssignment: { staleTime: 60_000, gcTime: REFERENCE_GC_TIME_MS },
  // Organization page + positions; reference data (§12 ORGANIZATION).
  organization: { staleTime: 60_000, gcTime: REFERENCE_GC_TIME_MS },
  // dashboard/users variants (dept filter dropdowns, follow-up actors);
  // new hooks — 30s matches the employees reference profile.
  dashboardUsers: { staleTime: 30_000, gcTime: REFERENCE_GC_TIME_MS },

  // OPERATIONAL LISTS — reproduce each page's existing staleTime.
  followUps: { staleTime: 10_000 },        // existing useFollowUps 10s
  quality: { staleTime: 15_000 },          // existing useQuality 15s
  attendance: { staleTime: 15_000 },       // existing useAttendance 15s
  requests: { staleTime: 10_000 },         // existing useRequests 10s
  travel: { staleTime: 10_000 },           // existing useTravel 10s
  biometrics: { staleTime: 30_000 },       // existing useBiometrics 30s
  rules: { staleTime: 60_000 },            // existing useRules 60s
  ruleLogs: { staleTime: 10_000 },         // operational log stream
  capaCases: { staleTime: 10_000 },        // existing useCAPACases 10s
  complaints: { staleTime: 10_000 },       // existing useComplaints 10s
  knowledgeBase: { staleTime: 10_000 },    // existing useKnowledgeBase 10s
  hrDeductions: { staleTime: 15_000 },     // mirrors quality freshness
  riskCenter: { staleTime: 15_000 },       // existing useRiskCenter 15s

  // EMPLOYEE 360 — per-employee aggregate; 30s matches employees.
  employee360: { staleTime: 30_000 },
  // Performance analytics — server caches results 10min
  // (lib/analytics/service.ts CACHE_TTL_MS); client 60s.
  employeePerformance: { staleTime: 60_000 },

  // QUALITY KPI SUITE — existing use-kpi-queries staleTimes.
  kpiObservations: { staleTime: 15_000 },  // existing 15s
  kpiDashboard: { staleTime: 30_000 },     // existing 30s
  kpiCategories: { staleTime: 60_000, gcTime: REFERENCE_GC_TIME_MS }, // existing 60s
  kpiTemplates: { staleTime: 30_000, gcTime: REFERENCE_GC_TIME_MS },  // existing 30s
  kpiSettings: { staleTime: 60_000, gcTime: REFERENCE_GC_TIME_MS },   // existing 60s
  kpiSchemes: { staleTime: 60_000, gcTime: REFERENCE_GC_TIME_MS },    // existing 60s
  // Month snapshots — frozen when closed, live preview when open.
  // 30s default (§15: a finalized report must remain reproducible —
  // closed snapshots are returned verbatim by the server regardless).
  kpiSnapshots: { staleTime: 30_000 },
  kpiAuditLog: { staleTime: 15_000 },      // existing 15s
  kpiReports: { staleTime: 60_000 },       // report payloads (existing family)
  kpiEmployeeResult: { staleTime: 30_000 },// existing 30s

  // REPORTS ENGINE — existing use-report-queries staleTimes.
  reportsCatalog: { staleTime: 60_000 },
  reportsFilterOptions: { staleTime: 300_000, gcTime: REFERENCE_GC_TIME_MS },
  reportsRun: { staleTime: 15_000 },

  // PERSONAL / SMALL — existing values.
  profile: { staleTime: 60_000 },
  userPreferences: { staleTime: 30_000 },
  unseen: { staleTime: 30_000 },
  notificationPopover: { staleTime: 30_000 }, // enabled only while open
  evidence: { staleTime: 60_000 },            // existing use-evidence 60s

  // AOCC / OPS MONITORS — existing use-aocc values.
  aoccOperational: { staleTime: 15_000 },
  activityLogs: { staleTime: 10_000 },
};

/** Look up a domain's freshness with the policy default as fallback. */
export function freshnessFor(domain: string): DomainFreshness {
  return CACHE_FRESHNESS[domain] ?? { staleTime: DEFAULT_STALE_TIME_MS };
}
