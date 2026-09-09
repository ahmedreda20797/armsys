// ══════════════════════════════════════════════════════════════
//  KPI Reporting Layer — Monthly / MTD / Historical reports (Phase 2)
//
//  Three logically separated reports over ONE shared, engine-only
//  assembly path (spec §3):
//
//    MONTHLY     — all eligible employees for a selected month
//    MTD         — the same assembly for the CURRENT month, clearly
//                  labeled MTD (never FINAL unless the existing
//                  Month Close process finalized it — spec §7/§8)
//    HISTORICAL  — closed months reported from the FROZEN snapshot
//                  verbatim (never recalculated — spec §9/§26)
//
//  Data-source rule (identical to the KPI dashboard's, spec §33):
//    KPI Engine = source of truth → this service only orchestrates
//    reads and projects engine output into report rows.
//
//  Row assembly (batched — spec §21):
//    eligible employees (lifecycle helpers) ∩ authorized scope
//      → frozen kpiResults entry (closed months)  — verbatim
//      → engine DERIVED view (legacy closed snapshots)
//      → live engine result (open months)
//      → explicit PENDING / NO_SCHEME rows for everyone else —
//        missing data is NEVER a zero (spec §11/§12).
// ══════════════════════════════════════════════════════════════

import type { MonthSnapshot } from '@/types/quality-kpi';
import type { EmployeeKpiResult, KpiScheme, KpiSchemeOverride } from '@/lib/kpi-framework/types';
import {
  buildEmployeeKpiResult,
  isEmployeeEligibleForPeriod,
} from '@/lib/kpi-framework';
import type { QualityScoreInput } from '@/lib/kpi-framework';
import { isValidMonthKey } from '@/lib/month-utils';
import type {
  KpiMonthlyFilters,
  KpiMonthlyReport,
  KpiMonthlySort,
  KpiReportRow,
  KpiReportSchemeDisplay,
  KpiRowResultSource,
  KpiValueBasis,
} from './types';
import type { KpiReportingLoaders, ReportEmployee } from './loaders';
import { defaultKpiReportingLoaders, resolveSchemeFromLoaded, toFrameworkEmployee, employmentStatusOf } from './loaders';
import {
  applyMonthlyFilters,
  buildRowFromResult,
  buildRowWithoutResult,
  computeMonthlyTotals,
  sortMonthlyRows,
  type RowIdentity,
} from './rows';
import { dayKeyOf, resolveValueBasis } from './period-basis';

// ─────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────

export type MonthlyReportKind = 'MONTHLY' | 'MTD' | 'HISTORICAL';

export interface BuildMonthlyKpiReportInput {
  monthKey: string;
  reportKind: MonthlyReportKind;
  filters?: KpiMonthlyFilters;
  sort?: KpiMonthlySort;
  /** Injectable "now" (deterministic tests); defaults to the clock. */
  now?: Date;
  loaders?: KpiReportingLoaders;
}

/**
 * Build the Monthly / MTD / Historical report for one month.
 * Throws ONLY for caller bugs (invalid month key); every business
 * outcome is an explicit row status.
 */
export async function buildMonthlyKpiReport(
  input: BuildMonthlyKpiReportInput,
): Promise<KpiMonthlyReport> {
  if (!isValidMonthKey(input.monthKey)) {
    throw new Error(`invalid month key: ${String(input.monthKey)}`);
  }

  const loaders = input.loaders ?? defaultKpiReportingLoaders;
  const now = input.now ?? new Date();
  const monthKey = input.monthKey;

  // ── Batched reads (ONE cached read per table — spec §21) ──
  // The month detail comes through the EXISTING snapshot service
  // lifecycle: closed → frozen verbatim; open → engine live preview.
  const [snapshot, employees, eventsByEmployee, schemes, overrides, teamNames] =
    await Promise.all([
      loaders.loadMonthDetail(monthKey),
      loaders.loadEmployees(),
      loaders.loadEmploymentEventsByEmployee(),
      loaders.loadSchemes(),
      loaders.loadOverrides(),
      loaders.loadTeamNames(),
    ]);

  const valueBasis: KpiValueBasis = resolveValueBasis(monthKey, snapshot?.status ?? null, now);
  const finalized = snapshot?.status === 'closed';
  const derivedLegacy = finalized && !snapshot.kpiResults;

  // ── Row assembly ──
  const identityCache = new Map<string, RowIdentity>();
  const identityOf = (employee: ReportEmployee): RowIdentity => {
    const cached = identityCache.get(employee.id);
    if (cached) return cached;
    const status = employmentStatusOf(employee);
    const identity: RowIdentity = {
      employeeId: employee.id,
      employeeName: employee.name,
      employeeCode: employee.code,
      department: employee.department,
      team: teamNames.get(employee.id) ?? null,
      position: employee.position,
      employmentStatus: status,
      // Currently archived yet employed during the period (§11):
      archivedButEligible: status === 'archived',
    };
    identityCache.set(employee.id, identity);
    return identity;
  };

  const rows: KpiReportRow[] = [];
  let notEligibleCount = 0;

  for (const employee of employees) {
    // Authorized scope FIRST (M0.5): out-of-scope employees are not
    // evaluated, counted, or otherwise leaked into report metadata.
    if (input.filters?.scopeLimit && !input.filters.scopeLimit.includes(employee.id)) {
      continue;
    }

    const frameworkEmployee = toFrameworkEmployee(employee);
    const eligible = isEmployeeEligibleForPeriod(
      frameworkEmployee,
      eventsByEmployee.get(employee.id) ?? [],
      monthKey,
    );

    if (!eligible) {
      // §11: post-archive exclusion — NO row, NO manufactured zeros.
      notEligibleCount += 1;
      continue;
    }

    // §10: archived employees are excluded from DEFAULT reports. They
    // reappear only when the caller explicitly opts in
    // (filters.includeArchived) — rows and totals stay consistent
    // because this happens at assembly, before totals are computed.
    if (input.filters?.includeArchived !== true && employmentStatusOf(employee) === 'archived') {
      continue;
    }

    const identity = identityOf(employee);
    rows.push(
      assembleRow({
        employee,
        frameworkEmployee,
        identity,
        monthKey,
        snapshot,
        schemes,
        overrides,
        finalized,
        valueBasis,
      }),
    );
  }

  // Totals describe the (scoped) report BEFORE presentation filters.
  const totals = computeMonthlyTotals({ rows, notEligibleCount });

  // Presentation filters + sort run AFTER scope narrowing (M0.5).
  const presentationFilters: KpiMonthlyFilters = { ...input.filters, scopeLimit: null };
  const filtered = applyMonthlyFilters(rows, presentationFilters);
  const sorted = sortMonthlyRows(filtered, input.sort);

  return {
    reportKind: input.reportKind,
    monthKey,
    valueBasis,
    finalized,
    closedAt: finalized ? snapshot.closedAt : null,
    closedByName: finalized ? snapshot.closedByName : null,
    derivedLegacy,
    scheme: dominantSchemeDisplay(sorted, schemes),
    asOfDate: valueBasis === 'MTD' ? dayKeyOf(now) : null,
    rows: sorted,
    totals,
    generatedAt: now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────
//  Per-employee row assembly (engine-only paths)
// ─────────────────────────────────────────────────────────────

function assembleRow(args: {
  employee: ReportEmployee;
  frameworkEmployee: ReturnType<typeof toFrameworkEmployee>;
  identity: RowIdentity;
  monthKey: string;
  snapshot: MonthSnapshot | null;
  schemes: KpiScheme[];
  overrides: KpiSchemeOverride[];
  finalized: boolean;
  valueBasis: KpiValueBasis;
}): KpiReportRow {
  const { employee, frameworkEmployee, identity, monthKey, snapshot, schemes, overrides } = args;

  // ── 1. CLOSED month with frozen framework results → verbatim ──
  const frozen = snapshot?.status === 'closed' ? snapshot.kpiResults?.[employee.id] : undefined;
  if (frozen) {
    // Immutable historical result — later scheme changes can never
    // touch it (spec §26). Verbatim projection, zero recalculation.
    return buildRowFromResult({
      identity,
      result: frozen as EmployeeKpiResult,
      finalized: true,
      valueBasis: 'FINALIZED',
      resultSource: 'FROZEN_RESULT',
    });
  }

  // ── 2. Scheme resolution (pure, over batch-loaded inputs) ──
  const resolution = resolveSchemeFromLoaded(frameworkEmployee, overrides, schemes, monthKey);
  const scheme = resolution.status === 'RESOLVED' ? resolution.scheme : null;

  if (!scheme) {
    // Explicit failure — never a fabricated value (spec §12).
    const source: KpiRowResultSource =
      resolution.status === 'AMBIGUOUS'
        ? 'AMBIGUOUS'
        : resolution.status === 'OVERRIDE_NOT_RESOLVABLE'
          ? 'OVERRIDE_NOT_RESOLVABLE'
          : 'NO_SCHEME';
    return buildRowWithoutResult({
      identity,
      valueBasis: args.valueBasis,
      resultSource: source,
    });
  }

  const schemeRef = { id: scheme.id, name: scheme.name, version: scheme.version };

  // Quality entry for this employee from the snapshot (frozen scores
  // on a closed snapshot, live preview scores on an open one).
  const entry = snapshot?.employeeScores?.[employee.id] ?? null;
  const qualityScore: QualityScoreInput | null = entry
    ? {
        score: entry.score,
        deductionPoints: entry.deductionPoints,
        bonusPoints: entry.bonusPoints,
        observationCount: entry.observationCount,
      }
    : null;

  if (args.finalized && snapshot) {
    // ── 3a. CLOSED legacy snapshot (pre-framework) → the engine's
    //        documented DERIVED view from the frozen quality score.
    //        Never persisted; frozen scores stay untouched.
    if (!qualityScore) {
      return buildRowWithoutResult({
        identity,
        valueBasis: args.valueBasis,
        resultSource: 'PENDING',
        scheme: schemeRef,
      });
    }
    const derived = buildEmployeeKpiResult({
      employee: frameworkEmployee,
      scheme,
      period: monthKey,
      qualityScore,
      origin: 'month_snapshot',
      finalizedAt: snapshot.closedAt,
    });
    return buildRowFromResult({
      identity,
      result: derived,
      finalized: true,
      valueBasis: 'FINALIZED',
      resultSource: 'DERIVED',
    });
  }

  // ── 3b. OPEN month → live engine result (MTD/LIVE) ──
  if (!qualityScore) {
    // Eligible but the engine has no quality data for this employee
    // yet → explicit PENDING row, never a zero (spec §12).
    return buildRowWithoutResult({
      identity,
      valueBasis: args.valueBasis,
      resultSource: 'PENDING',
      scheme: schemeRef,
    });
  }
  const live = buildEmployeeKpiResult({
    employee: frameworkEmployee,
    scheme,
    period: monthKey,
    qualityScore,
    origin: 'live_engine',
    finalizedAt: null,
  });
  return buildRowFromResult({
    identity,
    result: live,
    finalized: false,
    valueBasis: args.valueBasis,
    resultSource: 'LIVE',
  });
}

// ─────────────────────────────────────────────────────────────
//  §10  Dominant scheme display (auditability)
// ─────────────────────────────────────────────────────────────

/**
 * The scheme/version behind most rows of the report. Scheme documents
 * are immutable once written, so resolving the display name from the
 * CURRENT scheme list is safe even for frozen results.
 */
function dominantSchemeDisplay(
  rows: ReadonlyArray<KpiReportRow>,
  schemes: ReadonlyArray<KpiScheme>,
): KpiReportSchemeDisplay | null {
  const counts = new Map<string, { version: number; name: string | null; count: number }>();
  for (const row of rows) {
    if (!row.schemeId) continue;
    const key = `${row.schemeId}#${row.schemeVersion ?? ''}`;
    const current = counts.get(key) ?? { version: row.schemeVersion ?? 0, name: row.schemeName, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }

  let best: { id: string; version: number; name: string | null; count: number } | null = null;
  for (const [key, value] of counts) {
    const id = key.slice(0, key.lastIndexOf('#'));
    if (!best || value.count > best.count) {
      best = { id, version: value.version, name: value.name, count: value.count };
    }
  }
  if (!best) return null;

  const schemeDoc = schemes.find((s) => s.id === best.id);
  const qualityComponent = schemeDoc?.components.find((c) => c.owner === 'quality') ?? null;
  // Frozen/current scheme doc missing (archived lineage)? Fall back to
  // the weight the reported rows themselves carry.
  const rowWeight = rows.find((r) => r.schemeId === best.id && r.quality)?.quality?.weight ?? null;
  return {
    schemeId: best.id,
    schemeName: schemeDoc?.name ?? best.name ?? best.id,
    schemeVersion: best.version || schemeDoc?.version || 1,
    qualityWeight: qualityComponent?.weight ?? rowWeight,
    // Frozen only when the reported rows themselves are frozen.
    frozen: rows.some((r) => r.schemeId === best.id && r.finalized),
  };
}
