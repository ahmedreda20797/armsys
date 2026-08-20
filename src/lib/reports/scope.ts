// ══════════════════════════════════════════════════════════════
//  Reporting Architecture — Scope & Filter Resolution (Milestone 8)
//
//  PURE validation/resolution over ReportDefinition + ReportRunRequest.
//  No DB, no React, no Next imports — shared by the API executor
//  (server-side enforcement) and focused tests. The same helpers
//  power the frontend filter bars so client and server can never
//  disagree about which filters a report accepts.
//
//  Reuses (never re-implements):
//    • TimeScope + resolveTimeScopeMonthKeys — @/lib/time-scope
//    • isValidDayKey / isValidMonthKey       — time-scope/month-utils
//    • verifyPermission                      — @/lib/verify-permission
//      (called by the route, not here — this module is pure)
// ══════════════════════════════════════════════════════════════

import { isValidMonthKey } from '@/lib/month-utils';
import {
  describeTimeScope,
  isValidDayKey,
  resolveTimeScopeMonthKeys,
} from '@/lib/time-scope';
import type { TimeScope } from '@/lib/time-scope';
import type {
  EmployeeScope,
  EmployeeScopeMode,
  ReportDefinition,
  ReportFilterKey,
  ReportRunRequest,
} from './types';

/** Result type: either a resolved value or a user-facing error. */
export type Resolution<T> = { ok: true; value: T } | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────
//  Employee scope
// ─────────────────────────────────────────────────────────────

/**
 * Resolve the employee scope of a run request. Precedence:
 *   employeeScope='all' → all; employeeIds → multiple;
 *   employeeId → single; nothing → all.
 *
 * Enforced against the report's allowedEmployeeScopeModes: a
 * request outside the permitted modes is rejected HERE, on the
 * server path — the frontend hiding a filter is never the boundary.
 */
export function resolveEmployeeScope(
  report: ReportDefinition,
  request: Pick<ReportRunRequest, 'employeeId' | 'employeeIds' | 'employeeScope'>,
): Resolution<EmployeeScope> {
  let scope: EmployeeScope;
  if (request.employeeScope === 'all') {
    scope = { mode: 'all' };
  } else if (Array.isArray(request.employeeIds) && request.employeeIds.length > 0) {
    const ids = [...new Set(request.employeeIds)].filter((id) => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) {
      return { ok: false, error: 'قائمة الموظفين المحددة غير صالحة' };
    }
    scope = { mode: 'multiple', employeeIds: ids };
  } else if (typeof request.employeeId === 'string' && request.employeeId.length > 0) {
    scope = { mode: 'single', employeeId: request.employeeId };
  } else {
    scope = { mode: 'all' };
  }

  const allowed = report.permission.allowedEmployeeScopeModes;
  if (allowed && !allowed.includes(scope.mode)) {
    return { ok: false, error: 'نطاق الموظفين المطلوب غير مسموح لهذا التقرير' };
  }
  return { ok: true, value: scope };
}

/**
 * Filter employee ids by the resolved scope + department against the
 * employee list the caller loaded canonically. Pure — used by every
 * report runner so multi-employee / department filtering is ONE
 * mechanism, not per-report reimplementations.
 */
export function applyEmployeeScope<T extends { id: string; department?: string | null }>(
  employees: ReadonlyArray<T>,
  scope: EmployeeScope,
  department?: string | null,
): ReadonlyArray<T> {
  const dept = typeof department === 'string' && department.length > 0 ? department : null;
  let list = employees;
  if (scope.mode === 'single') {
    list = list.filter((e) => e.id === scope.employeeId);
  } else if (scope.mode === 'multiple') {
    const wanted = new Set(scope.employeeIds);
    list = list.filter((e) => wanted.has(e.id));
  }
  if (dept) {
    list = list.filter((e) => (e.department ?? null) === dept);
  }
  return list;
}

// ─────────────────────────────────────────────────────────────
//  Time / period
// ─────────────────────────────────────────────────────────────

export interface ResolvedPeriod {
  /** Machine-readable label for the response meta. */
  label: string;
  /** Month keys covered (most recent first); null only for pure date-range reports. */
  monthKeys: string[] | null;
  range?: { fromDate: string; toDate: string };
  /** The TimeScope when month-scope mechanism was used. */
  timeScope?: TimeScope;
}

/**
 * Resolve the report period per the report's timeMechanism:
 *
 *  date-range  → fromDate/toDate (validated day keys; containing
 *                month keys derived for month-keyed stores).
 *  month-scope → TimeScope resolved via the canonical
 *                resolveTimeScopeMonthKeys (single source of
 *                calendar semantics, pinned by parity tests).
 *  both        → date-range when fromDate/toDate supplied,
 *                otherwise month-scope (monthKey shorthand first).
 *
 * Malformed input is a caller bug → rejected (strict-contract
 * convention of the TimeScope module).
 */
export function resolveReportPeriod(report: ReportDefinition, request: ReportRunRequest, now?: Date): Resolution<ResolvedPeriod> {
  const mech = report.timeMechanism;

  if (mech === 'date-range' || (mech === 'both' && (request.fromDate || request.toDate))) {
    const { fromDate, toDate } = request;
    if (!fromDate || !toDate) {
      return { ok: false, error: 'يجب تحديد تاريخ البداية والنهاية' };
    }
    if (!isValidDayKey(fromDate) || !isValidDayKey(toDate)) {
      return { ok: false, error: 'صيغة التاريخ غير صالحة (YYYY-MM-DD مطلوبة)' };
    }
    if (fromDate > toDate) {
      return { ok: false, error: 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية' };
    }
    const monthKeys = monthKeysBetween(fromDate, toDate);
    return {
      ok: true,
      value: {
        label: `${fromDate}..${toDate}`,
        monthKeys,
        range: { fromDate, toDate },
      },
    };
  }

  // month-scope (or 'both' without a date range)
  let timeScope: TimeScope | undefined;
  if (request.monthKey) {
    if (!isValidMonthKey(request.monthKey)) {
      return { ok: false, error: 'صيغة الشهر غير صالحة (YYYY-MM مطلوبة)' };
    }
    timeScope = { kind: 'selected_month', monthKey: request.monthKey };
  } else if (request.period) {
    timeScope = request.period;
  } else {
    timeScope = { kind: 'current_month' };
  }

  if (report.allowedScopes && !report.allowedScopes.includes(timeScope.kind)) {
    return { ok: false, error: 'نطاق الوقت المطلوب غير مدعوم لهذا التقرير' };
  }

  try {
    const monthKeys = resolveTimeScopeMonthKeys(timeScope, now);
    return {
      ok: true,
      value: {
        label: describeTimeScope(timeScope),
        monthKeys,
        timeScope,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'نطاق وقت غير صالح' };
  }
}

/** Containing month keys spanned by a day range, ascending. */
export function monthKeysBetween(fromDate: string, toDate: string): string[] {
  const keys: string[] = [];
  const start = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${toDate}T00:00:00`);
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return keys;
}

// ─────────────────────────────────────────────────────────────
//  Extra filters
// ─────────────────────────────────────────────────────────────

/**
 * Keep only the extra filters the report declares. Unknown keys are
 * DROPPED (not an error) so a stale client filter can never inject
 * hidden query parameters — meaningless filters never reach a
 * runner.
 */
export function pickAllowedFilters(
  report: ReportDefinition,
  filters: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  if (!filters) return {};
  const allowed = new Set<string>(report.allowedFilters.map((f) => f.key as string));
  const picked: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (allowed.has(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
      picked[key] = value;
    }
  }
  // Scope fields arrive as top-level request fields, never as extra
  // filters.  Period fields are handled by resolveReportPeriod —
  // stripping them here prevents double-handling.
  delete picked.employeeId;
  delete picked.employeeIds;
  delete picked.employeeScope;
  delete picked.department;
  delete picked.fromDate;
  delete picked.toDate;
  delete picked.monthKey;
  delete picked.monthKeys;
  delete picked.period;
  return picked;
}

/**
 * Validate a full run request against a report definition (scope +
 * period + filters). Returns every resolved input a runner needs.
 */
export interface ResolvedReportRequest {
  employeeScope: EmployeeScope;
  department: string | null;
  period: ResolvedPeriod;
  filters: Record<string, string | number | boolean>;
}

export function resolveReportRequest(
  report: ReportDefinition,
  request: ReportRunRequest,
  now?: Date,
): Resolution<ResolvedReportRequest> {
  const scope = resolveEmployeeScope(report, request);
  if (!scope.ok) return scope;

  const period = resolveReportPeriod(report, request, now);
  if (!period.ok) return period;

  return {
    ok: true,
    value: {
      employeeScope: scope.value,
      department: typeof request.department === 'string' && request.department.length > 0 ? request.department : null,
      period: period.value,
      filters: pickAllowedFilters(report, request.filters),
    },
  };
}

/** Employee scope modes a request may declare — for UI switchers. */
export const ALL_EMPLOYEE_SCOPE_MODES: readonly EmployeeScopeMode[] = ['single', 'multiple', 'all'];

/** Type-only re-export for filter-key consumers (registry, tests). */
export type { ReportFilterKey };
