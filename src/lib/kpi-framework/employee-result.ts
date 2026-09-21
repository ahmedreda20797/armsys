// ══════════════════════════════════════════════════════════════
//  Configurable KPI Framework — Employee KPI Result Service (Phase 1)
//
//  Orchestrates the full Phase-1 pipeline for one employee/period
//  (or a whole month's snapshot payload):
//
//    employee → lifecycle eligibility (existing employment-period
//    helpers) → scheme resolution (override ▸ department ▸ default)
//    → Quality adapter (CONSUMES the existing Quality result —
//    never recalculates) → aggregator → EmployeeKpiResult
//
//  HARD RULES:
//    • Archived employees get NO KPI result for periods they were
//      not employed in — never an artificial zero. Historical
//      (employed) periods stay fully reportable from frozen
//      snapshots.
//    • Closed months return their FROZEN `kpiResults` entry verbatim
//      — later scheme changes can never alter a finalized result.
//      Legacy closed snapshots (no stored entry) get a read-only
//      DERIVED view built from the frozen quality score.
//    • No scheme resolved / ambiguous → explicit outcome, no
//      fabricated numbers.
//
//  Injectable loaders follow the project convention (no Firebase
//  mocking — in-memory loaders in tests, db-backed defaults).
// ══════════════════════════════════════════════════════════════

import { getAll, getById, TTL } from '@/lib/db';
import { getMonthSnapshot } from '@/lib/month-lock';
import { getKpiSettings } from '@/lib/kpi-settings';
import { computeEmployeeScore } from '@/lib/metrics/kpiMetrics';
import type { ObservationLike } from '@/lib/metrics/kpiMetrics';
import type { QualityObservation, EmployeeScoreEntry } from '@/types/quality-kpi';
import {
  foldEmploymentPeriods,
  employmentOverlapsRange,
  normalizeDayKey,
} from '@/lib/organization/employment-periods';
import { normalizeEmployeeStatus } from '@/lib/organization/employee-status';
import type {
  EmployeeKpiResult,
  KpiFrameworkEmployee,
  KpiScheme,
  KpiSchemeOverride,
  KpiSchemeResolution,
  QualityScoreLookup,
} from './types';
import { KPI_SCHEME_OVERRIDES_TABLE } from './types';
import { resolveSchemeForEmployee } from './resolution';
import { buildQualityComponentResult } from './quality-adapter';
import type { QualityScoreInput } from './quality-adapter';
import { aggregateEmployeeKpi } from './aggregator';
import { monthDayRange } from './validation';
import { listKpiSchemes } from './scheme-service';

/** Minimal employment-event shape consumed from the ledger. */
export type EmploymentEventLike = { kind: 'archived' | 'restored'; effectiveAt: string };

/** The frozen/live quality slice a snapshot lookup exposes. */
export interface SnapshotLookup {
  status: 'open' | 'closed';
  closedAt: string | null;
  employeeScores: Record<
    string,
    { score: number; deductionPoints: number; bonusPoints: number; observationCount: number }
  >;
  /** Stored framework results on a closed snapshot (post-Phase-1). */
  kpiResults: Record<string, EmployeeKpiResult> | null;
}

// ─────────────────────────────────────────────────────────────
//  Lifecycle eligibility (reuses existing employment-period helpers)
// ─────────────────────────────────────────────────────────────

/**
 * Was the employee employed at any point of `period`?
 *
 * Reuses `foldEmploymentPeriods` + `employmentOverlapsRange`
 * (M0.6-A addendum) — NO second lifecycle implementation. Belt and
 * braces: an employee whose record says archived with `archivedAt`
 * before the period, and with no later restore event, is also
 * ineligible (the ledger is the source of truth; the record guard
 * only covers a missing ledger entry).
 */
export function isEmployeeEligibleForPeriod(
  employee: KpiFrameworkEmployee,
  events: ReadonlyArray<EmploymentEventLike>,
  period: string,
): boolean {
  const { start, end } = monthDayRange(period);

  // Record-level guard (ledger absence safety net). The archivedAt
  // stamp is compared in CANONICAL YYYY-MM-DD space (normalizeDayKey)
  // — never as a raw string slice, which misjudged day-first values.
  // An unparseable stamp is UNKNOWN: the ledger below stays the
  // source of truth, so the guard simply declines to judge.
  const archivedDay =
    typeof employee.archivedAt === 'string' ? normalizeDayKey(employee.archivedAt) : null;
  if (
    normalizeEmployeeStatus(employee.status) === 'archived' &&
    archivedDay !== null &&
    archivedDay < start &&
    !events.some((e) => e.kind === 'restored' && e.effectiveAt.slice(0, 10) >= start)
  ) {
    return false;
  }

  const fallbackStart = employee.hireDate ?? employee.createdAt ?? null;
  const periods = foldEmploymentPeriods(
    events as unknown as Parameters<typeof foldEmploymentPeriods>[0],
    fallbackStart,
  );
  return employmentOverlapsRange(periods, start, end);
}

// ─────────────────────────────────────────────────────────────
//  The core pure pipeline piece (adapter + aggregator wiring)
// ─────────────────────────────────────────────────────────────

export interface BuildEmployeeKpiResultInput {
  employee: { id: string };
  scheme: KpiScheme;
  period: string;
  /** The EXISTING quality result (null = no quality data → PENDING). */
  qualityScore: QualityScoreInput | null;
  /** Where the quality result was consumed from. */
  origin: 'month_snapshot' | 'live_engine';
  /** Freeze timestamp when the result is being finalized. */
  finalizedAt?: string | null;
}

/** Resolve + adapt + aggregate for one employee. Pure. */
export function buildEmployeeKpiResult(input: BuildEmployeeKpiResultInput): EmployeeKpiResult {
  const { employee, scheme, period, qualityScore, origin, finalizedAt } = input;

  const qualityComponent =
    scheme.components.find((c) => c.calculationType === 'quality_engine' && c.status === 'ACTIVE') ??
    null;

  const componentResults = qualityComponent
    ? [
        buildQualityComponentResult({
          component: {
            componentId: qualityComponent.componentId,
            name: qualityComponent.name,
            weight: qualityComponent.weight,
            owner: qualityComponent.owner,
          },
          qualityScore,
          origin,
        }),
      ]
    : [];

  return aggregateEmployeeKpi({
    scheme,
    employeeId: employee.id,
    period,
    componentResults,
    finalizedAt,
  });
}

/** Stamp a finalize timestamp onto a month of live results (pure). */
export function withFinalizedAt(
  kpiResults: Record<string, EmployeeKpiResult>,
  closedAt: string | null,
): Record<string, EmployeeKpiResult> {
  const out: Record<string, EmployeeKpiResult> = {};
  for (const [employeeId, result] of Object.entries(kpiResults)) {
    out[employeeId] = { ...result, finalizedAt: closedAt };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
//  Default loaders (db-backed)
// ─────────────────────────────────────────────────────────────

function toFrameworkEmployee(raw: Record<string, unknown>, id: string): KpiFrameworkEmployee {
  return {
    id,
    name: String(raw.name ?? ''),
    department: typeof raw.department === 'string' ? raw.department : null,
    status: raw.status,
    hireDate: typeof raw.hireDate === 'string' ? raw.hireDate : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    archivedAt: typeof raw.archivedAt === 'string' ? raw.archivedAt : null,
  };
}

async function loadAllOverrides(): Promise<KpiSchemeOverride[]> {
  const raw = await getAll<Record<string, unknown>>(KPI_SCHEME_OVERRIDES_TABLE, TTL.MEDIUM);
  return raw
    .filter((r) => r && typeof r.employeeId === 'string' && typeof r.schemeId === 'string')
    .map((r) => ({
      id: String(r.id ?? r.employeeId),
      employeeId: String(r.employeeId),
      schemeId: String(r.schemeId),
      updatedBy: typeof r.updatedBy === 'string' ? r.updatedBy : null,
      updatedAt: String(r.updatedAt ?? ''),
    }));
}

/** Closed → frozen quality entry; open → live engine compute. */
async function lookupQualityScore(
  employeeId: string,
  period: string,
): Promise<QualityScoreLookup> {
  const snapshot = await getMonthSnapshot(period);
  if (snapshot && snapshot.status === 'closed') {
    const entry = snapshot.employeeScores[employeeId] ?? null;
    return {
      entry: entry
        ? {
            score: entry.score,
            deductionPoints: entry.deductionPoints,
            bonusPoints: entry.bonusPoints,
            observationCount: entry.observationCount,
          }
        : null,
      finalized: true,
      closedAt: snapshot.closedAt,
    };
  }

  // Open month → consume the canonical engine directly (the same
  // scoring entry point the month snapshot pipeline uses).
  const settings = await getKpiSettings();
  const allObs = await getAll<QualityObservation>('qualityObservations', TTL.MEDIUM);
  const empObs = allObs.filter((o) => o.month === period && o.employeeId === employeeId);
  if (empObs.length === 0) {
    return { entry: null, finalized: false, closedAt: null };
  }
  const score = computeEmployeeScore(empObs as unknown as ObservationLike[], settings, employeeId);
  return {
    entry: {
      score: score.score,
      deductionPoints: score.deductionPoints,
      bonusPoints: score.bonusPoints,
      observationCount: score.observationCount,
    },
    finalized: false,
    closedAt: null,
  };
}

/** The injectable loader set for the single-employee pipeline. */
export const defaultKpiFrameworkLoaders: EmployeeResultLoaders = {
  loadEmployee: async (employeeId) => {
    const raw = await getById<Record<string, unknown>>('employees', employeeId);
    return raw ? toFrameworkEmployee(raw, employeeId) : null;
  },
  loadEmploymentEvents: async (employeeId) => {
    const all = await getAll<{ employeeId?: string; kind?: string; effectiveAt?: string }>(
      'employmentEvents',
      TTL.MEDIUM,
    );
    return all
      .filter(
        (e): e is { employeeId: string; kind: 'archived' | 'restored'; effectiveAt: string } =>
          e.employeeId === employeeId &&
          (e.kind === 'archived' || e.kind === 'restored') &&
          typeof e.effectiveAt === 'string',
      )
      .map((e) => ({ kind: e.kind, effectiveAt: e.effectiveAt }));
  },
  loadSchemes: () => listKpiSchemes(),
  loadOverrides: loadAllOverrides,
  loadSnapshot: async (period) => {
    const snapshot = await getMonthSnapshot(period);
    if (!snapshot) return null;
    return {
      status: snapshot.status,
      closedAt: snapshot.closedAt,
      employeeScores: Object.fromEntries(
        Object.entries(snapshot.employeeScores ?? {}).map(([id, entry]) => [
          id,
          {
            score: entry.score,
            deductionPoints: entry.deductionPoints,
            bonusPoints: entry.bonusPoints,
            observationCount: entry.observationCount,
          },
        ]),
      ),
      kpiResults: snapshot.kpiResults ?? null,
    };
  },
  loadLiveQualityScore: async (employeeId, period) => {
    const lookup = await lookupQualityScore(employeeId, period);
    return lookup.finalized ? null : lookup.entry;
  },
};

// ─────────────────────────────────────────────────────────────
//  Single-employee outcome
// ─────────────────────────────────────────────────────────────

export type EmployeeKpiOutcomeStatus =
  | 'FROZEN_RESULT'
  | 'RESOLVED'
  | 'EMPLOYEE_NOT_FOUND'
  | 'NOT_ELIGIBLE_PERIOD'
  | 'NO_SCHEME'
  | 'AMBIGUOUS'
  | 'OVERRIDE_NOT_RESOLVABLE';

export interface ComputeEmployeeKpiOutcome {
  employeeId: string;
  period: string;
  status: EmployeeKpiOutcomeStatus;
  resolution: KpiSchemeResolution | null;
  result: EmployeeKpiResult | null;
}

/** Injectable loaders for {@link computeEmployeeKpiResultWithLoaders}. */
export type EmployeeResultLoaders = {
  loadEmployee(employeeId: string): Promise<KpiFrameworkEmployee | null>;
  loadEmploymentEvents(employeeId: string): Promise<ReadonlyArray<EmploymentEventLike>>;
  loadSchemes(): Promise<KpiScheme[]>;
  loadOverrides(): Promise<KpiSchemeOverride[]>;
  loadSnapshot(period: string): Promise<SnapshotLookup | null>;
  loadLiveQualityScore(employeeId: string, period: string): Promise<QualityScoreLookup['entry']>;
};

function failure(
  employeeId: string,
  period: string,
  status: EmployeeKpiOutcomeStatus,
  resolution: KpiSchemeResolution | null,
): ComputeEmployeeKpiOutcome {
  return { employeeId, period, status, resolution, result: null };
}

/**
 * Compute (or read the frozen) company-KPI result for one employee
 * over one period. Never throws for business outcomes — every
 * outcome is an explicit status. DB failures still throw.
 */
export async function computeEmployeeKpiResultWithLoaders(
  args: { employeeId: string; period: string },
  loaders: EmployeeResultLoaders = defaultKpiFrameworkLoaders,
): Promise<ComputeEmployeeKpiOutcome> {
  const { employeeId, period } = args;

  const employee = await loaders.loadEmployee(employeeId);
  if (!employee) return failure(employeeId, period, 'EMPLOYEE_NOT_FOUND', null);

  // ── Closed month → frozen result is authoritative ──
  const snapshot = await loaders.loadSnapshot(period);
  if (snapshot && snapshot.status === 'closed') {
    const frozen = snapshot.kpiResults?.[employeeId];
    if (frozen) {
      // Immutable historical result — scheme changes can never touch it.
      return { employeeId, period, status: 'FROZEN_RESULT', resolution: null, result: frozen };
    }

    // Legacy closed snapshot (pre-framework): DERIVED read-only view
    // from the frozen quality score. Never persisted.
    if (!isEmployeeEligibleForPeriod(employee, await loaders.loadEmploymentEvents(employeeId), period)) {
      return failure(employeeId, period, 'NOT_ELIGIBLE_PERIOD', null);
    }
    const resolution = resolveSchemeForEmployee({
      employee,
      overrides: await loaders.loadOverrides(),
      schemes: await loaders.loadSchemes(),
      period,
    });
    if (resolution.status !== 'RESOLVED' || !resolution.scheme) {
      return failure(
        employeeId,
        period,
        resolution.status === 'AMBIGUOUS' ? 'AMBIGUOUS'
          : resolution.status === 'OVERRIDE_NOT_RESOLVABLE' ? 'OVERRIDE_NOT_RESOLVABLE'
          : 'NO_SCHEME',
        resolution,
      );
    }
    const entry = snapshot.employeeScores[employeeId] ?? null;
    const result = buildEmployeeKpiResult({
      employee,
      scheme: resolution.scheme,
      period,
      qualityScore: entry,
      origin: 'month_snapshot',
      finalizedAt: snapshot.closedAt,
    });
    return { employeeId, period, status: 'RESOLVED', resolution, result };
  }

  // ── Open month (or no snapshot yet) → live computation ──
  if (!isEmployeeEligibleForPeriod(employee, await loaders.loadEmploymentEvents(employeeId), period)) {
    return failure(employeeId, period, 'NOT_ELIGIBLE_PERIOD', null);
  }

  const resolution = resolveSchemeForEmployee({
    employee,
    overrides: await loaders.loadOverrides(),
    schemes: await loaders.loadSchemes(),
    period,
  });
  if (resolution.status !== 'RESOLVED' || !resolution.scheme) {
    return failure(
      employeeId,
      period,
      resolution.status === 'AMBIGUOUS' ? 'AMBIGUOUS'
        : resolution.status === 'OVERRIDE_NOT_RESOLVABLE' ? 'OVERRIDE_NOT_RESOLVABLE'
        : 'NO_SCHEME',
      resolution,
    );
  }

  const qualityScore = await loaders.loadLiveQualityScore(employeeId, period);
  const result = buildEmployeeKpiResult({
    employee,
    scheme: resolution.scheme,
    period,
    qualityScore,
    origin: 'live_engine',
    finalizedAt: null,
  });
  return { employeeId, period, status: 'RESOLVED', resolution, result };
}

/** DB-backed single-employee pipeline. */
export function computeEmployeeKpiResult(
  employeeId: string,
  period: string,
): Promise<ComputeEmployeeKpiOutcome> {
  return computeEmployeeKpiResultWithLoaders({ employeeId, period });
}

// ─────────────────────────────────────────────────────────────
//  Whole-month builder (consumed by the snapshot pipeline)
// ─────────────────────────────────────────────────────────────

/** Injectable loaders for {@link buildMonthKpiResultsWithLoaders}. */
export interface KpiMonthResultsLoaders {
  loadEmployees(): Promise<KpiFrameworkEmployee[]>;
  loadEmploymentEventsByEmployee(): Promise<Map<string, EmploymentEventLike[]>>;
  loadSchemes(): Promise<KpiScheme[]>;
  loadOverrides(): Promise<KpiSchemeOverride[]>;
}

/**
 * Batched default loaders — ONE cached read per table, no N+1.
 */
export const defaultKpiMonthResultsLoaders: KpiMonthResultsLoaders = {
  loadEmployees: async () => {
    const all = await getAll<Record<string, unknown>>('employees', TTL.MEDIUM);
    return all
      .filter((e) => e && typeof e.id === 'string')
      .map((e) => toFrameworkEmployee(e, String(e.id)));
  },
  loadEmploymentEventsByEmployee: async () => {
    const all = await getAll<{ employeeId?: string; kind?: string; effectiveAt?: string }>(
      'employmentEvents',
      TTL.MEDIUM,
    );
    const byEmployee = new Map<string, EmploymentEventLike[]>();
    for (const e of all) {
      if (
        typeof e.employeeId === 'string' &&
        (e.kind === 'archived' || e.kind === 'restored') &&
        typeof e.effectiveAt === 'string'
      ) {
        const list = byEmployee.get(e.employeeId) ?? [];
        list.push({ kind: e.kind, effectiveAt: e.effectiveAt });
        byEmployee.set(e.employeeId, list);
      }
    }
    return byEmployee;
  },
  loadSchemes: () => listKpiSchemes(),
  loadOverrides: loadAllOverrides,
};

/**
 * Build the framework results for a month's snapshot payload.
 *
 * Consumes the ALREADY-COMPUTED quality scores (the canonical
 * engine's output — zero recalculation, zero extra observation
 * reads). Employees are included only when: employed in the period
 * (lifecycle) AND a scheme resolves. Everyone else is OMITTED —
 * no fabricated entries, no zero-fill. The frozen quality entries
 * in `employeeScores` remain untouched for historical reporting.
 */
export async function buildMonthKpiResultsWithLoaders(
  monthKey: string,
  employeeScores: Record<string, EmployeeScoreEntry>,
  loaders: KpiMonthResultsLoaders = defaultKpiMonthResultsLoaders,
): Promise<Record<string, EmployeeKpiResult>> {
  const employeeIds = Object.keys(employeeScores ?? {});
  if (employeeIds.length === 0) return {};

  const [schemes, overrides, employees, eventsByEmployee] = await Promise.all([
    loaders.loadSchemes(),
    loaders.loadOverrides(),
    loaders.loadEmployees(),
    loaders.loadEmploymentEventsByEmployee(),
  ]);

  // Fast path: no ACTIVE scheme at all → nothing to attach.
  if (!schemes.some((s) => s.status === 'ACTIVE')) return {};

  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const overrideList = overrides;

  const results: Record<string, EmployeeKpiResult> = {};
  for (const employeeId of employeeIds) {
    const employee = employeeById.get(employeeId) ?? {
      // Engine-scored but missing record (deleted employee): resolve
      // via departmentless default rather than dropping data silently.
      id: employeeId,
      name: String(employeeScores[employeeId]?.employeeSnapshot?.employeeName ?? ''),
      department: null,
    };

    if (!isEmployeeEligibleForPeriod(employee, eventsByEmployee.get(employeeId) ?? [], monthKey)) {
      continue;
    }

    const resolution = resolveSchemeForEmployee({
      employee,
      overrides: overrideList,
      schemes,
      period: monthKey,
    });
    if (resolution.status !== 'RESOLVED' || !resolution.scheme) continue;

    const entry = employeeScores[employeeId];
    results[employeeId] = buildEmployeeKpiResult({
      employee,
      scheme: resolution.scheme,
      period: monthKey,
      qualityScore: entry
        ? {
            score: entry.score,
            deductionPoints: entry.deductionPoints,
            bonusPoints: entry.bonusPoints,
            observationCount: entry.observationCount,
          }
        : null,
      origin: 'month_snapshot',
      finalizedAt: null, // stamped by the close flow via withFinalizedAt
    });
  }

  return results;
}

/** DB-backed month builder used by the snapshot pipeline. */
export function buildMonthKpiResults(
  monthKey: string,
  employeeScores: Record<string, EmployeeScoreEntry>,
): Promise<Record<string, EmployeeKpiResult>> {
  return buildMonthKpiResultsWithLoaders(monthKey, employeeScores);
}
