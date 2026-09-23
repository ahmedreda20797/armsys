// ══════════════════════════════════════════════════════════════
//  HR Decision-Support — Factor builders + status evaluation
//
//  PURE + DETERMINISTIC. Rules operate ONLY on:
//    • the canonical dataset facts (performance-intelligence),
//    • the stored HR month summary (employee-performance),
//    • the window stats built by ./signals (canonical helpers),
//    • computeRisk() — the CANONICAL risk engine (weights/bands).
//
//  THRESHOLD HONESTY:
//    • KPI below-target judgments use kpiSettings.defaultScore —
//      the configured baseline the kpi-dashboard already reuses.
//    • Severity gradation of negative factors uses the canonical
//      risk engine's BANDS (RISK_LEVEL_BANDS) — no new numbers.
//    • Signals WITHOUT a configured Qnalys threshold (attendance
//      compliance minimum, follow-up overdue/completion cutoffs)
//      are REPORTED (severity LOW, basis CONFIGURATION_REQUIRED)
//      and never escalate a status by themselves.
//
//  STATUS ENGINE (matched rule is deterministic + test-pinned):
//    1. No negative factor at all → IMPROVING if a positive KPI
//       direction exists, else STABLE.
//    2. MANAGEMENT_REVIEW  — canonical risk level 'critical'.
//    3. PERFORMANCE_IMPROVEMENT_REVIEW — ≥2 distinct weak
//       dimensions (repeated weakness), OR ≥3 consecutive
//       below-target KPI months, OR ≥3 consecutive declining KPI
//       steps, OR risk level 'high'.
//    4. NEEDS_COACHING — exactly ONE weak dimension (isolated
//       weakness never escalates beyond coaching).
//    5. otherwise → STABLE (or IMPROVING with a positive trend).
//
//  A single MEDIUM signal in one dimension (one weak month, one
//  moderate concern) therefore can never produce a severe status —
//  escalation requires REPEATED or MULTI-DIMENSION evidence.
// ══════════════════════════════════════════════════════════════

import type {
  HrDecisionFactor,
  HrDecisionSeverity,
  HrRecommendedAction,
  HrStatusEvaluation,
} from './types';
import { HR_ACTION_DISCLAIMER_AR } from './types';
import { RISK_LEVEL_BANDS } from '@/lib/metrics/riskMetrics';
import type { RiskLevel } from '@/lib/metrics/riskMetrics';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import type { EmployeeHrMonthSummary } from '@/lib/employee-performance';
import type { FollowUpWindowStats, KpiTrendCounters, CapaRiskStats } from './signals';
import { pctAr, daysAr, countAr, pointsAr } from './format';

// ─────────────────────────────────────────────────────────────
//  Severity from canonical risk points
// ─────────────────────────────────────────────────────────────

/**
 * Severity of a negative factor, derived from the canonical risk
 * weights the SAME factor feeds into computeRisk(): MEDIUM at/above
 * the canonical 'medium' band, HIGH at/above the 'high' band —
 * the existing agreed gradation, not a new one.
 */
function severityForRiskPoints(points: number): HrDecisionSeverity {
  if (points >= RISK_LEVEL_BANDS.high) return 'HIGH';
  if (points >= RISK_LEVEL_BANDS.medium) return 'MEDIUM';
  return 'LOW';
}

// ─────────────────────────────────────────────────────────────
//  KPI factor
// ─────────────────────────────────────────────────────────────

/** Rule ids (stable, test-pinned). */
export const HR_RULE_IDS = {
  KPI_BELOW_TARGET: 'KPI_BELOW_CONFIGURED_TARGET',
  KPI_ON_TARGET: 'KPI_AT_OR_ABOVE_CONFIGURED_TARGET',
  FOLLOW_UP_OVERDUE_RECURRENCE: 'FOLLOW_UP_OVERDUE_RECURRENCE',
  FOLLOW_UP_OPEN_CRITICAL: 'FOLLOW_UP_OPEN_CRITICAL_PRIORITY',
  FOLLOW_UP_NO_OVERDUE: 'FOLLOW_UP_NO_OVERDUE_SIGNAL',
  QUALITY_REPEATED_ISSUES: 'QUALITY_REPEATED_ISSUE_RECURRENCE',
  QUALITY_DEDUCTIONS: 'QUALITY_DEDUCTION_SIGNAL',
  QUALITY_CLEAN: 'QUALITY_NO_SIGNALS',
  ATTENDANCE_REPORTED: 'ATTENDANCE_REPORTED_NO_CONFIGURED_THRESHOLD',
  ATTENDANCE_UNAVAILABLE: 'ATTENDANCE_DATA_UNAVAILABLE',
  HR_DEDUCTIONS: 'HR_DEDUCTION_SIGNAL',
  HR_CLEAN: 'HR_NO_SIGNALS',
  COMPLAINTS_OPEN: 'COMPLAINTS_OPEN_SIGNAL',
  CAPA_OPEN_OVERDUE: 'CAPA_OPEN_OR_OVERDUE_SIGNAL',
  PRODUCTIVITY_REPORTED: 'PRODUCTIVITY_REPORTED_NO_TARGET_CONFIGURED',
  PRODUCTIVITY_UNAVAILABLE: 'PRODUCTIVITY_NO_EMPLOYEE_LINKED_DATA',
  TREND_DECLINING: 'TREND_CONSECUTIVE_DECLINE',
  TREND_IMPROVING: 'TREND_CONSECUTIVE_IMPROVEMENT',
  STATUS_NO_NEGATIVE_FACTORS: 'STATUS_NO_NEGATIVE_FACTORS',
  STATUS_CRITICAL_RISK: 'STATUS_CRITICAL_RISK_LEVEL',
  STATUS_MULTI_DIMENSION_WEAKNESS: 'STATUS_WEAKNESS_IN_MULTIPLE_DIMENSIONS',
  STATUS_REPEATED_KPI_BELOW_TARGET: 'STATUS_REPEATED_KPI_BELOW_TARGET',
  STATUS_SUSTAINED_DECLINE: 'STATUS_SUSTAINED_KPI_DECLINE',
  STATUS_HIGH_RISK: 'STATUS_HIGH_RISK_LEVEL',
  STATUS_SINGLE_DIMENSION_WEAKNESS: 'STATUS_SINGLE_DIMENSION_WEAKNESS',
} as const;

function factor(args: Omit<HrDecisionFactor, 'kind'> & { kind?: HrDecisionFactor['kind'] }): HrDecisionFactor {
  return { kind: 'NEGATIVE', ...args };
}

function positiveFactor(args: Omit<HrDecisionFactor, 'kind'>): HrDecisionFactor {
  return { kind: 'POSITIVE', ...args };
}

// ─────────────────────────────────────────────────────────────
//  Factor builders (one per dimension)
// ─────────────────────────────────────────────────────────────

/** Context shared by every builder. */
export interface HrFactorContext {
  dataset: EmployeePerformanceDataset;
  hrMonth: EmployeeHrMonthSummary | null;
  followUps: FollowUpWindowStats;
  capaStats: CapaRiskStats;
  kpi: KpiTrendCounters;
  targetScore: number;
}

/** KPI factor — judged against the CONFIGURED baseline only. */
export function buildKpiFactors(ctx: HrFactorContext): HrDecisionFactor[] {
  const { kpi, targetScore } = ctx;
  if (kpi.currentScore === null) return [];
  if (kpi.belowTarget) {
    const delta = targetScore - kpi.currentScore;
    return [factor({
      category: 'KPI',
      // Below the CONFIGURED target is always at least MEDIUM (a real
      // signal); the canonical medium band is the floor of the gradation.
      severity: kpi.consecutiveBelowTarget >= 3 ? 'HIGH'
        : severityForRiskPoints(Math.max(delta, RISK_LEVEL_BANDS.medium)),
      signalAr: `نتيجة الأداء ${pctAr(kpi.currentScore)} أقل من الهدف المُهيّأ (${pctAr(targetScore)})`,
      value: kpi.currentScore,
      unit: 'points',
      comparisonAr: `الهدف المُهيّأ في إعدادات المؤشرات ${pctAr(targetScore)} — الفارق ${pointsAr(delta)} نقطة`,
      thresholdBasis: 'CONFIGURED',
      thresholdValue: targetScore,
      ruleId: HR_RULE_IDS.KPI_BELOW_TARGET,
    })];
  }
  return [positiveFactor({
    category: 'KPI',
    severity: 'LOW',
    signalAr: `نتيجة الأداء ${pctAr(kpi.currentScore)} عند الهدف المُهيّأ أو أعلى منه`,
    value: kpi.currentScore,
    unit: 'points',
    comparisonAr: `الهدف المُهيّأ في إعدادات المؤشرات ${pctAr(targetScore)}`,
    thresholdBasis: 'CONFIGURED',
    thresholdValue: targetScore,
    ruleId: HR_RULE_IDS.KPI_ON_TARGET,
  })];
}

/** Follow-up factors — overdue recurrence judged by the canonical repetition rule; open counts reported. */
export function buildFollowUpFactors(ctx: HrFactorContext): HrDecisionFactor[] {
  const { dataset, followUps } = ctx;
  const f = dataset.followUps;
  const out: HrDecisionFactor[] = [];

  if (f.total > 0 || followUps.activeTotal > 0) {
    if (followUps.overdueMonths.length >= 1) {
      // Single overdue month = an isolated occurrence (LOW — recorded,
      // never escalates); recurrence across months escalates (the
      // canonical repetition rule starts at 2 occurrences).
      const months = followUps.overdueMonths.length;
      out.push(factor({
        category: 'FOLLOW_UP',
        severity: months >= 4 ? 'HIGH' : months >= 2 ? 'MEDIUM' : 'LOW',
        signalAr: `وجود متابعات متأخرة في ${countAr(months)} شهر من نافذة التحليل`,
        value: followUps.overdueMonths.length,
        unit: 'months',
        comparisonAr: `قاعدة التكرار القانونية: ${f.overdue} متابعة متأخرة حالياً بإجمالي تأخير ${f.avgOverdueDays === null ? '—' : daysAr(f.avgOverdueDays)}`,
        thresholdBasis: 'CANONICAL_RISK',
        thresholdValue: null,
        ruleId: HR_RULE_IDS.FOLLOW_UP_OVERDUE_RECURRENCE,
      }));
    }
    if (followUps.activeByPriority.critical > 0) {
      const pts = Math.min(
        followUps.activeByPriority.critical * 10,
        30,
      );
      out.push(factor({
        category: 'FOLLOW_UP',
        severity: severityForRiskPoints(pts),
        signalAr: `${countAr(followUps.activeByPriority.critical)} متابعة مفتوحة بأولوية حرجة`,
        value: followUps.activeByPriority.critical,
        unit: 'count',
        comparisonAr: 'وزن المخاطر القانوني للمتابعات الحرجة (10 نقاط، حد 30)',
        thresholdBasis: 'CANONICAL_RISK',
        thresholdValue: null,
        ruleId: HR_RULE_IDS.FOLLOW_UP_OPEN_CRITICAL,
      }));
    }
    if (out.length === 0 && f.total > 0) {
      out.push(positiveFactor({
        category: 'FOLLOW_UP',
        severity: 'LOW',
        signalAr: `معدل إنجاز المتابعات ${f.completionRate === null ? '—' : pctAr(f.completionRate)} بلا متابعات متأخرة حالياً`,
        value: f.completionRate,
        unit: 'percent',
        comparisonAr: null,
        thresholdBasis: 'NONE_REQUIRED',
        thresholdValue: null,
        ruleId: HR_RULE_IDS.FOLLOW_UP_NO_OVERDUE,
      }));
    }
  }

  // REPORTED-ONLY signal: Qnalys configures NO overdue-rate cutoff —
  // never judged, never escalates a status.
  if (f.total > 0 && f.overdue > 0 && out.length === 0) {
    out.push(factor({
      category: 'FOLLOW_UP',
      severity: 'LOW',
      signalAr: `${countAr(f.overdue)} متابعة متأخرة حالياً (قيمة مقاسة — لا يوجد حد مُهيّأ للمقارنة)`,
      value: f.overdue,
      unit: 'count',
      comparisonAr: 'لا يوجد حد مُهيّأ لنسبة التأخير في إعدادات Qnals',
      thresholdBasis: 'CONFIGURATION_REQUIRED',
      thresholdValue: null,
      ruleId: HR_RULE_IDS.FOLLOW_UP_NO_OVERDUE,
    }));
  }
  return out;
}

/** Quality factors — HR-safe aggregates (counts/recurrence only, never observation text). */
export function buildQualityFactors(ctx: HrFactorContext): HrDecisionFactor[] {
  const { dataset } = ctx;
  const out: HrDecisionFactor[] = [];
  const windowRepeat = dataset.quality.repeatedIssues.windowByCategory;
  const repeatedKeys = new Set(windowRepeat.map((g) => g.issueKey));
  const periodRepeat = dataset.quality.repeatedIssues.byCategory.filter((g) => repeatedKeys.has(g.issueKey));
  const totalRecurrence = periodRepeat.reduce((sum, g) => sum + g.occurrenceCount, 0);

  if (totalRecurrence > 0) {
    const points = Math.min(totalRecurrence * 5, 25);
    out.push(factor({
      category: 'QUALITY',
      severity: severityForRiskPoints(points),
      signalAr: `تكرار نفس مفتاح الجودة عبر الشهور (${countAr(totalRecurrence)} تكراراً في ${countAr(periodRepeat.length)} نمط)`,
      value: totalRecurrence,
      unit: 'count',
      comparisonAr: 'وزن المخاطر القانوني للإشارة المتكررة (5 نقاط لكل تكرار، حد 25)',
      thresholdBasis: 'CANONICAL_RISK',
      thresholdValue: null,
      ruleId: HR_RULE_IDS.QUALITY_REPEATED_ISSUES,
    }));
  } else if (dataset.quality.deductions.count > 0) {
    const points = Math.min(dataset.quality.deductions.count * 5, 25);
    out.push(factor({
      category: 'QUALITY',
      severity: severityForRiskPoints(points),
      signalAr: `${countAr(dataset.quality.deductions.count)} خصم جودة مؤثر في الفترة (${daysAr(dataset.quality.deductions.totalDays)})`,
      value: dataset.quality.deductions.count,
      unit: 'count',
      comparisonAr: 'وزن المخاطر القانوني لخصومات الجودة (5 نقاط لكل سجل، حد 25)',
      thresholdBasis: 'CANONICAL_RISK',
      thresholdValue: null,
      ruleId: HR_RULE_IDS.QUALITY_DEDUCTIONS,
    }));
  } else if (dataset.quality.observations.total > 0 || dataset.quality.deductions.count === 0) {
    out.push(positiveFactor({
      category: 'QUALITY',
      severity: 'LOW',
      signalAr: 'لا توجد إشارات جودة سلبية في الفترة',
      value: 0,
      unit: 'count',
      comparisonAr: null,
      thresholdBasis: 'NONE_REQUIRED',
      thresholdValue: null,
      ruleId: HR_RULE_IDS.QUALITY_CLEAN,
    }));
  }
  return out;
}

/**
 * Attendance factors — REPORTED ONLY. Qnalys configures no minimum
 * compliance; the measured values never judge (and never escalate)
 * the status. Missing data is an explicit note, never a penalty.
 */
export function buildAttendanceFactors(ctx: HrFactorContext): HrDecisionFactor[] {
  const a = ctx.dataset.attendance;
  if (a.status !== 'AVAILABLE' || !a.result) {
    return [factor({
      category: 'ATTENDANCE',
      severity: 'LOW',
      signalAr: 'بيانات الحضور غير متاحة لهذه الفترة (لا توجد نتيجة شهرية مخزّنة)',
      value: null,
      unit: 'percent',
      comparisonAr: 'غياب البيانات لا يُفسَّر كأداء ضعيف',
      thresholdBasis: 'CONFIGURATION_REQUIRED',
      thresholdValue: null,
      ruleId: HR_RULE_IDS.ATTENDANCE_UNAVAILABLE,
    })];
  }
  return [factor({
    category: 'ATTENDANCE',
    severity: 'LOW',
    signalAr: `نسبة الالتزام بالحضور ${pctAr(a.result.compliance)} — تأخير ${countAr(a.result.lateDays)} يوم، غياب ${countAr(a.result.absentDays)} يوم`,
    value: a.result.compliance,
    unit: 'percent',
    comparisonAr: 'قيمة مقاسة فقط — لا يوجد حد أدنى مُهيّأ للالتزام في إعدادات Qnals',
    thresholdBasis: 'CONFIGURATION_REQUIRED',
    thresholdValue: null,
    ruleId: HR_RULE_IDS.ATTENDANCE_REPORTED,
  })];
}

/** HR-disciplinary factors — high-level counts from the stored HR deduction summary. */
export function buildHrDisciplinaryFactors(ctx: HrFactorContext): HrDecisionFactor[] {
  const { hrMonth } = ctx;
  if (hrMonth === null || hrMonth.deductionCount === 0) {
    return [];
  }
  const points = Math.min(hrMonth.deductionCount * 5, 15);
  return [factor({
    category: 'HR_DISCIPLINARY',
    severity: severityForRiskPoints(points),
    signalAr: `${countAr(hrMonth.deductionCount)} خصم موارد بشرية في الفترة (${daysAr(hrMonth.deductionDays)})`,
    value: hrMonth.deductionCount,
    unit: 'count',
    comparisonAr: 'وزن المخاطر القانوني لخصومات الموارد البشرية (5 نقاط لكل سجل، حد 15)',
    thresholdBasis: 'CANONICAL_RISK',
    thresholdValue: null,
    ruleId: HR_RULE_IDS.HR_DEDUCTIONS,
  })];
}

/** Complaint/CAPA factors — counts only (no reasons, no customer detail). */
export function buildComplaintCapaFactors(ctx: HrFactorContext): HrDecisionFactor[] {
  const { dataset, capaStats } = ctx;
  const out: HrDecisionFactor[] = [];
  if (dataset.complaints.stillOpen > 0) {
    const points = Math.min(dataset.complaints.stillOpen * 8, 20);
    out.push(factor({
      category: 'QUALITY',
      severity: severityForRiskPoints(points),
      signalAr: `${countAr(dataset.complaints.stillOpen)} شكوى مفتوحة مرتبطة بالموظف`,
      value: dataset.complaints.stillOpen,
      unit: 'count',
      comparisonAr: 'وزن المخاطر القانوني للشكاوى المفتوحة (8 نقاط لكل شكوى، حد 20)',
      thresholdBasis: 'CANONICAL_RISK',
      thresholdValue: null,
      ruleId: HR_RULE_IDS.COMPLAINTS_OPEN,
    }));
  }
  if (capaStats.openCapaCount > 0 || capaStats.overdueCapaCount > 0) {
    out.push(factor({
      category: 'QUALITY',
      severity: capaStats.overdueCapaCount > 0 ? 'MEDIUM' : 'LOW',
      signalAr: `${countAr(capaStats.openCapaCount)} إجراء CAPA مفتوح${capaStats.overdueCapaCount > 0 ? ` منها ${countAr(capaStats.overdueCapaCount)} متأخر` : ''}`,
      value: capaStats.openCapaCount,
      unit: 'count',
      comparisonAr: 'أوزان المخاطر القانونية لإجراءات CAPA (5/10 نقاط، حدود 25/30)',
      thresholdBasis: 'CANONICAL_RISK',
      thresholdValue: null,
      ruleId: HR_RULE_IDS.CAPA_OPEN_OVERDUE,
    }));
  }
  return out;
}

/**
 * Productivity factors — measured output only. Qnalys configures no
 * productivity target; values are reported, never judged.
 *
 * §DEAL-DATES — the productivity value is the CLOSED dimension
 * (closedAt): deals the employee successfully completed during the
 * period. Travel volume (departureDate) is a separate operational
 * fact and is reported as context, never as the productivity value.
 */
export function buildProductivityFactors(ctx: HrFactorContext): HrDecisionFactor[] {
  const { dataset } = ctx;
  const deals = dataset.deals;
  if (deals.travelTotal === 0 && deals.closedTotal === 0 && deals.closedUnknownMonth === 0) {
    return [factor({
      category: 'PRODUCTIVITY',
      severity: 'LOW',
      signalAr: 'لا توجد بيانات إنتاجية مرتبطة بالموظف لهذه الفترة',
      value: null,
      unit: 'count',
      comparisonAr: 'غياب البيانات لا يُفسَّر كأداء ضعيف',
      thresholdBasis: 'CONFIGURATION_REQUIRED',
      thresholdValue: null,
      ruleId: HR_RULE_IDS.PRODUCTIVITY_UNAVAILABLE,
    })];
  }
  const unknownClosureNote = deals.closedUnknownMonth > 0
    ? ` — ومنها صفقات مكتملة بتاريخ إغلاق غير محدد: ${countAr(deals.closedUnknownMonth)} (لا تُنسب لأي شهر)`
    : '';
  return [factor({
    category: 'PRODUCTIVITY',
    severity: 'LOW',
    signalAr: `أُغلقت ${countAr(deals.closedTotal)} صفقة بنجاح في الفترة (بتاريخ الإغلاق)` +
      ` — حجم السفر ${countAr(deals.travelTotal)} صفقة (بتاريخ المغادرة)، ملغاة ${countAr(deals.canceled)}` +
      unknownClosureNote,
    value: deals.closedTotal,
    unit: 'count',
    comparisonAr: 'قيمة مقاسة فقط — لا يوجد هدف إنتاجية مُهيّأ في إعدادات Qnals',
    thresholdBasis: 'CONFIGURATION_REQUIRED',
    thresholdValue: null,
    ruleId: HR_RULE_IDS.PRODUCTIVITY_REPORTED,
  })];
}

/** Trend factors — deterministic direction facts (no threshold needed). */
export function buildTrendFactors(ctx: HrFactorContext): HrDecisionFactor[] {
  const { kpi } = ctx;
  const out: HrDecisionFactor[] = [];
  if (kpi.consecutiveDecliningSteps >= 2) {
    out.push(factor({
      category: 'TREND',
      severity: kpi.consecutiveDecliningSteps >= 3 ? 'HIGH' : 'MEDIUM',
      signalAr: `اتجاه تنازلي متصل عبر ${countAr(kpi.consecutiveDecliningSteps)} خطوات شهرية متتالية`,
      value: kpi.consecutiveDecliningSteps,
      unit: 'months',
      comparisonAr: `الفارق الشهري الحالي ${kpi.momDeltaPoints === null ? '—' : pointsAr(kpi.momDeltaPoints)}`,
      thresholdBasis: 'NONE_REQUIRED',
      thresholdValue: null,
      ruleId: HR_RULE_IDS.TREND_DECLINING,
    }));
  }
  if (kpi.consecutiveDecliningSteps === 0 && kpi.direction === 'UP' && kpi.momDeltaPoints !== null && kpi.momDeltaPoints > 0) {
    out.push(positiveFactor({
      category: 'TREND',
      severity: 'LOW',
      signalAr: `اتجاه تحسّن — الفارق الشهري ${pointsAr(kpi.momDeltaPoints)} نقطة`,
      value: kpi.momDeltaPoints,
      unit: 'points',
      comparisonAr: null,
      thresholdBasis: 'NONE_REQUIRED',
      thresholdValue: null,
      ruleId: HR_RULE_IDS.TREND_IMPROVING,
    }));
  }
  return out;
}

/** All negative/positive factors, deterministic order (dimension then severity). */
export function buildAllFactors(ctx: HrFactorContext): HrDecisionFactor[] {
  const all = [
    ...buildKpiFactors(ctx),
    ...buildFollowUpFactors(ctx),
    ...buildQualityFactors(ctx),
    ...buildAttendanceFactors(ctx),
    ...buildHrDisciplinaryFactors(ctx),
    ...buildComplaintCapaFactors(ctx),
    ...buildProductivityFactors(ctx),
    ...buildTrendFactors(ctx),
  ];
  const severityOrder: Record<HrDecisionSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return all.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      a.category.localeCompare(b.category) ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

// ─────────────────────────────────────────────────────────────
//  Status evaluation — deterministic matched-rule engine
// ─────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  KPI: 'مؤشر الأداء',
  FOLLOW_UP: 'المتابعات اليومية',
  QUALITY: 'إشارة الجودة',
  ATTENDANCE: 'الانضباط والحضور',
  HR_DISCIPLINARY: 'إشارة الموارد البشرية',
  PRODUCTIVITY: 'الإنتاجية',
  TREND: 'الاتجاه الزمني',
};

/**
 * Dimensions that carry JUDGED negative factors. Reported-only
 * factors (ATTENDANCE / PRODUCTIVITY / unavailable states) are
 * excluded — they can never weaken a status.
 */
const JUDGED_CATEGORIES: ReadonlySet<string> = new Set([
  'KPI', 'FOLLOW_UP', 'QUALITY', 'HR_DISCIPLINARY', 'TREND',
]);

export interface EvaluateHrStatusInput {
  factors: HrDecisionFactor[];
  kpi: KpiTrendCounters;
  /** Canonical risk engine output (computeRisk — existing weights/bands). */
  riskScore: number;
  riskLevel: RiskLevel;
}

/**
 * Deterministic status evaluation. Escalation requires REPEATED or
 * MULTI-DIMENSION evidence; reported-only dimensions never count;
 * a single weak dimension can never exceed NEEDS_COACHING.
 */
export function evaluateHrStatus(input: EvaluateHrStatusInput): HrStatusEvaluation {
  const { factors, kpi, riskScore, riskLevel } = input;
  // A LOW negative is RECORDED as a concern but never escalates —
  // only MEDIUM/HIGH (judged) signals weaken a status. TREND is the
  // KPI dimension's DIRECTION, not a separate dimension: it never
  // counts toward multi-dimension weakness (the sustained-decline
  // ladder below handles it directly).
  const judgedNegatives = factors.filter(
    (f) => f.kind === 'NEGATIVE' && JUDGED_CATEGORIES.has(f.category) && f.severity !== 'LOW',
  );
  const weakCategories = new Set(
    judgedNegatives.filter((f) => f.category !== 'TREND').map((f) => f.category),
  );
  const hasTrendNegative = judgedNegatives.some((f) => f.category === 'TREND');
  const weakDimensionCount = weakCategories.size;
  const isolatedWeaknessOnly = weakDimensionCount <= 1;

  const base: Omit<HrStatusEvaluation,
    'status' | 'matchedRuleId' | 'matchedRuleAr' | 'isolatedWeaknessOnly'> = {
    factors,
    riskScore,
    riskLevel,
    consecutiveKpiBelowTarget: kpi.consecutiveBelowTarget,
    consecutiveKpiDecliningSteps: kpi.consecutiveDecliningSteps,
    weakDimensionCount,
  };

  // 1 — no judged negative factors at all (LOW concerns may exist but
  //     never escalate; they stay recorded in the factor list).
  if (judgedNegatives.length === 0) {
    const improving = kpi.direction === 'UP' || (kpi.momDeltaPoints ?? 0) > 0;
    return {
      ...base,
      status: improving ? 'IMPROVING' : 'STABLE',
      matchedRuleId: HR_RULE_IDS.STATUS_NO_NEGATIVE_FACTORS,
      matchedRuleAr: improving
        ? 'لا توجد إشارات سلبية قابلة للحكم، مع اتجاه تحسّن في نتيجة الأداء'
        : 'لا توجد إشارات سلبية قابلة للحكم في أي بُعد',
      isolatedWeaknessOnly: false,
    };
  }

  // 2 — canonical risk 'critical' (existing bands: ≥51).
  if (riskLevel === 'critical') {
    return {
      ...base,
      status: 'MANAGEMENT_REVIEW',
      matchedRuleId: HR_RULE_IDS.STATUS_CRITICAL_RISK,
      matchedRuleAr: 'مستوى المخاطر القانوني «حرج» (النطاق المُعتمد ≥ 51 نقطة) — مراجعة إدارة وموارد بشرية',
      isolatedWeaknessOnly,
    };
  }

  // 3 — repeated / multi-dimension evidence (TREND excluded — the
  //     sustained-decline ladder below owns it).
  if (weakDimensionCount >= 2) {
    const dims = [...weakCategories].map((c) => CATEGORY_LABELS[c] ?? c).join('، ');
    return {
      ...base,
      status: 'PERFORMANCE_IMPROVEMENT_REVIEW',
      matchedRuleId: HR_RULE_IDS.STATUS_MULTI_DIMENSION_WEAKNESS,
      matchedRuleAr: `إشارات سلبية قابلة للحكم في أكثر من بُعد (${dims}) — ضعف متعدد الأبعاد لا ضعف معزول`,
      isolatedWeaknessOnly,
    };
  }
  if (kpi.consecutiveBelowTarget >= 3) {
    return {
      ...base,
      status: 'PERFORMANCE_IMPROVEMENT_REVIEW',
      matchedRuleId: HR_RULE_IDS.STATUS_REPEATED_KPI_BELOW_TARGET,
      matchedRuleAr: `نتيجة الأداء أقل من الهدف المُهيّأ في ${countAr(kpi.consecutiveBelowTarget)} أشهر متتالية — ضعف متكرر لا شهر معزول`,
      isolatedWeaknessOnly,
    };
  }
  if (kpi.consecutiveDecliningSteps >= 3) {
    return {
      ...base,
      status: 'PERFORMANCE_IMPROVEMENT_REVIEW',
      matchedRuleId: HR_RULE_IDS.STATUS_SUSTAINED_DECLINE,
      matchedRuleAr: `اتجاه تنازلي متصل عبر ${countAr(kpi.consecutiveDecliningSteps)} خطوات شهرية متتالية`,
      isolatedWeaknessOnly,
    };
  }
  if (riskLevel === 'high') {
    return {
      ...base,
      status: 'PERFORMANCE_IMPROVEMENT_REVIEW',
      matchedRuleId: HR_RULE_IDS.STATUS_HIGH_RISK,
      matchedRuleAr: 'مستوى المخاطر القانوني «مرتفع» (النطاق المُعتمد ≥ 26 نقطة)',
      isolatedWeaknessOnly,
    };
  }

  // 4 — at most coaching: exactly one weak dimension, or a repeated
  //     (2-step) declining trend.
  if (weakDimensionCount === 1) {
    const dim = CATEGORY_LABELS[[...weakCategories][0] ?? ''] ?? '';
    return {
      ...base,
      status: 'NEEDS_COACHING',
      matchedRuleId: HR_RULE_IDS.STATUS_SINGLE_DIMENSION_WEAKNESS,
      matchedRuleAr: `إشارة سلبية قابلة للحكم في بُعد واحد (${dim}) — ضعف معزول لا يستدعي تصعيداً`,
      isolatedWeaknessOnly,
    };
  }
  if (hasTrendNegative) {
    return {
      ...base,
      status: 'NEEDS_COACHING',
      matchedRuleId: HR_RULE_IDS.TREND_DECLINING,
      matchedRuleAr: 'اتجاه تنازلي متكرر (خطوتان متتاليتان) مع نتيجة عند الهدف — تدريب وقائي',
      isolatedWeaknessOnly,
    };
  }

  // 5 — only reported-only signals exist.
  const improving = kpi.direction === 'UP' || (kpi.momDeltaPoints ?? 0) > 0;
  return {
    ...base,
    status: improving ? 'IMPROVING' : 'STABLE',
    matchedRuleId: HR_RULE_IDS.STATUS_NO_NEGATIVE_FACTORS,
    matchedRuleAr: improving
      ? 'الإشارات المقاسة بلا حدود مُهيّأة، مع اتجاه تحسّن في نتيجة الأداء'
      : 'الإشارات المقاسة بلا حدود مُهيّأة — لا توجد إشارات سلبية قابلة للحكم',
    isolatedWeaknessOnly,
  };
}

// ─────────────────────────────────────────────────────────────
//  Recommended action (review wording — never an employment decision)
// ─────────────────────────────────────────────────────────────

export interface HrActionSuggestion {
  status: HrStatusEvaluation['status'];
}

export function buildRecommendedAction(evaluation: HrStatusEvaluation): HrRecommendedAction {
  const reason = evaluation.matchedRuleAr;
  switch (evaluation.status) {
    case 'STABLE':
      return {
        status: 'STABLE',
        actionKind: 'CONTINUE_MONITORING',
        actionAr: 'متابعة دورية اعتيادية',
        rationaleAr: reason,
        disclaimerAr: HR_ACTION_DISCLAIMER_AR,
      };
    case 'IMPROVING':
      return {
        status: 'IMPROVING',
        actionKind: 'RECOGNIZE_IMPROVEMENT',
        actionAr: 'متابعة دورية مع تشجيع التحسّن المُلاحظ',
        rationaleAr: reason,
        disclaimerAr: HR_ACTION_DISCLAIMER_AR,
      };
    case 'NEEDS_COACHING':
      return {
        status: 'NEEDS_COACHING',
        actionKind: 'COACHING',
        actionAr: 'توجيه/تدريب موجّه على البُعد الضعيف',
        rationaleAr: reason,
        disclaimerAr: HR_ACTION_DISCLAIMER_AR,
      };
    case 'PERFORMANCE_IMPROVEMENT_REVIEW':
      return {
        status: 'PERFORMANCE_IMPROVEMENT_REVIEW',
        actionKind: 'IMPROVEMENT_PLAN',
        actionAr: 'مراجعة أداء رسمية وربما خطة تحسين أداء موثّقة',
        rationaleAr: reason,
        disclaimerAr: HR_ACTION_DISCLAIMER_AR,
      };
    case 'MANAGEMENT_REVIEW':
      return {
        status: 'MANAGEMENT_REVIEW',
        actionKind: 'MANAGEMENT_HR_REVIEW',
        actionAr: 'مراجعة مشتركة من الإدارة والموارد البشرية',
        rationaleAr: reason,
        disclaimerAr: HR_ACTION_DISCLAIMER_AR,
      };
  }
}
