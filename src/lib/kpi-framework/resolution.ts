// ══════════════════════════════════════════════════════════════
//  Configurable KPI Framework — Scheme Resolution (Phase 1)
//
//  Determines which ACTIVE KPI Scheme applies to an employee for a
//  given period. Pure + deterministic — the db-bound wrapper lives
//  in service.ts.
//
//  Precedence (fail-safe at every level):
//
//    1. Employee-specific override   (kpiSchemeOverrides/{employeeId})
//    2. Department applicability     (scheme.applicableDepartments ∋ employee.department)
//    3. Active default scheme        (scheme.isDefault)
//
//  HARD RULES:
//    • Only ACTIVE schemes covering the period's effective window
//      can resolve.
//    • An override that points to a missing / non-active /
//      not-covering scheme FAILS EXPLICITLY
//      (OVERRIDE_NOT_RESOLVABLE) — it never silently falls through
//      to the default scheme.
//    • Multiple equally-ranked matches for the same window are
//      AMBIGUOUS — no arbitrary scheme is ever chosen.
//    • Resolution uses ONLY stable employee fields (id, department).
//      The Organization Tree is NOT consulted (separate future
//      redesign; unassigned employees resolve via default/override).
// ══════════════════════════════════════════════════════════════

import type {
  KpiScheme,
  KpiSchemeOverride,
  KpiSchemeResolution,
} from './types';
import { schemeCoversPeriod } from './validation';

/** Input shapes the pure resolver needs — no DB, no org tree. */
export interface ResolveSchemeInput {
  employee: { id: string; department?: string | null };
  overrides: ReadonlyArray<KpiSchemeOverride>;
  schemes: ReadonlyArray<KpiScheme>;
  /** `YYYY-MM` period the scheme must cover. */
  period: string;
}

/** Arabic explanation for a failed resolution. */
function fail(
  status: KpiSchemeResolution['status'],
  candidates: number,
  message: string,
): KpiSchemeResolution {
  return { status, source: null, scheme: null, candidates, message };
}

/**
 * Resolve the applicable KPI scheme for an employee/period.
 * Never throws — every outcome is an explicit status.
 */
export function resolveSchemeForEmployee(input: ResolveSchemeInput): KpiSchemeResolution {
  const { employee, overrides, schemes, period } = input;

  const activeSchemes = schemes.filter((s) => s.status === 'ACTIVE');

  // ── Level 1: employee-specific override (highest precedence) ──
  const override = overrides.find((o) => o.employeeId === employee.id);
  if (override) {
    const overridden = activeSchemes.find((s) => s.id === override.schemeId);
    if (!overridden || !schemeCoversPeriod(overridden, period)) {
      return fail(
        'OVERRIDE_NOT_RESOLVABLE',
        overridden ? 1 : 0,
        overridden
          ? `نظام المؤشرات المحدد لهذا الموظف لا يسري على الفترة ${period}`
          : 'نظام المؤشرات المحدد لهذا الموظف غير موجود أو غير نشط',
      );
    }
    return { status: 'RESOLVED', source: 'employee_override', scheme: overridden, candidates: 1, message: null };
  }

  // ── Level 2: department applicability (stable employee field) ──
  const department = typeof employee.department === 'string' ? employee.department : null;
  if (department) {
    const deptMatches = activeSchemes.filter(
      (s) =>
        Array.isArray(s.applicableDepartments) &&
        s.applicableDepartments.includes(department) &&
        schemeCoversPeriod(s, period),
    );
    if (deptMatches.length === 1) {
      return { status: 'RESOLVED', source: 'department', scheme: deptMatches[0], candidates: 1, message: null };
    }
    if (deptMatches.length > 1) {
      return fail(
        'AMBIGUOUS',
        deptMatches.length,
        `توجد عدة أنظمة مؤشرات نشطة تنطبق على قسم "${department}" لنفس الفترة — يلزم مراجعة تواريخ السريان`,
      );
    }
  }

  // ── Level 3: active default scheme ──
  const defaultMatches = activeSchemes.filter(
    (s) => s.isDefault && schemeCoversPeriod(s, period),
  );
  if (defaultMatches.length === 1) {
    return { status: 'RESOLVED', source: 'default', scheme: defaultMatches[0], candidates: 1, message: null };
  }
  if (defaultMatches.length > 1) {
    return fail(
      'AMBIGUOUS',
      defaultMatches.length,
      'توجد عدة أنظمة مؤشرات افتراضية نشطة لنفس الفترة — يلزم مراجعة تواريخ السريان',
    );
  }
  return fail('NO_SCHEME', 0, 'لا يوجد نظام مؤشرات أداء نشط يسري على هذه الفترة');
}
