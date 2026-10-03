// ══════════════════════════════════════════════════════════════
//  GET /api/performance-intelligence — Employee Performance
//  Intelligence dataset (Phase 3) + §QUALITY-INTELLIGENCE
//  decision/risk and permission-gated HR facts.
//
//  Thin route: authenticate → authorize (existing kpiReports
//  permission — no second permission system) → AUTHORIZED scope
//  check on the requested employee (fail-closed 404,
//  anti-enumeration) → delegate to the read-only service.
//
//  Query parameters:
//    employeeId   (required)
//    month        (required, YYYY-MM)
//    windowMonths (optional, default 6, clamped 1..36)
//    minOccurrences (optional, default 2, clamped ≥ 2)
//
//  The response is DETERMINISTIC FACTS ONLY — no narratives.
//  §QUALITY-INTELLIGENCE additions (both computed over the SAME
//  dataset instance — no second engine run):
//    decision     — the canonical HR-decision/risk-engine projection,
//                   SECTION-GATED server-side: the report is withheld
//                   (null) when the viewer lacks the employee360
//                   decisionSupport section, and its per-section
//                   factors/scorecard entries are dropped by the SAME
//                   employee360 section gate the Employee360 profile
//                   uses (hrDeductions etc.). Server-side enforcement —
//                   the UI never decides visibility.
//    hrDeductions — the employee's stored HR-deduction month block
//                   (aggregateHrMonth projection), null unless the
//                   viewer holds the hrDeductions section.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError,
  internalError,
  logServerFailure,
  notFoundError,
  unauthorizedError,
  validationError,
} from '@/lib/api-error';
import { validateMonthKey } from '@/lib/month-utils';
import { asScopeViewer, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import {
  getEmployeePerformanceDataset,
  MAX_WINDOW_MONTHS,
  MIN_WINDOW_MONTHS,
} from '@/lib/performance-intelligence';
import { getHrEmployeeDecisionReport } from '@/lib/hr-decision';
import { filterFactorsBySectionGate, filterScorecardBySectionGate } from '@/lib/hr-decision/section-gate';
import { resolveEmployee360SectionGate } from '@/lib/permissions/employee360-access';
import { getAll } from '@/lib/db';
import { aggregateHrMonth } from '@/lib/employee-performance';
import type { EmployeeHrDeductionRecord } from '@/lib/employee-performance';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'kpiReports', 'view');
    if (!permCheck.allowed || !permCheck.user) {
      return forbiddenError(permCheck.error);
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    if (!employeeId) return validationError('معرّف الموظف مطلوب');

    const month = searchParams.get('month');
    const monthError = validateMonthKey(month);
    if (monthError) return validationError(monthError);

    const windowMonthsRaw = searchParams.get('windowMonths');
    let windowMonths: number | undefined;
    if (windowMonthsRaw !== null) {
      const parsed = Number(windowMonthsRaw);
      if (!Number.isFinite(parsed)) return validationError('عدد أشهر النافذة غير صالح');
      windowMonths = Math.max(MIN_WINDOW_MONTHS, Math.min(MAX_WINDOW_MONTHS, Math.trunc(parsed)));
    }

    const minOccurrencesRaw = searchParams.get('minOccurrences');
    let minOccurrences: number | undefined;
    if (minOccurrencesRaw !== null) {
      const parsed = Number(minOccurrencesRaw);
      if (!Number.isFinite(parsed) || parsed < 2) {
        return validationError('الحد الأدنى للتكرار يجب أن يكون 2 على الأقل');
      }
      minOccurrences = Math.trunc(parsed);
    }

    // ── Authorized scope on the TARGET employee (fail-closed 404) ──
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user),
      undefined,
      permCheck.user.permissions,
    );
    if (!scopeCtx.isUnrestricted && !scopeCtx.includes(employeeId!)) {
      // Anti-enumeration: out-of-scope employees "do not exist".
      return notFoundError('الموظف غير موجود');
    }

    const dataset = await getEmployeePerformanceDataset({
      employeeId: employeeId!,
      monthKey: month!,
      windowMonths,
      minOccurrences,
    });

    if (!dataset) return notFoundError('الموظف غير موجود');

    // ═══ §QUALITY-INTELLIGENCE — canonical decision/risk projection ═══
    // The canonical SECTION gate (the same resolver Employee360 uses)
    // decides, server-side, whether this viewer may see the decision
    // support block and each factor-owning section.
    const sectionGate = resolveEmployee360SectionGate(permCheck.user.permissions);

    let decision: Awaited<ReturnType<typeof getHrEmployeeDecisionReport>> = null;
    if (sectionGate.decisionSupport) {
      const full = await getHrEmployeeDecisionReport({
        employeeId: employeeId!,
        monthKey: month!,
        dataset,
      });
      if (full) {
        // Per-section enforcement: factor lines and scorecard entries
        // owned by a denied section are DROPPED before serialization
        // (the same rule the Employee360 profile applies).
        decision = {
          ...full,
          factors: filterFactorsBySectionGate(full.factors, sectionGate),
          concerns: filterFactorsBySectionGate(full.concerns, sectionGate),
          strengths: filterFactorsBySectionGate(full.strengths, sectionGate),
          scorecard: filterScorecardBySectionGate(full.scorecard, sectionGate),
        };
      }
    }

    // ═══ HR deductions — withheld unless the section is granted ═══
    let hrDeductionsBlock: ReturnType<typeof aggregateHrMonth> | null = null;
    if (sectionGate.hrDeductions) {
      const rows = await getAll('hrDeductions').catch(() => [] as never[]);
      const monthRows = (rows as Array<Record<string, unknown>>)
        .filter((r) => r.employeeId === employeeId && r.month === month);
      hrDeductionsBlock = monthRows.length
        ? aggregateHrMonth(month!, monthRows as unknown as EmployeeHrDeductionRecord[])
        : null;
    }

    return Response.json({
      ...dataset,
      decision,
      hrDeductions: hrDeductionsBlock,
    });
  } catch (error) {
    logServerFailure('performance-intelligence', 'GET', error);
    return internalError();
  }
}
