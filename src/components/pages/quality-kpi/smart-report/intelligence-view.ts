// ══════════════════════════════════════════════════════════════
//  Smart Quality Report — Intelligence View Layer (§QUALITY-INTELLIGENCE)
//
//  Pure localization of the deterministic intelligence facts
//  (lib/quality-intelligence/report.ts) into display-ready, RTL/AR-EN
//  view models. EVERY sentence is rendered from a typed fact's slots —
//  a number can only enter a sentence through its typed slot, so no
//  narrative can contain a value that is absent from the canonical
//  data. Missing values render the explicit unavailable state.
//
//  Same rules as view-model.ts: NO new calculations, dataset types
//  imported TYPE-ONLY, client-safe, unit-testable under node:test.
// ══════════════════════════════════════════════════════════════

import type { Locale } from '@/lib/i18n/dictionary';
import type {
  AttentionItemFact,
  DataQualityIntel,
  ExecutiveSummaryFacts,
  KpiIntel,
  NarrativeFact,
  PatternFact,
  QualityIntelligence,
  QualityIntelligenceInput,
  SignalFact,
  SourceAvailability,
  WhatChangedFact,
  WhatChangedMetric,
} from '@/lib/quality-intelligence/report';
import { buildQualityIntelligence } from '@/lib/quality-intelligence/report';
import type { HrEmployeeDecisionReport } from '@/lib/hr-decision/types';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import { formatPercent, formatSignedPoints, uiLabelSafe } from './view-model-helpers';
import { previousMonthKey, unavailableLabel } from './view-model';
import { presentStatus, presentRule, presentEntity } from '@/lib/i18n/presentation';
import { translateUIText } from '@/lib/i18n/ui-text';

// ─────────────────────────────────────────────────────────────
//  The API payload (dataset + §QUALITY-INTELLIGENCE extensions)
// ─────────────────────────────────────────────────────────────

/** The /api/performance-intelligence response for the report. */
export interface ReportPayload extends EmployeePerformanceDataset {
  /** Canonical risk-engine projection (section-gated server-side). */
  decision?: HrEmployeeDecisionReport | null;
  /** HR-deductions month block (null unless the section is granted). */
  hrDeductions?: {
    month: string;
    count: number;
    deductionDays: number;
    deductionAmount: number;
    statusCounts: Record<string, number>;
  } | null;
}

// ─────────────────────────────────────────────────────────────
//  Localized sentence rendering (typed slots only)
// ─────────────────────────────────────────────────────────────

const RISK_LEVEL_LABELS: Record<string, [string, string]> = {
  low: ['منخفض', 'Low'],
  medium: ['متوسط', 'Medium'],
  high: ['عالٍ', 'High'],
  critical: ['حرج', 'Critical'],
};

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/**
 * §9 BIDI-ISOLATION — a business-data slot (a category name, a team
 * name) embedded in a localized sentence is wrapped in Unicode FSI/PDI
 * isolates so the surrounding sentence keeps its own visual order in
 * BOTH directions. Without isolation an Arabic name inside an English
 * sentence visually scrambles the segments around the neutral
 * punctuation (— « »). Isolates are inert for pure-ASCII values.
 */
function isolateValue(value: string): string {
  return ARABIC_SCRIPT.test(value) ? `\u2068${value}\u2069` : value;
}

/** Substitute {slot} placeholders with pre-formatted (bidi-isolated) strings. */
function interpolate(template: string, slots: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = slots[key];
    return value === undefined ? `{${key}}` : isolateValue(value);
  });
}

function pct(value: number | null | undefined, locale: Locale): string {
  return formatPercent(value, locale);
}

// ─────────────────────────────────────────────────────────────
//  Views
// ─────────────────────────────────────────────────────────────

export interface ExecutiveSummaryView {
  scoreState: ExecutiveSummaryFacts['scoreState'];
  /** The big number — overall KPI total when the calculation is COMPLETE. */
  scoreDisplay: string;
  hasScore: boolean;
  /**
   * §KPI-INCOMPLETE — partial calculated points ("11.7 / 15") shown ONLY
   * when the overall KPI is INCOMPLETE. Never labeled as a percentage —
   * a partial point total must not read as the employee's final KPI.
   */
  calculatedPointsDisplay: string | null;
  /** §KPI-INCOMPLETE — human evaluation-status label for the score state. */
  evaluationStatusLabel: string | null;
  qualityScoreDisplay: string;
  deltaDisplay: string | null;
  deltaPositive: boolean | null;
  trendLabel: string | null;
  riskLabel: string | null;
  riskScoreDisplay: string | null;
  decisionStatusLabel: string | null;
  /** §3 EXECUTIVE HEADER — explicit-semantics deal metrics. */
  closedDuringPeriodDisplay: string;
  currentDealsDisplay: string;
  missingComponents: string[];
  availableWeightDisplay: string | null;
  incompleteMessage: string | null;
  periodLabel: string;
  valueBasisLabel: string;
}

const TREND_DIR_LABELS: Record<string, [string, string]> = {
  UP: ['▲ تحسّن', '▲ Improving'],
  DOWN: ['▼ تراجع', '▼ Declining'],
  STABLE: ['─ مستقر', '─ Stable'],
};

const DECISION_STATUS_LABELS: Record<string, [string, string]> = {
  STABLE: ['مستقر', 'Stable'],
  IMPROVING: ['يتحسن', 'Improving'],
  NEEDS_COACHING: ['يحتاج تدريبًا/متابعة', 'Needs coaching'],
  PERFORMANCE_IMPROVEMENT_REVIEW: ['مراجعة تحسين أداء', 'Performance improvement review'],
  MANAGEMENT_REVIEW: ['مراجعة إدارية', 'Management review'],
  UNKNOWN: ['غير محدد', 'Unknown'],
};

/** §KPI-INCOMPLETE — the score state as a human evaluation-status label. */
const EVALUATION_STATE_LABELS: Record<ExecutiveSummaryFacts['scoreState'], [string, string]> = {
  value: ['مكتمل', 'Complete'],
  incomplete: ['غير مكتمل', 'Incomplete'],
  pending: ['قيد الانتظار', 'Pending'],
  configuration_required: ['يتطلب إعدادًا', 'Configuration required'],
  not_eligible: ['غير مؤهل للفترة', 'Not eligible'],
};

export function buildExecutiveSummaryView(
  executive: ExecutiveSummaryFacts,
  locale: Locale,
): ExecutiveSummaryView {
  const hasScore = executive.scoreState === 'value' && executive.performanceScore !== null;
  // §7 — the missing-component NAMES are system vocabulary (the engine
  // slots carry the stored Arabic names); they resolve to localized
  // labels, never raw in an English report.
  const missingNames = executive.missingComponents.map((m) => m.name);
  const missingNamesLocalized = missingNames.map((n) => localizeComponentNameText(n, locale));
  let incompleteMessage: string | null = null;
  if (executive.scoreState === 'incomplete') {
    incompleteMessage = interpolate(
      locale === 'en'
        ? 'Overall KPI calculation is incomplete — missing components: {missing}'
        : 'الحساب الكامل لمؤشر KPI غير مكتمل — مكونات بلا قيمة: {missing}',
      { missing: missingNamesLocalized.join('، ') || '—' },
    );
  } else if (executive.scoreState === 'configuration_required') {
    incompleteMessage = locale === 'en'
      ? 'KPI scheme is not configured for this period'
      : 'مخطط KPI غير مهيأ لهذه الفترة';
  }

  // §KPI-INCOMPLETE — the partial total is POINTS within the Defined
  // Rate covered so far, never a percentage: "11.7 / 15" (X of the
  // defined rate available). Rendered only for the incomplete state.
  const calculatedPointsDisplay = executive.scoreState === 'incomplete'
    && executive.performanceScore !== null && executive.performanceScore !== undefined
    && executive.availableWeight !== null && executive.availableWeight !== undefined
    ? `${Math.round(executive.performanceScore * 100) / 100} / ${executive.availableWeight}`
    : null;

  return {
    scoreState: executive.scoreState,
    scoreDisplay: hasScore ? pct(executive.performanceScore, locale) : unavailableLabel(locale),
    hasScore,
    calculatedPointsDisplay,
    evaluationStatusLabel: uiLabelSafe(
      EVALUATION_STATE_LABELS as Record<string, [string, string]>,
      executive.scoreState,
      locale,
    ),
    qualityScoreDisplay: executive.qualityScore !== null ? pct(executive.qualityScore, locale) : unavailableLabel(locale),
    deltaDisplay: formatSignedPoints(executive.deltaPoints, locale),
    deltaPositive: executive.deltaPoints === null || executive.deltaPoints === undefined ? null : executive.deltaPoints > 0,
    trendLabel: executive.trendDirection ? uiLabelSafe(TREND_DIR_LABELS, executive.trendDirection, locale) : null,
    riskLabel: executive.riskLevel ? uiLabelSafe(RISK_LEVEL_LABELS, executive.riskLevel, locale) : null,
    riskScoreDisplay: executive.riskScore !== null && executive.riskScore !== undefined
      ? `${executive.riskScore}`
      : null,
    decisionStatusLabel: executive.decisionStatus
      // §PRESENTATION-BOUNDARY — unknown decision keys resolve to the
      // safe generic label; the raw key never reaches the report.
      ? uiLabelSafe(DECISION_STATUS_LABELS, executive.decisionStatus, locale) ?? presentStatus(executive.decisionStatus, locale)
      : null,
    missingComponents: missingNamesLocalized,
    availableWeightDisplay: executive.availableWeight !== null ? `${executive.availableWeight}` : null,
    incompleteMessage,
    closedDuringPeriodDisplay: `${executive.closedDuringPeriod}`,
    currentDealsDisplay: `${executive.currentDeals}`,
    periodLabel: executive.period,
    // §PRESENTATION-BOUNDARY — the value-basis key (MTD/LIVE/FINALIZED)
    // renders as its localized business label, never raw.
    valueBasisLabel: presentStatus(executive.valueBasis, locale),
  };
}

// ── KPI component table ──

export interface KpiComponentRow {
  name: string;
  /** The component's Defined Rate — its percent share of the overall evaluation. */
  definedRateDisplay: string;
  /** Achieved Rate — the component's own 0–100 quality percentage. */
  achievedRateDisplay: string;
  /** Calculated Points — the partial points earned within the Defined Rate. */
  calculatedPointsDisplay: string;
  hasValue: boolean;
  statusLabel: string;
}

export interface KpiIntelView {
  rows: KpiComponentRow[];
  missingNames: string[];
  configurationComplete: boolean;
  /** Total Calculated Rate — shown as the overall KPI ONLY when complete. */
  weightedTotalDisplay: string;
  /** The Defined Rate covered by the components that produced points. */
  availableWeightDisplay: string | null;
  schemeLabel: string | null;
  /** True when the engine verdict says the overall KPI is INCOMPLETE. */
  incomplete: boolean;
}

const COMPONENT_STATUS_LABELS: Record<string, [string, string]> = {
  AVAILABLE: ['متاح', 'Available'],
  PENDING: ['قيد الانتظار', 'Pending'],
  NOT_AVAILABLE: ['غير متاح', 'Not available'],
  NOT_ELIGIBLE: ['غير مؤهل للفترة', 'Not eligible'],
  FINALIZED: ['نهائي', 'Finalized'],
  ZERO: ['صفر مسجل', 'Recorded zero'],
  EXCLUDED: ['مستثنى', 'Excluded'],
  NO_CONFIG: ['يتطلب إعدادًا', 'Configuration required'],
  // Engine row/component verdicts — engine codes NEVER surface raw.
  INCOMPLETE: ['غير مكتمل', 'Incomplete'],
  NO_SCHEME: ['لا يوجد مخطط KPI', 'No KPI scheme'],
  AMBIGUOUS: ['مخططات متعددة — تتطلب حلًا', 'Multiple schemes — resolution required'],
  OVERRIDE_NOT_RESOLVABLE: ['تجاوز إعدادات غير قابل للحل', 'Override not resolvable'],
};

/**
 * §KPI-COMPONENT-NAMES — the SYSTEM-seeded KPI components carry stable
 * componentIds; their stored Arabic names are system vocabulary and
 * resolve to the localized label. Custom/renamed components keep the
 * stored name verbatim (user-entered business data is never translated).
 */
const SYSTEM_COMPONENT_NAME_LABELS: Record<string, [string, string]> = {
  quality: ['الجودة', 'Quality'],
  direct_manager: ['المدير المباشر', 'Direct Manager'],
  hr: ['الموارد البشرية', 'HR'],
  target: ['المستهدف', 'Target'],
};

function componentDisplayName(componentId: string, storedName: string, locale: Locale): string {
  const pair = SYSTEM_COMPONENT_NAME_LABELS[componentId];
  return pair ? (locale === 'en' ? pair[1] : pair[0]) : storedName;
}

/**
 * Localize a stored SYSTEM component name inside an interpolated
 * sentence (the engine's fact slots carry the joined stored names, not
 * ids). A stored name that matches a known system component's Arabic
 * name resolves to its localized label; custom/renamed components pass
 * through verbatim (user-entered data is never translated).
 */
function localizeComponentNameText(storedText: string, locale: Locale): string {
  if (locale !== 'en') return storedText;
  return storedText
    .split(', ')
    .map((part) => {
      const trimmed = part.trim();
      const match = Object.values(SYSTEM_COMPONENT_NAME_LABELS).find(([ar]) => ar === trimmed);
      return match ? match[1] : part;
    })
    .join(', ');
}

export function buildKpiIntelView(kpi: KpiIntel, locale: Locale): KpiIntelView {
  return {
    rows: kpi.components.map((c) => ({
      name: componentDisplayName(c.componentId, c.name, locale),
      definedRateDisplay: `${c.weight}%`,
      achievedRateDisplay: c.actual !== null ? pct(c.actual, locale) : unavailableLabel(locale),
      calculatedPointsDisplay: c.contribution !== null
        ? `${Math.round(c.contribution * 100) / 100} / ${c.maxContribution}`
        : unavailableLabel(locale),
      hasValue: c.hasValue,
      statusLabel: uiLabelSafe(COMPONENT_STATUS_LABELS, c.status, locale) ?? presentStatus(c.status, locale),
    })),
    missingNames: kpi.missingComponentNames,
    configurationComplete: kpi.configurationComplete,
    weightedTotalDisplay: kpi.weightedTotal !== null ? `${Math.round(kpi.weightedTotal * 100) / 100}` : unavailableLabel(locale),
    availableWeightDisplay: kpi.availableWeight !== null ? `${kpi.availableWeight}%` : null,
    schemeLabel: kpi.schemeLabel,
    incomplete: kpi.rowStatus === 'INCOMPLETE',
  };
}

// ── Quality intelligence ──

export interface ConcentrationRowView {
  categoryName: string;
  count: number;
  shareDisplay: string;
  shareValue: number | null;
}

export interface QualityIntelView {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  issueCategoryCount: number;
  concentration: ConcentrationRowView[];
  topIssueLine: string | null;
  highImpactCount: number;
  repeatedGroupCount: number;
  previousDeltaLine: string | null;
}

/** The analytical engine's unclassified grouping key. */
const UNCLASSIFIED_KEY = '_unclassified';

const UNCLASSIFIED_LABELS: [string, string] = ['غير مصنّف', 'Unclassified'];

/** §7 — the engine's grouping key is a SYSTEM label, localized per locale;
 *  admin-named categories are business data and pass through verbatim. */
function categoryDisplayName(categoryId: string | null, storedName: string, locale: Locale): string {
  if (categoryId === UNCLASSIFIED_KEY) {
    return locale === 'en' ? UNCLASSIFIED_LABELS[1] : UNCLASSIFIED_LABELS[0];
  }
  return storedName;
}

export function buildQualityIntelView(quality: QualityIntelligence['quality'], locale: Locale): QualityIntelView {
  let topIssueLine: string | null = null;
  if (quality.topIssue && quality.topIssue.share !== null) {
    topIssueLine = interpolate(
      locale === 'en'
        ? '{share} of the period\'s quality issues came from "{category}"'
        : '{share} من ملاحظات الجودة في هذه الفترة جاءت من «{category}»',
      {
        share: pct(quality.topIssue.share, locale),
        category: categoryDisplayName(quality.topIssue.categoryId, quality.topIssue.categoryName, locale),
      },
    );
  }

  let previousDeltaLine: string | null = null;
  if (quality.previousTotal !== null) {
    const diff = quality.total - quality.previousTotal;
    previousDeltaLine = interpolate(
      locale === 'en'
        ? '{diff} observations vs the previous month ({prev} → {current})'
        : '{diff} ملاحظة مقارنة بالشهر السابق ({prev} ← {current})',
      {
        diff: diff > 0 ? `+${diff}` : `${diff}`,
        prev: `${quality.previousTotal}`,
        current: `${quality.total}`,
      },
    );
  }

  return {
    total: quality.total,
    approved: quality.approved,
    rejected: quality.rejected,
    pending: quality.pending,
    issueCategoryCount: quality.issueCategoryCount,
    concentration: quality.concentration.map((c) => ({
      categoryName: categoryDisplayName(c.categoryId, c.categoryName, locale),
      count: c.count,
      shareDisplay: c.share !== null ? pct(c.share, locale) : unavailableLabel(locale),
      shareValue: c.share,
    })),
    topIssueLine,
    highImpactCount: quality.highImpactCount,
    repeatedGroupCount: quality.repeatedGroupCount,
    previousDeltaLine,
  };
}

// ── Patterns ──

export interface PatternView {
  code: PatternFact['code'];
  severity: PatternFact['severity'];
  text: string;
}

const PATTERN_TEMPLATES: Record<PatternFact['code'], Record<'ar' | 'en', string>> = {
  REPEATED_ISSUE: {
    ar: 'مشكلة متكررة: «{label}» — {count} مرات (الحد الأدنى {threshold})',
    en: 'Repeated issue: "{label}" — {count} occurrences (threshold {threshold})',
  },
  IMPROVING_TREND: {
    ar: 'اتجاه صاعد: تحسّن بمقدار {delta} نقطة مقارنة بالشهر السابق',
    en: 'Improving trend: up {delta} points vs the previous month',
  },
  DECLINING_TREND: {
    ar: 'اتجاه هابط: تراجع بمقدار {delta} نقطة مقارنة بالشهر السابق',
    en: 'Declining trend: down {delta} points vs the previous month',
  },
  STABLE_TREND: {
    ar: 'أداء مستقر مقارنة بالشهر السابق',
    en: 'Stable performance vs the previous month',
  },
  INSUFFICIENT_TREND_DATA: {
    ar: 'لا توجد بيانات كافية لحساب الاتجاه (لا مقارنة بشهر سابق)',
    en: 'Insufficient historical data for a trend (no comparable previous month)',
  },
  FOLLOW_UP_RISK: {
    ar: '{count} متابعة متأخرة مفتوحة',
    en: '{count} overdue follow-up(s) open',
  },
  COMPLAINT_RISK: {
    ar: '{count} شكوى مفتوحة',
    en: '{count} open complaint(s)',
  },
  CAPA_RISK: {
    ar: '{count} حالة CAPA متأخرة',
    en: '{count} overdue CAPA case(s)',
  },
  HIGH_SEVERITY_QUALITY: {
    ar: '{count} ملاحظة جودة عالية/حرجة الخطورة',
    en: '{count} high/critical-severity quality observation(s)',
  },
  KPI_CONFIGURATION_WARNING: {
    // The engine's raw row status (e.g. INCOMPLETE) is diagnostics —
    // the report shows the HUMAN fact: how many components lack values.
    ar: 'حساب KPI غير مكتمل — {missingCount} مكونات بلا قيمة',
    en: 'KPI calculation incomplete — {missingCount} component(s) without a value',
  },
  DATA_QUALITY_WARNING: {
    ar: '{unattributed} سجل غير منسوب لشهر · {notes} ملاحظة جودة بيانات',
    en: '{unattributed} unattributed record(s) · {notes} data note(s)',
  },
};

function formatPatternSlots(fact: PatternFact, locale: Locale): Record<string, string> {
  const slots: Record<string, string> = {};
  for (const [key, value] of Object.entries(fact.values)) {
    if (value === null || value === undefined) { slots[key] = '—'; continue; }
    if (typeof value === 'number') {
      // Trend deltas render as an ABSOLUTE magnitude — the pattern's
      // verb (تحسّن/تراجع) already carries the direction, so a signed
      // value would double it ("تراجع بمقدار -٦").
      slots[key] = key === 'delta' ? `${Math.abs(value)}` : `${Math.round(value * 100) / 100}`;
    } else {
      slots[key] = String(value);
    }
  }
  return slots;
}

export function buildPatternViews(patterns: PatternFact[], locale: Locale): PatternView[] {
  const lang = locale === 'en' ? 'en' : 'ar';
  return patterns.map((p) => ({
    code: p.code,
    severity: p.severity,
    text: interpolate(PATTERN_TEMPLATES[p.code][lang], formatPatternSlots(p, locale)),
  }));
}

// ── Management attention ──

export interface AttentionItemView {
  id: string;
  severity: AttentionItemFact['severity'];
  what: string;
  why: string | null;
  /** HUMAN-READABLE source label (localized). Rule IDs never render. */
  source: string;
  drillPage: string | null;
}

const ATTENTION_WHAT: Record<AttentionItemFact['code'], Record<'ar' | 'en', string>> = {
  ATT_KPI_INCOMPLETE: {
    ar: 'الحساب الكامل لمؤشر KPI غير مكتمل',
    en: 'Overall KPI calculation is incomplete',
  },
  ATT_OVERDUE_FOLLOWUPS: { ar: '{count} متابعات متأخرة', en: '{count} overdue follow-up(s)' },
  ATT_OVERDUE_CAPA: { ar: '{count} حالة CAPA متأخرة', en: '{count} overdue CAPA case(s)' },
  ATT_OPEN_COMPLAINTS: { ar: '{count} شكاوى مفتوحة', en: '{count} open complaint(s)' },
  ATT_REPEATED_ISSUES: { ar: '{groups} مجموعات مشكلات متكررة', en: '{groups} repeated-issue group(s)' },
  ATT_DECLINING_TREND: { ar: 'اتجاه هابط في مؤشر الأداء', en: 'Declining performance trend' },
  ATT_HIGH_SEVERITY: { ar: '{count} إشارات عالية الخطورة', en: '{count} high-severity signal(s)' },
  ATT_DATA_QUALITY: { ar: 'ملاحظات على جودة البيانات', en: 'Data-quality caveats' },
  // The engine's own Arabic signal sentence carries the fact in BOTH
  // locales — never the raw rule id (diagnostics-only).
  ATT_DECISION_FACTOR: { ar: '{signal}', en: '{signal}' },
};

const ATTENTION_WHY: Record<AttentionItemFact['code'], Record<'ar' | 'en', string>> = {
  ATT_KPI_INCOMPLETE: { ar: 'مكونات بلا قيمة: {missing}', en: 'Missing components: {missing}' },
  ATT_OVERDUE_FOLLOWUPS: { ar: 'متأخرة عن تاريخ المتابعة التالي · {dueToday} مستحقة اليوم', en: 'Past their next follow-up date · {dueToday} due today' },
  ATT_OVERDUE_CAPA: { ar: 'متوسط أيام التأخير: {avgOverdueDays}', en: 'Average overdue days: {avgOverdueDays}' },
  ATT_OPEN_COMPLAINTS: { ar: 'ضمن بيانات الفترة', en: 'Within the period data' },
  ATT_REPEATED_ISSUES: { ar: 'الأكثر تكرارًا: «{topLabel}» ({topCount} مرات)', en: 'Most frequent: "{topLabel}" ({topCount}x)' },
  ATT_DECLINING_TREND: { ar: 'تغير بمقدار {delta} نقطة مقارنة بالشهر السابق', en: 'Changed by {delta} points vs the previous month' },
  ATT_HIGH_SEVERITY: { ar: 'من ملاحظات الفترة', en: 'From the period observations' },
  ATT_DATA_QUALITY: { ar: '{unattributed} سجل غير منسوب · {notes} ملاحظات', en: '{unattributed} unattributed · {notes} note(s)' },
  // The engine's Arabic comparison sentence (قاعدة/حد المقارنة) in BOTH
  // locales — never `rule: <raw-rule-id>`.
  ATT_DECISION_FACTOR: { ar: '{comparison}', en: '{comparison}' },
};

/**
 * §12/§54 — HUMAN-READABLE source labels. The fact layer keeps the
 * technical rule id (traceability, tests, diagnostics); the view
 * renders only this localized domain label.
 */
const ATTENTION_SOURCE_LABELS: Record<AttentionItemFact['code'], [string, string]> = {
  ATT_KPI_INCOMPLETE: ['محرك KPI', 'KPI engine'],
  ATT_OVERDUE_FOLLOWUPS: ['سجل المتابعات', 'Follow-ups record'],
  ATT_OVERDUE_CAPA: ['سجل CAPA', 'CAPA record'],
  ATT_OPEN_COMPLAINTS: ['سجل الشكاوى', 'Complaints record'],
  ATT_REPEATED_ISSUES: ['ملاحظات الجودة', 'Quality observations'],
  ATT_DECLINING_TREND: ['محرك KPI', 'KPI engine'],
  ATT_HIGH_SEVERITY: ['ملاحظات الجودة', 'Quality observations'],
  ATT_DATA_QUALITY: ['جودة البيانات', 'Data quality'],
  ATT_DECISION_FACTOR: ['محرك المخاطر', 'Risk engine'],
};

const UNIT_LABELS: Record<string, [string, string]> = {
  percent: ['%', '%'],
  points: ['نقطة', 'pts'],
  days: ['يوم', 'days'],
  count: ['', ''],
  months: ['شهر', 'months'],
  minutes: ['دقيقة', 'min'],
};

export function buildAttentionViews(items: AttentionItemFact[], locale: Locale): AttentionItemView[] {
  const lang = locale === 'en' ? 'en' : 'ar';
  return items.map((item) => {
    const slots: Record<string, string> = {};
    for (const [key, value] of Object.entries(item.values)) {
      if (value === null || value === undefined) { slots[key] = '—'; continue; }
      if (typeof value === 'number') {
        slots[key] = key === 'delta' ? `${Math.abs(value)}` : key === 'avgOverdueDays' ? `${Math.round(value * 100) / 100}` : `${value}`;
      } else {
        slots[key] = String(value);
      }
    }
    if (item.code === 'ATT_DECISION_FACTOR') {
      const unit = typeof item.values.unit === 'string' ? (UNIT_LABELS[item.values.unit]?.[lang === 'en' ? 1 : 0] ?? item.values.unit) : '';
      slots.value = typeof item.values.value === 'number' ? `${Math.round(item.values.value * 100) / 100}${unit ? ` ${unit}` : ''}` : '—';
    }
    // §7 — the engine's joined missing-component names are system
    // vocabulary; they localize instead of rendering raw in English.
    if (typeof slots.missing === 'string') {
      slots.missing = localizeComponentNameText(slots.missing, locale);
    }
    const whatTemplate = ATTENTION_WHAT[item.code][lang];
    const whyTemplate = ATTENTION_WHY[item.code]?.[lang] ?? null;
    // §12 — the rendered SOURCE is the human-readable domain label;
    // the fact-layer rule id (item.source) is diagnostics-only.
    return {
      id: item.id,
      severity: item.severity,
      what: interpolate(whatTemplate, slots),
      why: whyTemplate ? interpolate(whyTemplate, slots) : null,
      source: uiLabelSafe(ATTENTION_SOURCE_LABELS, item.code, locale) ?? presentRule(item.code, locale),
      drillPage: item.drillPage,
    };
  });
}

// ── Executive narrative ──

export interface NarrativeSentenceView {
  code: NarrativeFact['code'];
  text: string;
}

const NARRATIVE_TEMPLATES: Record<NarrativeFact['code'], Record<'ar' | 'en', string>> = {
  NAR_SCORE: {
    ar: 'بلغ مؤشر الأداء الإجمالي {score} خلال الفترة.',
    en: 'The overall performance index reached {score} during the period.',
  },
  NAR_SCORE_INCOMPLETE: {
    ar: 'الحساب الكامل لمؤشر KPI غير مكتمل — مكونات بلا قيمة: {missing}.',
    en: 'The overall KPI calculation is incomplete — components without a value: {missing}.',
  },
  NAR_NO_SCORE: {
    // Engine codes never render — the sentence states the fact itself.
    ar: 'لا توجد نتيجة KPI نهائية لهذه الفترة.',
    en: 'No final KPI result for this period.',
  },
  NAR_DELTA: {
    ar: '{direction} بمقدار {delta} نقطة مقارنة بالشهر السابق.',
    en: '{direction} by {delta} points vs the previous month.',
  },
  NAR_TOP_ISSUE: {
    ar: 'تركزت {share} من ملاحظات الفترة ({count} ملاحظات) حول «{label}».',
    en: '{share} of the period\'s observations ({count}) concentrated around "{label}".',
  },
  NAR_FOLLOWUP: {
    ar: 'بلغ معدل إنجاز المتابعات {rate}.',
    en: 'The follow-up completion rate reached {rate}.',
  },
  NAR_OPEN_ITEMS: {
    ar: 'وتظل البنود المفتوحة نقطة متابعة: {items}.',
    en: 'Open items remain a follow-up focus: {items}.',
  },
  NAR_RISK: {
    ar: 'مستوى المخاطر التشغيلية: {level} (درجة {score}).',
    en: 'Operational risk level: {level} (score {score}).',
  },
  NAR_ATTENDANCE: {
    ar: 'نسبة الالتزام بالحضور {compliance} خلال الفترة.',
    en: 'Attendance compliance stood at {compliance} during the period.',
  },
  // §32 — the confirmed/cancelled split reconciles with the headline
  // (one closure population, split by CURRENT status).
  NAR_DEALS: {
    ar: 'أُغلق {closedWithEmployee} صفقة مع الموظف خلال الفترة، منها {confirmed} مؤكدة و{cancelled} ملغاة.',
    en: '{closedWithEmployee} deal(s) were closed with the employee during the period — {confirmed} confirmed and {cancelled} cancelled.',
  },
};

export function buildNarrativeViews(narrative: NarrativeFact[], locale: Locale): NarrativeSentenceView[] {
  const lang = locale === 'en' ? 'en' : 'ar';
  return narrative.map((fact) => {
    const slots: Record<string, string> = {};
    for (const [key, value] of Object.entries(fact.values)) {
      if (value === null || value === undefined) { slots[key] = '—'; continue; }
      if (typeof value === 'number') {
        if (key === 'delta') slots[key] = formatSignedPoints(value, locale) ?? '—';
        else if (key === 'rate' || key === 'share' || key === 'compliance') slots[key] = pct(value, locale);
        else if (key === 'score') slots[key] = `${Math.round(value * 100) / 100}`;
        else slots[key] = `${value}`;
      } else {
        slots[key] = String(value);
      }
    }
    if (fact.code === 'NAR_DELTA') {
      const delta = fact.values.delta;
      const direction = typeof delta === 'number' && delta > 0
        ? (locale === 'en' ? 'improved' : 'تحسّن مؤشر الأداء')
        : typeof delta === 'number' && delta < 0
          ? (locale === 'en' ? 'declined' : 'وتراجع مؤشر الأداء')
          : (locale === 'en' ? 'remained stable' : 'واستقر مؤشر الأداء');
      slots.direction = direction;
    }
    // §7 — the engine's joined missing-component names are system
    // vocabulary; they localize instead of rendering raw in English.
    if (typeof slots.missing === 'string') {
      slots.missing = localizeComponentNameText(slots.missing, locale);
    }
    if (fact.code === 'NAR_OPEN_ITEMS' && typeof fact.values.items === 'string') {
      const labels: Record<string, string> = {
        complaints: locale === 'en' ? 'open complaints' : 'شكاوى مفتوحة',
        capaOverdue: locale === 'en' ? 'overdue CAPA' : 'CAPA متأخرة',
        followUpsOverdue: locale === 'en' ? 'overdue follow-ups' : 'متابعات متأخرة',
      };
      slots.items = fact.values.items
        .split(',')
        .map((pair) => {
          const [k, v] = pair.split(':');
          return `${v} ${labels[k] ?? (locale === 'en' ? 'open item(s)' : 'بنود مفتوحة')}`;
        })
        .join(locale === 'en' ? ', ' : '، ');
    }
    if (fact.code === 'NAR_RISK' && typeof fact.values.level === 'string') {
      slots.level = uiLabelSafe(RISK_LEVEL_LABELS, fact.values.level, locale) ?? presentStatus(fact.values.level, locale);
    }
    return { code: fact.code, text: interpolate(NARRATIVE_TEMPLATES[fact.code][lang], slots) };
  });
}

// ── §4 Top 3 signals ──

export interface SignalItemView {
  code: SignalFact['code'];
  severity: SignalFact['severity'];
  text: string;
  drillPage: string | null;
}

const SIGNAL_TEMPLATES: Record<SignalFact['code'], Record<'ar' | 'en', string>> = {
  SIG_TREND_DOWN: {
    ar: 'انخفض مؤشر الجودة {delta} نقطة عن الشهر السابق',
    en: 'Quality index down {delta} points vs the previous month',
  },
  SIG_TREND_UP: {
    ar: 'تحسّن مؤشر الجودة {delta} نقطة عن الشهر السابق',
    en: 'Quality index up {delta} points vs the previous month',
  },
  SIG_TOP_ISSUE: {
    ar: '«{label}» يمثل {share} من ملاحظات الفترة ({count} ملاحظات)',
    en: '"{label}" accounts for {share} of the period\'s observations ({count})',
  },
  SIG_FOLLOWUP_COMPLETION: {
    ar: 'إنجاز المتابعات {completed} / {total} ({rate})',
    en: 'Follow-up completion {completed} / {total} ({rate})',
  },
  SIG_OVERDUE_FOLLOWUPS: { ar: '{count} متابعات متأخرة', en: '{count} overdue follow-up(s)' },
  SIG_OVERDUE_CAPA: { ar: '{count} حالات CAPA متأخرة', en: '{count} overdue CAPA case(s)' },
  SIG_OPEN_COMPLAINTS: { ar: '{count} شكاوى مفتوحة', en: '{count} open complaint(s)' },
  SIG_HIGH_SEVERITY: {
    ar: '{count} ملاحظات جودة عالية/حرجة الخطورة',
    en: '{count} high/critical-severity quality observation(s)',
  },
  SIG_REPEATED_ISSUE: {
    ar: 'تكرار «{label}» ({count} مرات خلال الفترة)',
    en: '"{label}" recurring ({count} occurrences this period)',
  },
  SIG_KPI_INCOMPLETE: {
    ar: 'حساب KPI يحتاج استكمال إعداد {missingCount} مكونات',
    en: 'KPI calculation awaits configuration of {missingCount} component(s)',
  },
  SIG_CLOSURES: {
    ar: '{count} صفقات مغلقة مع الموظف خلال الفترة',
    en: '{count} deal(s) closed with the employee this period',
  },
};

export function buildSignalViews(signals: SignalFact[], locale: Locale): SignalItemView[] {
  const lang = locale === 'en' ? 'en' : 'ar';
  return signals.map((s) => {
    const slots: Record<string, string> = {};
    for (const [key, value] of Object.entries(s.values)) {
      if (value === null || value === undefined) { slots[key] = '—'; continue; }
      if (typeof value === 'number') {
        // Deltas render as ABSOLUTE magnitudes — the template's verb
        // (انخفض/تحسّن) already carries the direction.
        slots[key] = key === 'delta' ? `${Math.abs(Math.round(value * 100) / 100)}`
          : key === 'share' || key === 'rate' ? pct(value, locale)
            : `${Math.round(value * 100) / 100}`;
      } else {
        slots[key] = String(value);
      }
    }
    return {
      code: s.code,
      severity: s.severity,
      text: interpolate(SIGNAL_TEMPLATES[s.code][lang], slots),
      drillPage: s.drillPage,
    };
  });
}

// ── §15 What changed ──

export interface WhatChangedRowView {
  metric: WhatChangedMetric;
  metricLabel: string;
  /** Units: 'percent' renders as a score row, others as counts. */
  isScore: boolean;
  previousDisplay: string;
  currentDisplay: string;
  deltaDisplay: string;
  deltaPositive: boolean | null;
}

const WHAT_CHANGED_LABELS: Record<WhatChangedMetric, [string, string]> = {
  quality_score: ['جودة الفترة', 'Period quality'],
  quality_observations: ['ملاحظات الجودة', 'Quality observations'],
  follow_ups: ['المتابعات', 'Follow-ups'],
  complaints: ['الشكاوى', 'Complaints'],
  capa: ['حالات CAPA', 'CAPA cases'],
  closures: ['تقفيلات الفترة', 'Closed during period'],
  travel: ['رحلات السفر', 'Travel departures'],
};

export function buildWhatChangedView(rows: WhatChangedFact[], locale: Locale): WhatChangedRowView[] {
  return rows.map((r) => ({
    metric: r.metric,
    metricLabel: uiLabelSafe(WHAT_CHANGED_LABELS, r.metric, locale) ?? presentEntity(r.metric, locale),
    isScore: r.metric === 'quality_score',
    previousDisplay: r.previous === null ? unavailableLabel(locale) : `${Math.round(r.previous * 100) / 100}`,
    currentDisplay: r.current === null ? unavailableLabel(locale) : `${Math.round(r.current * 100) / 100}`,
    deltaDisplay: formatSignedPoints(r.delta, locale) ?? '—',
    deltaPositive: r.delta === null || r.delta === undefined ? null : r.delta > 0,
  }));
}

// ── Data quality ──

export interface DataSourceStatusView {
  sourceLabel: string;
  availabilityLabel: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  periodCountDisplay: string | null;
}

export interface DataQualityIntelView {
  rows: DataSourceStatusView[];
  kpiConfigured: boolean;
  unattributed: number;
  notes: number;
  /** §18 — collection-level unattributed chips (human-readable labels). */
  unattributedChips: Array<{ label: string; count: number }>;
  /** §18 — the dataset's own data-quality notes (already Arabic prose). */
  noteLines: string[];
}

const SOURCE_LABELS: Record<string, [string, string]> = {
  kpi: ['مخطط KPI', 'KPI scheme'],
  quality: ['الجودة (ملاحظات/خصومات)', 'Quality (observations/deductions)'],
  followUps: ['المتابعات', 'Follow-ups'],
  complaints: ['شكاوى العملاء', 'Customer complaints'],
  capa: ['حالات CAPA', 'CAPA cases'],
  deals: ['صفقات السفر', 'Travel deals'],
  attendance: ['الحضور', 'Attendance'],
  hrDeductions: ['خصومات الموارد البشرية', 'HR deductions'],
  risk: ['محرك المخاطر', 'Risk engine'],
  // RTDB collection names (unattributed-record accounting).
  qualityObservations: ['ملاحظات الجودة', 'Quality observations'],
  qualityDeductions: ['خصومات الجودة', 'Quality deductions'],
  travelDeals: ['صفقات السفر', 'Travel deals'],
  capaCases: ['حالات CAPA', 'CAPA cases'],
};

const AVAILABILITY_LABELS: Record<SourceAvailability, [string, string]> = {
  available: ['متاح', 'Available'],
  no_data: ['لا بيانات في الفترة', 'No data for the period'],
  configuration_required: ['يتطلب إعدادًا', 'Configuration required'],
  withheld: ['محجوب — لا صلاحية', 'Withheld — no permission'],
};

export function buildDataQualityIntelView(
  dataQuality: DataQualityIntel,
  locale: Locale,
  extras?: {
    /** The dataset's unattributed-record accounting (collection → count). */
    unattributedRecords?: ReadonlyArray<{ collection: string; count: number }>;
    /** The dataset's own data-quality notes (stored Arabic prose). */
    notes?: ReadonlyArray<string>;
  },
): DataQualityIntelView {
  return {
    rows: dataQuality.sources.map((s) => {
      const tone: DataSourceStatusView['tone'] =
        s.availability === 'available' ? 'good'
          : s.availability === 'withheld' ? 'neutral'
            : s.availability === 'configuration_required' ? 'bad'
              : 'warn';
      return {
        // §PRESENTATION-BOUNDARY — unknown source/availability keys
        // resolve to safe generic labels; raw keys never render.
        sourceLabel: uiLabelSafe(SOURCE_LABELS, s.source, locale) ?? presentEntity(s.source, locale),
        availabilityLabel: uiLabelSafe(AVAILABILITY_LABELS, s.availability, locale) ?? presentStatus(s.availability, locale),
        tone,
        periodCountDisplay: s.periodCount !== null && s.periodCount !== undefined ? `${s.periodCount}` : null,
      };
    }),
    kpiConfigured: dataQuality.kpiConfigured,
    unattributed: dataQuality.unattributed,
    notes: dataQuality.notes,
    unattributedChips: (extras?.unattributedRecords ?? [])
      .filter((u) => u.count > 0)
      .map((u) => ({
        label: uiLabelSafe(SOURCE_LABELS, u.collection, locale) ?? presentEntity(u.collection, locale),
        count: u.count,
      })),
    // §I18N-BOUNDARY — the dataset's data-quality notes are SYSTEM-
    // generated fixed sentences (assemble.ts), application-owned UI by
    // construction: they claim through translateUIText so an English
    // report never shows Arabic system prose. User-entered business data
    // never reaches this list.
    noteLines: (extras?.notes ?? []).map((note) => translateUIText(note, locale)),
  };
}

// ─────────────────────────────────────────────────────────────
//  The bundle — ONE pure call over the ONE payload
// ─────────────────────────────────────────────────────────────

export interface IntelligenceViews {
  executive: ExecutiveSummaryView;
  /** §4 — up to three management headline signals. */
  signals: SignalItemView[];
  kpi: KpiIntelView;
  quality: QualityIntelView;
  patterns: PatternView[];
  attention: AttentionItemView[];
  /** §15 — current vs previous comparable period rows. */
  whatChanged: WhatChangedRowView[];
  narrative: NarrativeSentenceView[];
  dataQuality: DataQualityIntelView;
  /** §DEAL-DISPLAY — the canonical deal breakdown (explicit semantics). */
  deals: {
    /** DEAL_CLOSED (dealClosedAt) — any current status. */
    closedDuringPeriod: number;
    confirmedClosures: number;
    cancelledClosures: number;
    stillActiveClosures: number;
    /** CLOSED (closedAt) — completions attributed by completion date. */
    completedInPeriod: number;
    /** TRAVEL (departureDate) — departures. */
    travelDepartures: number;
    /** §27 — current-status snapshot (upcoming + in_progress). */
    currentDeals: number;
    currentCanceledAllTime: number;
    closedWithEmployeeTotal: number;
    closedWithEmployeeUnknownMonth: number;
  };
  /** Canonical risk block (section-gated upstream) for the summary. */
  decisionSummary: {
    riskScore: number | null;
    riskLevel: string | null;
    status: string | null;
  } | null;
}

const PATTERN_SEVERITY_ORDER: Record<PatternFact['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function buildIntelligenceViews(payload: ReportPayload, locale: Locale): IntelligenceViews {
  const previousMonth = previousMonthKey(payload.period.monthKey);
  const input: QualityIntelligenceInput = {
    dataset: payload,
    decision: payload.decision ?? null,
    hrDeductions: payload.hrDeductions ?? null,
    previousMonthKey: previousMonth,
  };
  const intel = buildQualityIntelligence(input);
  // §12 REPETITION DOCTRINE — Fact → Meaning → Action, each fact ONCE:
  //   • The trend-direction patterns restate the MoM delta the "What
  //     Changed" table already carries as the quality row — the
  //     insufficient-data pattern stays (it explains a MISSING row).
  //   • NAR_DELTA repeats the same delta as prose — dropped from the
  //     closing analysis.
  //   • Management attention is capped to the three highest-severity
  //     actions (§14) — stable order within a severity keeps the
  //     engine's own priority.
  const whatChanged = buildWhatChangedView(intel.whatChanged, locale);
  const hasQualityChangeRow = whatChanged.some((r) => r.metric === 'quality_score');
  const patterns = buildPatternViews(
    intel.patterns.filter((p) => {
      if (!hasQualityChangeRow) return true;
      return p.code !== 'IMPROVING_TREND' && p.code !== 'DECLINING_TREND' && p.code !== 'STABLE_TREND';
    }),
    locale,
  );
  const narrative = buildNarrativeViews(
    intel.narrative.filter((n) => n.code !== 'NAR_DELTA'),
    locale,
  );
  const attention = buildAttentionViews(
    [...intel.attention]
      .sort((a, b) => PATTERN_SEVERITY_ORDER[a.severity] - PATTERN_SEVERITY_ORDER[b.severity])
      .slice(0, 3),
    locale,
  );
  return {
    executive: buildExecutiveSummaryView(intel.executive, locale),
    signals: buildSignalViews(intel.signals, locale),
    kpi: buildKpiIntelView(intel.kpi, locale),
    quality: buildQualityIntelView(intel.quality, locale),
    patterns,
    attention,
    whatChanged,
    narrative,
    dataQuality: buildDataQualityIntelView(intel.dataQuality, locale, {
      unattributedRecords: payload.dataQuality.unattributedRecords,
      notes: payload.dataQuality.notes,
    }),
    deals: {
      closedDuringPeriod: intel.deals.closedWithEmployeeInPeriod,
      confirmedClosures: intel.deals.confirmedClosures,
      cancelledClosures: intel.deals.cancelledClosures,
      stillActiveClosures: intel.deals.stillActiveClosures,
      completedInPeriod: intel.deals.completedInPeriod,
      travelDepartures: intel.deals.travelInPeriod,
      currentDeals: intel.deals.currentDeals,
      currentCanceledAllTime: intel.deals.currentCanceledAllTime,
      closedWithEmployeeTotal: intel.deals.closedWithEmployeeTotal,
      closedWithEmployeeUnknownMonth: input.dataset.deals.closedWithEmployeeUnknownMonth,
    },
    decisionSummary: payload.decision
      ? {
          riskScore: payload.decision.executive.riskScore,
          riskLevel: payload.decision.executive.riskLevel,
          status: payload.decision.executive.status,
        }
      : null,
  };
}
