// ══════════════════════════════════════════════════════════════
//  Employee Performance Intelligence — Service (Phase 3)
//
//  Orchestrator: wires BATCHED, cached collection reads (spec §21)
//  to the PURE assembler. The KPI facts come from the canonical
//  Employee KPI report pipeline (Phase 2 → Phase 1 engine) run with
//  the SAME loader object — zero engine duplication, zero
//  recalculation.
//
//  READ-ONLY (spec §22): this service never writes to any
//  collection — observations, complaints, CAPA, follow-ups, deals,
//  employees and KPI snapshots are only read.
//
//  Business outcomes are data, never exceptions: the only thrown
//  errors are caller bugs (invalid month key) and DB failures.
// ══════════════════════════════════════════════════════════════

import { isValidMonthKey } from '@/lib/month-utils';
import { buildEmployeeKpiReport, trendWindow } from '@/lib/kpi-reporting';
import { buildOrgIndex, findAncestorOfType } from '@/lib/organization/graph';
import type { PerformanceIntelligenceLoaders } from './loaders';
import { defaultPerformanceIntelligenceLoaders } from './loaders';
import { assembleEmployeePerformanceDataset } from './assemble';
import type { EmployeePerformanceDataset } from './types';

/** Default analysis window INCLUDING the reported month (reporting parity). */
export const DEFAULT_WINDOW_MONTHS = 6;

export const MIN_WINDOW_MONTHS = 1;
export const MAX_WINDOW_MONTHS = 36;

export interface GetEmployeePerformanceDatasetInput {
  employeeId: string;
  /** YYYY-MM period. */
  monthKey: string;
  /** Analysis window length INCLUDING the reported month (default 6, clamped 1..36). */
  windowMonths?: number;
  /** Minimum occurrences for a repeated issue (default 2). */
  minOccurrences?: number;
  now?: Date;
  loaders?: PerformanceIntelligenceLoaders;
}

/**
 * Build the employee-period analytical dataset.
 *
 * Returns null ONLY when the employee does not exist (caller maps to
 * 404). Every other business outcome (archived employee, not-eligible
 * period, unresolved scheme, missing months) is explicit data inside
 * the dataset.
 */
export async function getEmployeePerformanceDataset(
  input: GetEmployeePerformanceDatasetInput,
): Promise<EmployeePerformanceDataset | null> {
  if (!isValidMonthKey(input.monthKey)) {
    throw new Error(`invalid month key: ${String(input.monthKey)}`);
  }

  const loaders = input.loaders ?? defaultPerformanceIntelligenceLoaders;
  const now = input.now ?? new Date();
  const windowLength = Math.max(
    MIN_WINDOW_MONTHS,
    Math.min(MAX_WINDOW_MONTHS, Math.trunc(input.windowMonths ?? DEFAULT_WINDOW_MONTHS)),
  );
  const window = trendWindow(input.monthKey, windowLength);

  // ── Identity first: a missing employee is the only null outcome ──
  const identity = await loaders.loadEmployeeIdentity(input.employeeId);
  if (!identity) return null;

  // ── Team label from the ORGANIZATION TREE (§REPORT-IDENTITY) ──
  // One extra cached read; the tree is authoritative, subteams roll up
  // to their parent team, and an unassigned employee resolves to null
  // (explicit unavailable downstream — never an invented label).
  const orgNodes = await loaders.loadOrgNodes();
  const team = identity.orgNodeId
    ? findAncestorOfType(buildOrgIndex(orgNodes as never), identity.orgNodeId, 'team')?.name ?? null
    : null;

  // ── Canonical KPI report (Phase 2 → Phase 1 engine, same loaders) ──
  // ── Batched operational reads: ONE cached read per collection ──
  const [kpiReport, observations, deductions, complaints, capaSplit, followUps, deals, attendanceResult] =
    await Promise.all([
      buildEmployeeKpiReport({
        employeeId: input.employeeId,
        monthKey: input.monthKey,
        trendMonths: windowLength,
        now,
        loaders,
      }),
      loaders.loadObservationsForWindow(input.employeeId, window),
      loaders.loadQualityDeductions(input.employeeId),
      loaders.loadComplaints(input.employeeId),
      loaders.loadCapaCases(input.employeeId),
      loaders.loadFollowUps(input.employeeId),
      loaders.loadTravelDeals(input.employeeId),
      loaders.loadStoredAttendanceResult(input.employeeId, input.monthKey),
    ]);

  return assembleEmployeePerformanceDataset({
    employeeId: input.employeeId,
    monthKey: input.monthKey,
    now,
    windowMonths: window,
    minOccurrences: input.minOccurrences,
    identity,
    orgTeam: team,
    kpiReport,
    observations,
    deductions,
    complaints,
    capaSplit,
    followUps,
    deals,
    attendanceResult,
  });
}
