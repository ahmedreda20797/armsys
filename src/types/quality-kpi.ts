// ══════════════════════════════════════════════════════════════
//  Enterprise Quality KPI & Monthly Performance Engine — Type Layer
//
//  Pure type declarations for the Quality Observation → KPI →
//  Monthly Snapshot pipeline. Quality is the first consumer of the
//  generic primitives (approvals, audit, kpi-scoring); these types
//  keep the Quality domain decoupled so a future unified Performance
//  Engine can reuse the generic interfaces.
//
//  Every persisted document carries `schemaVersion` to support
//  forward-compatible, additive-only schema evolution.
// ══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
//  Generic primitives (reusable by future modules)
// ─────────────────────────────────────────────────────────────

/** Actions recorded in an append-only approval history. */
export type ApprovalAction = 'submit' | 'approve' | 'reject' | 'override' | 'reopen';

/** A single immutable entry in an approval history. Nothing overwrites these. */
export interface ApprovalEvent {
  action: ApprovalAction;
  actorId: string;
  actorName: string;
  timestamp: string; // ISO 8601
  notes: string;
  /** Present only on override events — captures the point change. */
  pointsBefore?: number;
  /** Present only on override events — captures the point change. */
  pointsAfter?: number;
}

/** The projected latest approval state, derived from the history for fast queries. */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** A generic chronological event used to build timelines (Improvement #7). */
export interface AuditEvent {
  action: string;
  actorId: string;
  actorName: string;
  timestamp: string; // ISO 8601
  details: string;
}

/** A timeline point derived from audit/approval history — never a stored field. */
export interface TimelinePoint {
  key: string;
  label: string;
  timestamp: string;
  actorName: string;
  details: string;
  /** Semantic tone for presentation (drives icon/color, not logic). */
  tone: 'neutral' | 'positive' | 'negative' | 'pending';
}

/**
 * Performance Engine adapter interface.
 *
 * Every scoring component (Quality today; Attendance, Productivity,
 * Customer Satisfaction, etc. tomorrow) exposes this same shape so a
 * unified Performance Engine can combine them without coupling to any
 * one factor's internals.
 */
export interface PerformanceFactor {
  /** Stable factor identifier, e.g. 'quality'. */
  factorId: string;
  /** Human-readable factor name. */
  factorName: string;
  /** Computed score for this factor (already clamped to [0, maxScore]). */
  score: number;
  /** Maximum possible score for this factor (e.g. 100). */
  maxScore: number;
  /** Relative weight inside the unified engine (default 1). */
  weight: number;
  /** Normalized 0–1 contribution = score / maxScore. */
  normalized: number;
  /** Optional structured breakdown for display. */
  breakdown?: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────
//  Severity & priority (shared enums as string-literal unions)
// ─────────────────────────────────────────────────────────────

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type Priority = 'low' | 'medium' | 'high' | 'critical';

// ─────────────────────────────────────────────────────────────
//  Observation Categories (points AND weight — Improvement #3)
// ─────────────────────────────────────────────────────────────

/**
 * A reusable observation category.
 *
 * `defaultPointValue` drives the current score formula.
 * `weight` is stored now for future analytics — it lets the system
 * distinguish observations with equal points but different business
 * impact. The score formula uses points only (per spec).
 */
export interface ObservationCategory {
  id: string;
  schemaVersion: 1;
  /** Stable machine key, e.g. 'late_followup'. */
  key: string;
  /** Arabic display name. */
  name: string;
  /** Default magnitude applied when an observation uses this category. */
  defaultPointValue: number;
  /** Business-impact weight for future analytics (defaults to 1). */
  weight: number;
  /** Tailwind-style color token for badges, e.g. 'amber'. */
  color: string;
  /** Default severity/priority hint. */
  priority: Priority;
  /** When true, applying this category defaults to a bonus (award) observation. */
  isBonusDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  Observation Templates (Improvement #5)
// ─────────────────────────────────────────────────────────────

/**
 * A reusable template that pre-fills an observation form. Templates
 * only seed the form; the created observation stores its own values.
 */
export interface ObservationTemplate {
  id: string;
  schemaVersion: 1;
  title: string;
  categoryId: string;
  categoryName: string;
  defaultPoints: number;
  isBonus: boolean;
  defaultNotes: string;
  correctiveAction: string;
  severity: Severity;
  /** User IDs that marked this template as a favorite. */
  favoriteUserIds: string[];
  /** Incremented each time the template is applied. */
  usageCount: number;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  Quality Observations
// ─────────────────────────────────────────────────────────────

/** Resolution lifecycle of the observation itself (independent of approval). */
export type ObservationStatus = 'open' | 'in_review' | 'resolved' | 'closed';

/**
 * A quality observation — the canonical source of every KPI, monthly
 * score, trend, and ranking. Quality is the *only* module that writes
 * these; every consumer reads them.
 *
 * Approval state is an append-only history (Improvement #4): approve,
 * reject, override, and reopen each append an `ApprovalEvent` and the
 * latest one is projected to `approvalStatus` for fast queries.
 * `employeeName`/`department` are server-resolved snapshots — the
 * client can never submit them as trusted values.
 */
export interface QualityObservation {
  id: string;
  schemaVersion: 1;
  // ── Subject (server-resolved + snapshotted at creation) ──
  employeeId: string;
  employeeName: string;
  department: string;
  /** Position captured at creation time for historical context. */
  positionSnapshot: string;
  // ── Observer ──
  observerId: string;
  observerName: string;
  // ── When (DD/MM/YYYY for display; month derived for fast filtering) ──
  observationDate: string;
  month: string; // YYYY-MM
  // ── Classification ──
  type: string;
  severity: Severity;
  categoryId: string;
  categoryName: string;
  /** Category weight frozen onto the record at creation (Improvement #3). */
  categoryWeight: number;
  // ── Content ──
  notes: string;
  evidence: string;
  // ── Resolution / corrective action ──
  status: ObservationStatus;
  relatedCapaId: string | null;
  correctiveAction: string;
  dueDate: string | null;
  resolvedDate: string | null;
  // ── KPI / approval (only effective when applyPointDeduction = true) ──
  applyPointDeduction: boolean;
  /** Magnitude; meaningful only when applyPointDeduction = true. */
  points: number;
  /** true = award (bonus), false = deduction. */
  isBonus: boolean;
  /** Latest projected state for fast queries; derived from approvalHistory. */
  approvalStatus: ApprovalStatus;
  /** Append-only — never overwritten. */
  approvalHistory: ApprovalEvent[];
  /** Per-record change trail; also the source for the timeline view. */
  auditLog: AuditEvent[];
  // ── Provenance ──
  createdById: string;
  createdByName: string;
  /** Idempotency key on creation — prevents duplicate observations. */
  clientRequestId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  KPI Settings (Improvement #2 — config-driven, never hardcoded)
// ─────────────────────────────────────────────────────────────

/** How the trend is computed from historical snapshots. */
export type TrendCalculation = 'rollingAverage' | 'movingScore' | 'simpleAverage';

/**
 * Singleton KPI configuration. The engine reads its behavior from this
 * document on every call, so future business-rule changes need no code
 * edit. Stored at `kpiSettings/singleton`.
 */
export interface KpiSettings {
  id: string;
  schemaVersion: 1;
  defaultScore: number;
  minimumScore: number;
  allowBonus: boolean;
  /** Maximum bonus points that may be added to a score. */
  maximumBonus: number;
  /** When true, point deductions require manager approval before scoring. */
  approvalRequired: boolean;
  leaderboardEnabled: boolean;
  /** When true, closing a month locks its observations from further edits. */
  closeMonthLock: boolean;
  trendCalculation: TrendCalculation;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────
//  Monthly Snapshots (Improvement #1 — frozen org state)
// ─────────────────────────────────────────────────────────────

/**
 * Employee metadata frozen at the moment a month closes. Historical
 * reports read this frozen copy, so later transfer / promotion / rename
 * of the employee can never mutate a closed month.
 */
export interface EmployeeSnapshot {
  employeeId: string;
  employeeName: string;
  departmentId: string;
  departmentName: string;
  position: string;
  supervisorId: string | null;
}

/** Per-employee scored entry within a monthly snapshot. */
export interface EmployeeScoreEntry {
  employeeSnapshot: EmployeeSnapshot;
  score: number;
  deductionPoints: number;
  bonusPoints: number;
  /** Σ(points × categoryWeight) — stored for future weighted analytics. */
  weightedPoints: number;
  observationCount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  categoryTotals: Record<string, number>;
  rank: number;
  /** Department name (mirrors employeeSnapshot.departmentName for convenience). */
  dept: string;
}

/** Per-department aggregate within a monthly snapshot. */
export interface DepartmentScoreEntry {
  avgScore: number;
  totalEmployees: number;
  totalDeductionPoints: number;
  totalBonusPoints: number;
  totalObservations: number;
}

/** A leader/bottom-list entry exposed for leaderboards. */
export interface RankedEmployee {
  employeeId: string;
  employeeName: string;
  department: string;
  score: number;
  rank: number;
}

export interface MonthApprovalStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  /** Average hours from submission to a terminal decision, when known. */
  avgApprovalHours: number;
}

export type MonthSnapshotStatus = 'open' | 'closed';

/**
 * One immutable document per month (id = monthKey, e.g. "2026-08").
 *
 * Generated once on Close Month and never recomputed. Reopen flips
 * `status` back to `open` (live again) and never deletes this frozen
 * document; a fresh Close regenerates. `settingsSnapshot` records the
 * KPI configuration used to produce the scores.
 */
export interface MonthSnapshot {
  id: string; // = monthKey
  schemaVersion: 1;
  monthKey: string;
  status: MonthSnapshotStatus;
  closedAt: string | null;
  closedBy: string | null;
  closedByName: string | null;
  reopenCount: number;
  reopenReason: string;
  auditLog: AuditEvent[];
  generatedAt: string;
  /** The KPI settings used to compute this snapshot. */
  settingsSnapshot: KpiSettings;
  employeeScores: Record<string, EmployeeScoreEntry>;
  departmentScores: Record<string, DepartmentScoreEntry>;
  topEmployees: RankedEmployee[];
  bottomEmployees: RankedEmployee[];
  categoryTotals: Record<string, number>;
  approvalStats: MonthApprovalStats;
}

// ─────────────────────────────────────────────────────────────
//  Quality Audit Log (queryable global trail)
// ─────────────────────────────────────────────────────────────

export type QualityAuditEntityType = 'observation' | 'month' | 'category' | 'template' | 'settings';

/**
 * A single queryable audit entry. Written in addition to (not instead
 * of) the per-record `auditLog` so the global trail can be filtered and
 * paginated without loading individual documents.
 */
export interface QualityAuditLogEntry {
  id: string;
  schemaVersion: 1;
  timestamp: string;
  actorId: string;
  actorName: string;
  action: string;
  entityType: QualityAuditEntityType;
  entityId: string;
  monthKey: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string;
  details: string;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────
//  Engine result types (returned by lib/metrics/kpiMetrics)
// ─────────────────────────────────────────────────────────────

export type TrendDirection = 'improving' | 'stable' | 'declining';

/** Trend computed from stored snapshots only — never live recalculation. */
export interface TrendResult {
  direction: TrendDirection;
  /** Month-over-month delta of the score (latest − previous). */
  momDelta: number;
  /** Rolling average across the supplied snapshots. */
  rollingAverage: number;
  /** The most recent score in the series. */
  movingScore: number;
  /** Number of snapshots the trend was based on. */
  sampleSize: number;
}

/** Score breakdown for a single employee over a set of observations. */
export interface EmployeeScoreResult {
  employeeId: string;
  score: number;
  deductionPoints: number;
  bonusPoints: number;
  weightedPoints: number;
  observationCount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  categoryTotals: Record<string, number>;
}

/** The date-range presets every dashboard widget must support. */
export type KpiRangePreset =
  | 'current_month'
  | 'previous_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'current_year'
  | 'custom';
