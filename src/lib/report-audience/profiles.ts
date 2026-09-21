// ══════════════════════════════════════════════════════════════
//  Report Audience Profiles — Qnalys audience-aware reporting
//
//  ONE reusable abstraction between the canonical KPI/reporting
//  data and any audience-specific view:
//
//    Canonical KPI / Evidence Data  (existing engines — untouched)
//            ↓
//    Report Audience / Profile      (this module — pure)
//            ↓
//    Sanitized Report View Model    (per-audience projection)
//            ↓
//    UI / Print / Export
//
//  NO second KPI engine, no second permission system: an audience
//  is RESOLVED from the caller's existing effective permission map
//  (role → position → stored override — the same map verifyPermission
//  and usePermissions already produce) and only decides WHICH
//  projection of the canonical data a caller may receive. The
//  server routes enforce it BEFORE serialization — technical data is
//  never sent to an HR audience and hidden in the frontend.
//
//  CLIENT-SAFE: this module imports types only — the same pure
//  resolver runs in the UI (tab visibility) and on the server
//  (enforcement), so the two can never disagree about the audience.
// ══════════════════════════════════════════════════════════════

import type { DataScope, PagePermission, PermissionsMap } from '@/config/permissions';

// ─────────────────────────────────────────────────────────────
//  Audience vocabulary
// ─────────────────────────────────────────────────────────────

/**
 * Who a report is being prepared FOR. Drives which sections/fields
 * the projection keeps.
 *
 *   TECHNICAL    — Quality/technical users: full detail including
 *                  evidence, deductions, component math.
 *   TEAM_LEADER  — People managers without technical authority:
 *                  team/employee results and statuses, no evidence.
 *   HR           — People operations: performance RESULT + org
 *                  context ONLY (no observation text, evidence,
 *                  deduction/complaint/CAPA/deal detail).
 *   MANAGEMENT   — Foundation only (aggregated organizational
 *                  reporting arrives as its own task; nothing
 *                  resolves to it yet).
 */
export type ReportAudience = 'TECHNICAL' | 'TEAM_LEADER' | 'HR' | 'MANAGEMENT';

/** Field groups a projection may keep. Grants are ALLOW-lists. */
export interface ReportAudienceGrants {
  /** Identity + organizational context (name/code/dept/team/position). */
  identity: boolean;
  /** Employment lifecycle context (status, archived-but-eligible). */
  employmentContext: boolean;
  /** Final performance result value (the canonical KPI score). */
  performanceResult: boolean;
  /** Result/status/eligibility vocabulary (PENDING/NO_SCHEME/…). */
  performanceStatus: boolean;
  /** Scheme NAME for context (never weights/component math). */
  schemeIdentity: boolean;
  /** Aggregated period totals (counts only — no per-employee math). */
  periodTotals: boolean;
  /** Quality evidence: observations, deduction/bonus points, counts. */
  technicalEvidence: boolean;
  /** Component-level math: weights, contributions, available weight. */
  componentMath: boolean;
  /** Cross-domain operational records (complaints/CAPA/deals/follow-ups). */
  operationalRecords: boolean;
  /** Trend / period-comparison series. */
  trend: boolean;
}

const FULL_GRANTS: ReportAudienceGrants = {
  identity: true,
  employmentContext: true,
  performanceResult: true,
  performanceStatus: true,
  schemeIdentity: true,
  periodTotals: true,
  technicalEvidence: true,
  componentMath: true,
  operationalRecords: true,
  trend: true,
};

/**
 * The profile registry. HR is the strictest non-management audience:
 * result + status + org context only — technical evidence, component
 * math and operational records are structurally absent from its view
 * model (the projection never copies them, so they cannot leak).
 */
export const REPORT_AUDIENCE_PROFILES: Readonly<Record<ReportAudience, ReportAudienceGrants>> = {
  TECHNICAL: FULL_GRANTS,
  TEAM_LEADER: {
    ...FULL_GRANTS,
    technicalEvidence: false,
    componentMath: false,
    operationalRecords: false,
  },
  HR: {
    identity: true,
    employmentContext: true,
    performanceResult: true,
    performanceStatus: true,
    schemeIdentity: true,
    periodTotals: true,
    technicalEvidence: false,
    componentMath: false,
    operationalRecords: false,
    trend: false,
  },
  // MANAGEMENT foundation: aggregated organizational shape only.
  MANAGEMENT: {
    identity: false,
    employmentContext: false,
    performanceResult: true,
    performanceStatus: true,
    schemeIdentity: true,
    periodTotals: true,
    technicalEvidence: false,
    componentMath: false,
    operationalRecords: false,
    trend: true,
  },
};

/** Human-readable (Arabic) audience labels for UI surfaces. */
export const REPORT_AUDIENCE_LABELS_AR: Readonly<Record<ReportAudience, string>> = {
  TECHNICAL: 'تقرير فني — الجودة',
  TEAM_LEADER: 'تقرير قائد الفريق',
  HR: 'تقرير الموارد البشرية',
  MANAGEMENT: 'تقرير الإدارة',
};

// ─────────────────────────────────────────────────────────────
//  Audience resolution (existing permissions — no new system)
// ─────────────────────────────────────────────────────────────

/** Pages whose view access marks a QUALITY/TECHNICAL function. */
const TECHNICAL_PAGE_KEYS = ['quality', 'observations'] as const;

function entryLevel(permissions: PermissionsMap | null | undefined, key: string): PagePermission['level'] {
  const raw = permissions?.[key];
  if (!raw) return 'none';
  return typeof raw === 'object' && raw !== null && 'level' in raw ? raw.level : (raw as PagePermission['level']);
}

function entryScope(permissions: PermissionsMap | null | undefined, key: string): DataScope | undefined {
  const raw = permissions?.[key];
  if (!raw || typeof raw !== 'object' || !('scope' in raw)) return undefined;
  return (raw as PagePermission).scope;
}

/**
 * Resolve the caller's report audience from the EFFECTIVE permission
 * map (already merged role → position → stored override by
 * verifyPermission / usePermissions) and role:
 *
 *   admin                              → TECHNICAL (existing bypass)
 *   view on quality | observations     → TECHNICAL (quality function)
 *   employees entry scoped to people   → TEAM_LEADER
 *     (department/team/subtree — manages a population, no technical
 *      page access)
 *   otherwise                          → HR
 *
 * MANAGEMENT never auto-resolves (foundation — aggregated reporting
 * is its own future task).
 *
 * Pure and deterministic: same map in, same audience out, on the
 * server (route enforcement) and in the client (tab visibility).
 */
export function resolveReportAudience(args: {
  role: string | null | undefined;
  permissions: PermissionsMap | null | undefined;
}): ReportAudience {
  const { role, permissions } = args;
  if (role === 'admin') return 'TECHNICAL';
  if (TECHNICAL_PAGE_KEYS.some((k) => entryLevel(permissions, k) !== 'none')) {
    return 'TECHNICAL';
  }
  const employeesScope = entryScope(permissions, 'employees');
  if (employeesScope === 'department' || employeesScope === 'team' || employeesScope === 'subtree') {
    return 'TEAM_LEADER';
  }
  return 'HR';
}

/** Grants of a resolved audience (convenience over the registry). */
export function grantsForAudience(audience: ReportAudience): ReportAudienceGrants {
  return REPORT_AUDIENCE_PROFILES[audience];
}

/**
 * May this audience receive the TECHNICAL (full-detail) reports?
 * The KPI technical routes reject non-technical audiences server-
 * side; HR/TEAM_LEADER callers are directed to their own report.
 */
export function audienceMayReceiveTechnicalReports(audience: ReportAudience): boolean {
  return audience === 'TECHNICAL';
}
