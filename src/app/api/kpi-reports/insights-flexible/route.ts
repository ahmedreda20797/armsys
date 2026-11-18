// ══════════════════════════════════════════════════════════════
//  GET /api/kpi-reports/insights-flexible — Flexible-period KPI
//  insights (§FLEX-PERIODS)
//
//  Thin route (the insights-route doctrine): authenticate →
//  authorize (kpiReports view) → technical-audience guard →
//  resolve the AUTHORIZED employee scope → parse + validate the
//  period specs → delegate to the flexible builder (pure
//  composition over the canonical monthly machinery).
//
//  Query parameters (period specs are JSON-encoded, urlencoded):
//    period      (required)  FlexiblePeriodSpec JSON
//    comparison  (optional)  FlexibleComparisonSpec JSON
//                            (default: {"kind":"previous_period"})
//    employees   optional comma-separated employee ids (narrowing)
//    orgNodes    optional comma-separated org node ids (subtrees)
//    includeArchived 'true' to include archived-yet-eligible
//
//  Overlapping primary/comparison periods → 400 with the explicit
//  validation message (never a misleading comparison).
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth, verifyPermission, authorize } from '@/lib/verify-permission';
import {
  forbiddenError,
  internalError,
  logServerFailure,
  unauthorizedError,
  validationError,
} from '@/lib/api-error';
import { asScopeViewer, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { technicalReportAudienceGuard } from '@/lib/report-audience/server-guard';
import { buildFlexibleKpiInsights, isFlexiblePeriodValidationError } from '@/lib/kpi-reporting';
import type { FlexibleComparisonSpec, FlexiblePeriodSpec } from '@/lib/kpi-reporting';

const MAX_SELECTION_IDS = 100;

function parseIdList(raw: string | null): string[] {
  if (!raw) return [];
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length <= 128);
  return [...new Set(ids)].slice(0, MAX_SELECTION_IDS);
}

const PERIOD_KINDS = new Set(['day', 'week', 'month', 'quarter', 'six_months', 'year', 'custom_range']);

/** Strict spec parse — unknown shapes are 400s, never guesses. */
function parsePeriodSpec(raw: string | null, field: string): FlexiblePeriodSpec | { error: string } {
  if (raw === null) return { error: `معامل ${field} مطلوب` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: `معامل ${field} ليس JSON صالحًا` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: `صيغة ${field} غير صالحة` };
  }
  const spec = parsed as Record<string, unknown>;
  if (typeof spec.kind !== 'string' || !PERIOD_KINDS.has(spec.kind)) {
    return { error: `نوع فترة غير مدعوم في ${field}: ${String(spec.kind)}` };
  }
  switch (spec.kind) {
    case 'day':
      if (typeof spec.date !== 'string') return { error: 'التاريخ مطلوب (YYYY-MM-DD)' };
      return { kind: 'day', date: spec.date };
    case 'week':
      if (typeof spec.weekStart !== 'string') return { error: 'بداية الأسبوع مطلوبة (YYYY-MM-DD)' };
      return { kind: 'week', weekStart: spec.weekStart };
    case 'month':
      if (typeof spec.monthKey !== 'string') return { error: 'الشهر مطلوب (YYYY-MM)' };
      return { kind: 'month', monthKey: spec.monthKey };
    case 'quarter':
      if (!Number.isInteger(spec.year) || ![1, 2, 3, 4].includes(spec.quarter as number)) {
        return { error: 'الربع يتطلب سنة وربعًا صحيحًا (1-4)' };
      }
      return { kind: 'quarter', year: spec.year as number, quarter: spec.quarter as 1 | 2 | 3 | 4 };
    case 'six_months':
      if (!Number.isInteger(spec.year) || ![1, 2].includes(spec.half as number)) {
        return { error: 'نصف السنة يتطلب سنة ونصفًا صحيحًا (1 أو 2)' };
      }
      return { kind: 'six_months', year: spec.year as number, half: spec.half as 1 | 2 };
    case 'year':
      if (!Number.isInteger(spec.year)) return { error: 'السنة مطلوبة' };
      return { kind: 'year', year: spec.year as number };
    case 'custom_range':
      if (typeof spec.fromDate !== 'string' || typeof spec.toDate !== 'string') {
        return { error: 'المدى المخصص يتطلب fromDate و toDate (YYYY-MM-DD)' };
      }
      return { kind: 'custom_range', fromDate: spec.fromDate, toDate: spec.toDate };
    default:
      return { error: `نوع فترة غير مدعوم: ${String(spec.kind)}` };
  }
}

function parseComparisonSpec(raw: string | null): FlexibleComparisonSpec {
  if (raw === null) return { kind: 'previous_period' };
  if (raw === 'previous_period') return { kind: 'previous_period' };
  const parsed = parsePeriodSpec(raw, 'comparison');
  if ('error' in parsed) return { kind: 'previous_period' };
  return parsed;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'kpiReports', 'view');
    if (!permCheck.allowed || !permCheck.user) {
      return forbiddenError(permCheck.error);
    }

    const audienceRejection = technicalReportAudienceGuard(permCheck.user);
    if (audienceRejection) return audienceRejection;

    const { searchParams } = new URL(request.url);
    const primary = parsePeriodSpec(searchParams.get('period'), 'period');
    if ('error' in primary) return validationError(primary.error);
    const comparison = parseComparisonSpec(searchParams.get('comparison'));

    const employeeIds = parseIdList(searchParams.get('employees'));
    const orgNodeIds = parseIdList(searchParams.get('orgNodes'));
    const includeArchived = searchParams.get('includeArchived') === 'true';

    // ── Authorized employee scope (M0.5) — resolved server-side ──
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user),
      undefined,
      permCheck.user.permissions,
    );
    const scopeLimit = scopeCtx.isUnrestricted ? null : [...scopeCtx.employeeIds];

    let report;
    try {
      report = await buildFlexibleKpiInsights({
        primary,
        comparison,
        scopeLimit,
        selection: { employeeIds, orgNodeIds },
        filters: { includeArchived },
      });
    } catch (error) {
      // §API-ERROR-CONTRACTS — the builder throws ONLY explicit
      // user-input errors as TYPED validation failures (stable code,
      // structural check — never Arabic message-substring matching).
      // The Arabic text stays the user-facing message; the stable
      // code rides in `details` for machine-readable clients.
      if (isFlexiblePeriodValidationError(error)) {
        return validationError(error.message, { periodErrorCode: error.code });
      }
      throw error;
    }

    // Field-level authorization surface (the insights-route parity):
    // the HR-deductions fact is masked as restricted for callers
    // without the hrDeductions page.
    const hrDecision = authorize(auth, { page: 'hrDeductions' });
    if (!hrDecision.allowed && report.deductions.count > 0) {
      report.deductions = { ...report.deductions, count: 0, totalDays: 0, byType: [], previousCount: null };
      report.dataQuality.push('deductionsRestricted');
    }

    return Response.json(report);
  } catch (error) {
    logServerFailure('kpi-reports-insights-flexible', 'GET', error);
    return internalError();
  }
}
