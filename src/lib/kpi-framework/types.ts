// ══════════════════════════════════════════════════════════════
//  Configurable KPI Framework — Type Layer (Phase 1)
//
//  Wraps the existing Quality KPI engine in a configurable scheme →
//  components → weights → aggregation pipeline:
//
//    KPI Scheme ──► KPI Components ──► Component Owner
//        ──► Raw Score ──► Component Weight
//        ──► Weighted Contribution ──► KPI Aggregator
//        ──► Monthly Snapshot
//
//  The existing Quality KPI (src/lib/metrics/kpiMetrics.ts) remains
//  the SINGLE source of truth for its own score. The framework never
//  recomputes Quality — it consumes the existing result through the
//  quality adapter and adds rawScore / weight / weightedContribution
//  semantics around it.
//
//  Phase-1 scope: ONLY the Quality component is operationally
//  calculated. Direct Manager / HR / Target exist as configurable
//  scheme components (weight + owner) with `calculationType: 'none'`
//  — their results are PENDING, never zero-filled and never
//  redistributed (data-integrity rule).
//
//  Every persisted document carries `schemaVersion` (additive-only
//  evolution, same contract as KpiSettings / MonthSnapshot).
// ══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
//  Storage constants
// ─────────────────────────────────────────────────────────────

/** RTDB collection for KPI scheme documents (`arm_erp/kpiSchemes/{id}`). */
export const KPI_SCHEMES_TABLE = 'kpiSchemes';

/** RTDB collection for per-employee scheme overrides (`arm_erp/kpiSchemeOverrides/{employeeId}`). */
export const KPI_SCHEME_OVERRIDES_TABLE = 'kpiSchemeOverrides';

/**
 * Version of the framework's own calculation semantics (aggregation,
 * contribution rounding, status semantics). Bumped only when the
 * MEANING of stored results changes; every persisted result stamps
 * the version it was produced with.
 */
export const KPI_FRAMEWORK_CALCULATION_VERSION = '1';

/**
 * Deterministic document id for the idempotently-seeded default ARM
 * scheme (Quality 15 / Direct Manager 15 / HR 10 / Target 60). A fixed
 * id makes concurrent first-read seeds overwrite the SAME document
 * instead of minting two competing defaults.
 */
export const DEFAULT_KPI_SCHEME_ID = 'arm_default_scheme_v1';

// ─────────────────────────────────────────────────────────────
//  Scheme
// ─────────────────────────────────────────────────────────────

/** Lifecycle of a scheme document. Only ACTIVE schemes resolve. */
export type KpiSchemeStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

/**
 * Who owns/operates a component. Owners gate FUTURE write APIs for
 * their own component; this phase grants nothing new (the existing
 * permission model stays authoritative).
 */
export type KpiComponentOwner = 'quality' | 'management' | 'hr' | 'sales' | 'other';

/**
 * How a component's raw score is produced.
 *
 * - `quality_engine` — consumed from the existing canonical Quality
 *   engine via the quality adapter (the only implemented adapter).
 * - `none` — config-only placeholder for a future component; its
 *   results stay PENDING until an adapter is registered.
 * - `manual` — reserved: a future component owner submits values
 *   out-of-band. NOT implemented in this phase.
 */
export type KpiComponentCalculationType = 'quality_engine' | 'none' | 'manual';

/** Whether a component participates in aggregation. */
export type KpiComponentStatus = 'ACTIVE' | 'INACTIVE';

/**
 * One configurable component inside a scheme. Deliberately the
 * SMALLEST safe model — no expression language, no user-defined code.
 */
export interface KpiSchemeComponent {
  /** Stable machine key, e.g. 'quality' | 'direct_manager' | 'hr' | 'target'. */
  componentId: string;
  /** Arabic display name. */
  name: string;
  /** Contribution weight in percent (0–100). ACTIVE weights of a complete scheme must total exactly 100. */
  weight: number;
  owner: KpiComponentOwner;
  calculationType: KpiComponentCalculationType;
  status: KpiComponentStatus;
  /**
   * Small config bag for future adapters (numbers/strings/booleans
   * only). Normalized before persist — never contains undefined.
   */
  configuration: Record<string, number | string | boolean | null> | null;
}

/**
 * A configurable KPI scheme. Applicability uses ONLY stable employee
 * fields that exist today (`department`) — it must NOT depend on the
 * Organization Tree, which is slated for a separate redesign.
 */
export interface KpiScheme {
  id: string;
  schemaVersion: 1;
  name: string;
  description: string | null;
  status: KpiSchemeStatus;
  /** Monotonic per-name version (v1, v2, …). Immutable once written. */
  version: number;
  /** Inclusive applicability start, `YYYY-MM-DD`. */
  effectiveFrom: string;
  /** Inclusive applicability end, `YYYY-MM-DD` (null = open-ended). */
  effectiveTo: string | null;
  /** When true this scheme is the company-wide fallback in resolution. */
  isDefault: boolean;
  /**
   * Department names (Employee.department — a stable field) this
   * scheme applies to; null = not department-restricted.
   */
  applicableDepartments: string[] | null;
  components: KpiSchemeComponent[];
  /** Scheme this version was cloned from (version lineage). */
  previousSchemeId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  Employee → scheme override
// ─────────────────────────────────────────────────────────────

/**
 * Employee-specific scheme override. Stored per employee
 * (`kpiSchemeOverrides/{employeeId}`). The FIRST resolution
 * precedence — an employee with a resolvable override never falls
 * through to department/default schemes.
 */
export interface KpiSchemeOverride {
  id: string; // = employeeId
  employeeId: string;
  schemeId: string;
  updatedBy: string | null;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  Scheme resolution
// ─────────────────────────────────────────────────────────────

export type KpiSchemeResolutionSource = 'employee_override' | 'department' | 'default';

/**
 * Fail-safe resolution outcomes. Ambiguity (two active schemes match
 * the same precedence level for the same window) NEVER silently picks
 * one — it surfaces as AMBIGUOUS and produces no KPI result.
 */
export type KpiSchemeResolutionStatus =
  | 'RESOLVED'
  | 'NO_SCHEME'
  | 'AMBIGUOUS'
  | 'OVERRIDE_NOT_RESOLVABLE';

export interface KpiSchemeResolution {
  status: KpiSchemeResolutionStatus;
  source: KpiSchemeResolutionSource | null;
  scheme: KpiScheme | null;
  /** How many schemes matched at the deciding level (diagnostics). */
  candidates: number;
  /** Arabic, human-readable explanation (null when RESOLVED cleanly). */
  message: string | null;
}

// ─────────────────────────────────────────────────────────────
//  Component results & aggregation
// ─────────────────────────────────────────────────────────────

/**
 * Per-component result status. Deliberately explicit — "no data" is
 * PENDING, "computed as zero" is ZERO, "person not employed in the
 * period" is NOT_ELIGIBLE. Missing states are NEVER collapsed into 0.
 *
 * - AVAILABLE   — adapter produced a real raw score (0 < score).
 * - ZERO        — adapter produced a real raw score of exactly 0
 *                 (a computed value, NOT missing; counts as available).
 * - PENDING     — the component is active in the scheme but its
 *                 result has not been provided (future owner).
 * - INCOMPLETE  — reserved for adapters that return partial data;
 *                 never produced by the quality adapter.
 * - NOT_ELIGIBLE— the employee was not employed in the period.
 * - FINALIZED   — the result is frozen (component owners may use
 *                 this when they finalize out-of-band). In this
 *                 phase, frozen-ness is carried by the RESULT-level
 *                 `finalizedAt` timestamp on EmployeeKpiResult.
 */
export type KpiComponentResultStatus =
  | 'AVAILABLE'
  | 'PENDING'
  | 'INCOMPLETE'
  | 'NOT_ELIGIBLE'
  | 'ZERO'
  | 'FINALIZED';

/** Provenance/evidence references carried with a component result. */
export interface KpiComponentEvidence {
  /** The producing adapter, e.g. 'quality_engine'. */
  source: string;
  /** Where the consumed result came from (frozen snapshot vs live engine). */
  origin: 'month_snapshot' | 'live_engine';
  observationCount: number;
  deductionPoints: number;
  bonusPoints: number;
}

/**
 * The result of ONE component for ONE employee/period. Every result
 * preserves the CRITICAL triple: rawScore (0–100 quality-domain
 * score), weight (%), weightedContribution (rawScore × weight / 100).
 * The raw score is NEVER replaced by its contribution.
 */
export interface KpiComponentResult {
  componentId: string;
  name: string;
  owner: KpiComponentOwner;
  weight: number;
  status: KpiComponentResultStatus;
  /** 0–100 raw score; null when no value exists (PENDING/NOT_ELIGIBLE). */
  rawScore: number | null;
  /** rawScore × weight / 100; null when no value exists. */
  weightedContribution: number | null;
  /** The maximum possible contribution (= weight). Always present. */
  maxContribution: number;
  evidence: KpiComponentEvidence | null;
}

/** Overall result-level status. Partial data ⇒ INCOMPLETE, never a fake total. */
export type KpiOverallStatus = 'COMPLETE' | 'INCOMPLETE';

/**
 * The aggregated KPI result for one employee over one month under one
 * exact scheme version. This shape is the future Python/AI data
 * contract (deterministic, evidence-referenced) and is embedded in
 * monthly snapshots as `kpiResults`.
 */
export interface EmployeeKpiResult {
  employeeId: string;
  /** YYYY-MM period. */
  period: string;
  schemeId: string;
  schemeVersion: number;
  schemeName: string;
  components: KpiComponentResult[];
  /** Σ weights of components that carry a value (available set). */
  availableWeight: number;
  /** Σ weightedContribution of the available set — missing components contribute NOTHING (no redistribution, no zero-fill). */
  weightedTotal: number;
  overallStatus: KpiOverallStatus;
  /** KPI_FRAMEWORK_CALCULATION_VERSION stamped at computation time. */
  calculationVersion: string;
  /** When the month snapshot froze this result (null = live/unfinalized). */
  finalizedAt: string | null;
}

// ─────────────────────────────────────────────────────────────
//  Injectable data loaders (project convention: no Firebase mocking —
//  db-bound orchestration accepts in-memory loaders in tests)
// ─────────────────────────────────────────────────────────────

/** The stable employee fields the framework reads (never the org tree). */
export interface KpiFrameworkEmployee {
  id: string;
  name: string;
  department: string | null;
  status?: unknown;
  hireDate?: string | null;
  createdAt?: string;
  archivedAt?: string | null;
}

/** Result of looking up an employee's consumed Quality score for a period. */
export interface QualityScoreLookup {
  /** The existing EmployeeScoreEntry-ish payload (raw quality result). */
  entry: {
    score: number;
    deductionPoints: number;
    bonusPoints: number;
    observationCount: number;
  } | null;
  /** True when the source month snapshot is closed (frozen). */
  finalized: boolean;
  /** closedAt of the source snapshot when frozen. */
  closedAt: string | null;
}

export interface KpiFrameworkDataLoaders {
  loadEmployee(employeeId: string): Promise<KpiFrameworkEmployee | null>;
  loadEmploymentEvents(employeeId: string): Promise<
    ReadonlyArray<{ kind: 'archived' | 'restored'; effectiveAt: string }>
  >;
  loadSchemes(): Promise<KpiScheme[]>;
  loadOverrides(): Promise<KpiSchemeOverride[]>;
  loadQualityScore(employeeId: string, period: string): Promise<QualityScoreLookup>;
}
