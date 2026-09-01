// ══════════════════════════════════════════════════════════════
//  KPI Visibility Trace — Phase 6.3 (spec §33-§37)
//
//  Answers ONE question precisely: WHY does (or does not) an
//  employee appear in the KPI Reports for a given month?
//
//  The trace walks the EXACT §34 chain, in order, and reports the
//  FIRST layer where the employee drops out of the report:
//
//    1. observations     — do observations reference this id/month?
//    2. employeeRecord   — does a canonical employee record exist?
//    3. scope            — is the viewer authorized to see them?
//    4. eligibility      — employed at any point of the month?
//    5. scheme           — a KPI scheme resolvable in that period?
//    6. reportRow        — which row status WOULD the report carry?
//
//  HARD RULES (§36):
//    • having observations NEVER creates eligibility — the trace
//      REPORTS the mismatch, it does not judge it as a bug;
//    • zero observations never hides an eligible employee — a row
//      would be PENDING (missing data is never an exclusion);
//    • this is a DIAGNOSTIC ONLY: it computes NO score, NO weight,
//      NO KPI value, and writes NOTHING. Every reuse below is a
//      read of the SAME engine/reporting helpers the reports use —
//      the trace can never disagree with the report (§34).
// ══════════════════════════════════════════════════════════════

import type { EmploymentEventLike } from '@/lib/kpi-framework/employee-result';
import { isEmployeeEligibleForPeriod } from '@/lib/kpi-framework';
import type { QualityObservation } from '@/types/quality-kpi';
import type { KpiReportingLoaders } from './loaders';
import { resolveSchemeFromLoaded, toFrameworkEmployee } from './loaders';
import { resolveValueBasis } from './period-basis';

export interface KpiVisibilityTraceInput {
  monthKey: string;
  employeeId: string;
  /** Now (deterministic tests); defaults to the clock. */
  now?: Date;
}

export interface KpiVisibilityLayer {
  key: 'observations' | 'employeeRecord' | 'scope' | 'eligibility' | 'scheme' | 'reportRow';
  /** true = passes / present; false = the employee drops out HERE. */
  ok: boolean;
  label: string;
  /** Arabic explanation of THIS layer's verdict. */
  detail: string;
}

export interface KpiVisibilityTrace {
  monthKey: string;
  employeeId: string;
  valueBasis: 'MTD' | 'LIVE' | 'FINALIZED';
  layers: KpiVisibilityLayer[];
  /** The FIRST layer where the employee disappears (null = visible). */
  firstMissingLayer: KpiVisibilityLayer['key'] | null;
  /** Whether the employee would appear as a report row right now. */
  wouldAppearInReport: boolean;
  /** The row status the report would carry (when eligible+scoped). */
  rowStatus: string | null;
  /** Overall Arabic verdict. */
  verdict: string;
}

/**
 * Scope input: the resolved caller scope, computed by the API route
 * with the EXISTING scope engine (never recomputed here).
 * `inScope: true` when unrestricted OR the id is authorized.
 */
export interface ScopeSnapshot {
  inScope: boolean;
  unrestricted: boolean;
}

export async function traceEmployeeKpiVisibility(
  input: KpiVisibilityTraceInput,
  loaders: KpiReportingLoaders,
  scope: ScopeSnapshot,
): Promise<KpiVisibilityTrace> {
  const { monthKey, employeeId } = input;
  const now = input.now ?? new Date();
  const layers: KpiVisibilityLayer[] = [];

  // ── 1. Observations referencing this employee/month (context only) ──
  let observationCount = 0;
  try {
    const monthObs = await loaders.loadObservations(monthKey);
    observationCount = monthObs.filter(
      (o: QualityObservation) => o && o.employeeId === employeeId,
    ).length;
  } catch {
    observationCount = 0;
  }
  layers.push({
    key: 'observations',
    ok: true, // observations NEVER gate visibility (§36) — context only
    label: 'ملاحظات الجودة',
    detail:
      observationCount > 0
        ? `توجد ${observationCount} ملاحظة مرتبطة بهذا الموظف في ${monthKey}.`
        : `لا توجد ملاحظات مرتبطة بهذا الموظف في ${monthKey} — لا يمنع ظهوره كمعلّق (PENDING).`,
  });

  // ── 2. Canonical employee record ──
  const record = await loaders.loadEmployeeRecord(employeeId);
  if (!record) {
    layers.push({
      key: 'employeeRecord',
      ok: false,
      label: 'سجل الموظف',
      detail:
        'لا يوجد موظف بهذا المعرّف في جدول الموظفين. الملاحظات قد تكون يتيمة ' +
        '(معرّف غير مطابق أو موظف محذوف) — لا يمكن لأي تقرير عرض موظف بلا سجل.',
    });
    return finish(layers, monthKey, employeeId, 'LIVE', now, false, null, 'الموظف مفقود من جدول الموظفين — هذه أول طبقة يختفي فيها.');
  }
  layers.push({
    key: 'employeeRecord',
    ok: true,
    label: 'سجل الموظف',
    detail: `سجل موجود: ${record.name}${record.status ? ` (الحالة: ${String(record.status)})` : ''}.`,
  });

  // ── 3. Viewer scope (computed by the route via the scope engine) ──
  layers.push({
    key: 'scope',
    ok: scope.inScope,
    label: 'نطاق الصلاحية',
    detail: scope.inScope
      ? scope.unrestricted
        ? 'نطاقك غير مقيّد — الموظف داخل النطاق.'
        : 'الموظف داخل نطاق الصلاحية المصرّح لك.'
      : 'الموظف خارج نطاق الصلاحية المصرّح لك — تُستبعد صفوفه من التقارير.',
  });
  if (!scope.inScope) {
    return finish(layers, monthKey, employeeId, 'LIVE', now, false, null, 'الموظف خارج نطاق صلاحيتك — تُخفى صفوفه في التقارير (سلوك مقصود).');
  }

  // ── 4. Employment eligibility (the engine's own rule, reused) ──
  const frameworkEmployee = toFrameworkEmployee(record);
  const events = (await loaders.loadEmploymentEventsByEmployee()).get(employeeId) ?? [];
  const eligible = isEmployeeEligibleForPeriod(
    frameworkEmployee,
    events as ReadonlyArray<EmploymentEventLike>,
    monthKey,
  );
  layers.push({
    key: 'eligibility',
    ok: eligible,
    label: 'أهلية الفترة',
    detail: eligible
      ? 'كان الموظف مُستخدمًا خلال جزء من هذه الفترة — مؤهل للظهور.'
      : 'لم يكن الموظف مُستخدمًا خلال هذه الفترة (توظيف/أرشفة/استعادة) — تُستبعد صفوفه بلا أصفار مختلقة (§11).',
  });
  if (!eligible) {
    return finish(layers, monthKey, employeeId, 'LIVE', now, false, null, 'الموظف غير مؤهل لهذه الفترة حسب قواعد دورة التوظيف — لا يظهر في تقرير هذه الفترة.');
  }

  // ── 5. Scheme resolution (same pure path as the report) ──
  const [schemes, overrides] = await Promise.all([loaders.loadSchemes(), loaders.loadOverrides()]);
  const resolution = resolveSchemeFromLoaded(frameworkEmployee, overrides, schemes, monthKey);
  if (resolution.status !== 'RESOLVED') {
    layers.push({
      key: 'scheme',
      ok: false,
      label: 'مخطط KPI',
      detail:
        resolution.status === 'AMBIGUOUS'
          ? 'توجد مخططات متعددة متطابقة — يظهر الموظف بحالة AMBIGUOUS ويلزم المراجعة.'
          : resolution.status === 'OVERRIDE_NOT_RESOLVABLE'
            ? 'المخطط المعتمد (override) غير قابل للتطبيق — يظهر بحالة OVERRIDE_NOT_RESOLVABLE.'
            : 'لا يوجد مخطط KPI سارٍ — يظهر الموظف بحالة NO_SCHEME (وليس صفرًا).',
    });
    // NO_SCHEME/AMBIGUOUS rows still APPEAR — not a disappearance.
    return finish(layers, monthKey, employeeId, 'LIVE', now, true, resolution.status, 'الموظف يظهر في التقرير بصف بلا نتيجة (لا مخطط سارٍ).');
  }
  layers.push({
    key: 'scheme',
    ok: true,
    label: 'مخطط KPI',
    detail: `مخطط سارٍ: ${resolution.scheme?.name ?? ''} (v${resolution.scheme?.version ?? ''}).`,
  });

  // ── 6. The row status the report would carry ──
  const detail = await loaders.loadMonthDetail(monthKey);
  const finalized = detail?.status === 'closed';
  const frozen = finalized ? detail?.kpiResults?.[employeeId] : undefined;
  const entry = detail?.employeeScores?.[employeeId] ?? null;
  const rowStatus = frozen
    ? 'FINALIZED'
    : finalized
      ? entry
        ? 'FINALIZED (مشتق)'
        : 'PENDING'
      : entry
        ? 'متاح حي (LIVE)'
        : 'PENDING';
  layers.push({
    key: 'reportRow',
    ok: true,
    label: 'صف التقرير',
    detail: `سيظهر الموظف في التقرير بحالة: ${rowStatus}.`,
  });

  return finish(
    layers,
    monthKey,
    employeeId,
    resolveValueBasis(monthKey, detail?.status ?? null, now),
    now,
    true,
    rowStatus,
    'لا يوجد مانع — الموظف مؤهل وداخل النطاق وسيظهر في تقرير ' +
      monthKey +
      '. إن لم تره فالأسباب المحتملة: فلتر حالة/بحث نشط في الواجهة.',
  );
}

function finish(
  layers: KpiVisibilityLayer[],
  monthKey: string,
  employeeId: string,
  valueBasis: KpiVisibilityTrace['valueBasis'],
  now: Date,
  wouldAppear: boolean,
  rowStatus: string | null,
  verdict: string,
): KpiVisibilityTrace {
  const missing = layers.find((l) => !l.ok);
  return {
    monthKey,
    employeeId,
    valueBasis,
    layers,
    firstMissingLayer: missing?.key ?? null,
    wouldAppearInReport: wouldAppear,
    rowStatus,
    verdict,
  };
}
