// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — REQUEST-SCOPED LOADERS (§GROUP-REPORTING)
//
//  A multi-member group report builds N canonical hub datasets that
//  ALL touch the same collections (employees, orgNodes). Through the
//  default loaders each member paid:
//    • 2 × getById('employees', id) for the identity (KPI dataset +
//      hub org context) — point reads with NO lib/db TTL cache, so a
//      50-member group issued ~100 point reads per request;
//    • 2 × loadEmployeeRecord (another uncached point read + a
//      per-call org-index rebuild) per member;
//    • a fresh loadOrgNodes mapping per member (CPU + array churn).
//
//  This factory wraps the CANONICAL loader set with per-request
//  memoization: the employees table is read ONCE (lib/db TTL cache)
//  and projected into per-id views in memory, orgNodes is loaded and
//  mapped ONCE. Zero engine duplication — every value still comes
//  from the same canonical projection functions (toIdentityRecord /
//  toReportEmployee / the shared org resolver).
//
//  SAFETY:
//    • The memo lives ONLY in the returned object — the caller holds
//      it for the duration of ONE request. Nothing is cached across
//      requests, and nothing user-specific is cached at all: the
//      loaders read whole shared collections (employees, orgNodes)
//      that are identical for every viewer; per-employee filtering
//      happens downstream in the engines, unchanged.
//    • Data equivalence: the default identity/record loaders do a
//      point read of the SAME employees rows and apply the SAME
//      projection; the scoped loaders do a full-table read of the
//      SAME rows (lib/db TTL.MEDIUM) and apply the same projections.
//      Within one request the whole report now sees ONE consistent
//      employees snapshot (the same read the population resolution
//      already used) instead of mixing per-member point reads.
//    • Failed loads clear their memo slot so a later member retries
//      instead of inheriting a rejected promise.
// ══════════════════════════════════════════════════════════════

import { getAll, TTL } from '@/lib/db';
import {
  defaultPerformanceIntelligenceLoaders,
  toIdentityRecord,
} from '@/lib/performance-intelligence';
import type { EmployeeIdentityRecord, PerformanceIntelligenceLoaders } from '@/lib/performance-intelligence';
import { defaultKpiReportingLoaders } from '@/lib/kpi-reporting';
import type { ReportEmployee } from '@/lib/kpi-reporting';
import { toFrameworkEmployee } from '@/lib/kpi-framework/employee-result';
import type { KpiFrameworkEmployee } from '@/lib/kpi-framework/types';

/** Memoize ONE async computation per request; failures don't poison the slot. */
function memoize<T>(run: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => {
    if (!promise) {
      promise = run().catch((error) => {
        promise = null; // rejected loads retry for later callers
        throw error;
      });
    }
    return promise;
  };
}

/**
 * Create a loader set for ONE multi-employee request. All loaders the
 * hub/engines touch are the canonical defaults except:
 *   • loadEmployeeIdentity — one employees read → per-id projection;
 *   • loadEmployeeRecord   — the same table through the canonical
 *     loadEmployees() projection (org-label resolution included);
 *   • loadEmployee         — the engine's slim projection
 *     (toFrameworkEmployee) from the same single read;
 *   • loadOrgNodes         — loaded/mapped once per request.
 */
export function createRequestScopedHubLoaders(): PerformanceIntelligenceLoaders {
  // ONE employees read → EmployeeIdentityRecord projections (identity facts).
  const loadIdentityMap = memoize(async () => {
    const rows = await getAll<Record<string, unknown>>('employees', TTL.MEDIUM);
    const map = new Map<string, EmployeeIdentityRecord>();
    for (const row of rows) {
      if (row && typeof row.id === 'string') map.set(row.id, toIdentityRecord(row, row.id));
    }
    return map;
  });

  // The canonical full reporting projection (includes org-label
  // department resolution) — one loadEmployees() per request.
  const loadReportEmployeeMap = memoize(async () => {
    const employees = await defaultKpiReportingLoaders.loadEmployees();
    const map = new Map<string, ReportEmployee>();
    for (const employee of employees) map.set(employee.id, employee);
    return map;
  });

  // ONE employees read → the ENGINE's slim employee projection
  // (toFrameworkEmployee, reused verbatim — zero projection drift).
  const loadFrameworkEmployeeMap = memoize(async () => {
    const rows = await getAll<Record<string, unknown>>('employees', TTL.MEDIUM);
    const map = new Map<string, KpiFrameworkEmployee>();
    for (const row of rows) {
      if (row && typeof row.id === 'string') map.set(row.id, toFrameworkEmployee(row, row.id));
    }
    return map;
  });

  const loadOrgNodesOnce = memoize(() => defaultPerformanceIntelligenceLoaders.loadOrgNodes());

  return {
    ...defaultPerformanceIntelligenceLoaders,

    loadEmployeeIdentity: async (employeeId) => {
      const map = await loadIdentityMap();
      return map.get(employeeId) ?? null;
    },

    loadEmployeeRecord: async (employeeId) => {
      const map = await loadReportEmployeeMap();
      return map.get(employeeId) ?? null;
    },

    loadEmployee: async (employeeId) => {
      const map = await loadFrameworkEmployeeMap();
      return map.get(employeeId) ?? null;
    },

    loadOrgNodes: () => loadOrgNodesOnce(),
  };
}
