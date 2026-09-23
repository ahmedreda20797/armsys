// ══════════════════════════════════════════════════════════════
//  Smart Quality Report — Statistical Insights view (Phase 5)
//
//  Pure, client-safe mapping from the analytics OUTPUT
//  contract to display-ready labels/tones. Presentation only:
//  NOTHING here recalculates, aggregates or infers — every number
//  is rendered verbatim from the analytics result (spec §31:
//  minimum integration, facts-only sections stay untouched).
//
//  Directly unit-testable under node:test (no React import).
//
//  §I18N-BOUNDARY — every label emitted here is APPLICATION-OWNED UI
//  derived from system enum codes (never business/user data, which
//  passes through raw). Label maps carry [ar, en] pairs picked by the
//  caller's locale; 'ar' (the default) reproduces the historical
//  Arabic rendering.
// ══════════════════════════════════════════════════════════════

import type { AnalyticsApiResponse } from '@/lib/analytics/types';
import type { Locale } from '@/lib/i18n/dictionary';
import { formatInteger, formatNumber, formatPercentage } from '@/lib/i18n/format';
import { unavailableLabel, type KeyValueFact, type Tone } from './view-model';

// ── Label maps (system enum codes → [ar, en] display labels) ──

const CONFIDENCE_LABELS: Record<string, [string, string]> = {
  HIGH: ['ثقة عالية', 'High confidence'],
  MEDIUM: ['ثقة متوسطة', 'Medium confidence'],
  LOW: ['ثقة منخفضة', 'Low confidence'],
  INSUFFICIENT_DATA: ['بيانات غير كافية', 'Insufficient data'],
};

const CONFIDENCE_TONES: Record<string, Tone> = {
  HIGH: 'good',
  MEDIUM: 'info',
  LOW: 'warn',
  INSUFFICIENT_DATA: 'neutral',
};

const SEVERITY_LABELS: Record<string, [string, string]> = {
  HIGH: ['شدة عالية', 'High severity'],
  MEDIUM: ['شدة متوسطة', 'Medium severity'],
};

const SEVERITY_TONES: Record<string, Tone> = {
  HIGH: 'bad',
  MEDIUM: 'warn',
};

const DIRECTION_LABELS: Record<string, [string, string]> = {
  UP: ['صاعد', 'Up'],
  DOWN: ['هابط', 'Down'],
  STABLE: ['مستقر', 'Stable'],
};

const DOMAIN_LABELS: Record<string, [string, string]> = {
  observations: ['الملاحظات', 'Observations'],
  complaints: ['الشكاوى', 'Complaints'],
  capa: ['إجراءات CAPA', 'CAPA actions'],
  followUps: ['المتابعات', 'Follow-ups'],
  deals: ['صفقات السفر', 'Travel deals'],
};

const ANOMALY_TYPE_PREFIX: Record<string, string> = {
  OBSERVATIONS: 'observations',
  COMPLAINTS: 'complaints',
  CAPA: 'capa',
  FOLLOWUPS: 'followUps',
  DEALS: 'deals',
};

const METRIC_LABELS: Record<string, [string, string]> = {
  'observations.monthlyCount': ['العدد الشهري للملاحظات', 'Monthly observations count'],
  'complaints.monthlyCount': ['العدد الشهري للشكاوى', 'Monthly complaints count'],
  'capa.monthlyCount': ['العدد الشهري لإجراءات CAPA', 'Monthly CAPA actions count'],
  'followUps.monthlyCount': ['العدد الشهري للمتابعات', 'Monthly follow-ups count'],
  'deals.monthlyCount': ['العدد الشهري للصفقات (تاريخ المغادرة)', 'Monthly deals count (departure date)'],
  'kpi.quality.rawScore.deltaPoints': ['التغير الشهري في درجة الجودة', 'Monthly change in the quality score'],
};

const NOTE_CODE_LABELS: Record<string, [string, string]> = {
  ANOMALY_NOT_WRONGDOING: [
    'الاختلاف الإحصائي ليس حكماً على الموظف ولا دليلاً على مخالفة.',
    'A statistical anomaly is not a judgment on the employee nor evidence of a violation.',
  ],
  ASSOCIATION_NOT_CAUSATION: [
    'تزامن زمني بين المؤشرين فقط — لا يُعد علاقة سببية.',
    'Temporal co-occurrence of two metrics only — not a causal relation.',
  ],
  CORRELATION_NOT_CAUSATION: [
    'الارتباط الإحصائي ليس سببية.',
    'Statistical correlation is not causation.',
  ],
  MTD_PARTIAL_MONTH: [
    'الشهر الحالي جزئي (حتى تاريخه) — التحليلات الحساسة للشهر الجزئي مستبعدة عمداً.',
    'The current month is partial (month to date) — partial-month-sensitive analyses are deliberately excluded.',
  ],
  ABSENT_MONTH_IS_ZERO_RECORDS: [
    'الشهر داخل النافذة دون سجلات مخزنة يُحسب صفر سجلات (حقيقة مخزنة)؛ درجات KPI الغائبة لا تُعدّ صفراً أبداً.',
    'A month inside the window with no stored records counts as zero records (a stored fact); missing KPI scores are never counted as zero.',
  ],
  ANALYSIS_GATED_ON_CONFIRMED_ATTRIBUTION: [
    'تحليل الاتجاه مشروط بـ attribution مؤكد للشكاوى.',
    'Trend analysis is conditional on confirmed complaint attribution.',
  ],
  INSUFFICIENT_TREND_DATA: [
    'عدد الأشهر المتاحة لا يكفي لإحصاءات الاتجاه.',
    'The available months are not enough for trend statistics.',
  ],
  ATTENDANCE_NOT_AVAILABLE: [
    'نتيجة الحضور غير متاحة لهذه الفترة.',
    'The attendance result is unavailable for this period.',
  ],
};

const REASON_LABELS: Record<string, [string, string]> = {
  INSUFFICIENT_SAMPLE: ['حجم عينة غير كافٍ', 'Insufficient sample size'],
  INSUFFICIENT_BASELINE: ['خط أساس غير كافٍ', 'Insufficient baseline'],
  FLAT_BASELINE: ['خط أساس دون تشتت كافٍ', 'Baseline without enough variance'],
  NO_VARIANCE: ['لا يوجد تشتت في السلسلة', 'No variance in the series'],
  MTD_PARTIAL_MONTH: ['شهر جزئي (حتى تاريخه)', 'Partial month (month to date)'],
};

const AREA_LABELS: Record<string, [string, string]> = {
  anomalyDetection: ['كشف الاختلافات', 'Anomaly detection'],
  correlation: ['الارتباطات', 'Correlations'],
  crossDomainPatterns: ['الأنماط عبر النطاقات', 'Cross-domain patterns'],
  trend: ['تحليل الاتجاه', 'Trend analysis'],
  mtdPartialMonth: ['الشهر الحالي الجزئي', 'Current partial month'],
  attendance: ['الحضور', 'Attendance'],
};

const VALUE_BASIS_LABELS: Record<string, [string, string]> = {
  MTD: ['حتى تاريخه (MTD)', 'Month to date (MTD)'],
  LIVE: ['حية (غير مقفلة)', 'Live (unlocked)'],
  FINALIZED: ['نهائية (مقفلة)', 'Finalized (locked)'],
};

const STRENGTH_LABELS: Record<string, [string, string]> = {
  STRONG: ['قوية', 'Strong'],
  MODERATE: ['متوسطة', 'Moderate'],
  WEAK: ['ضعيفة', 'Weak'],
  NEGLIGIBLE: ['ضئيلة', 'Negligible'],
};

// ── Helpers ───────────────────────────────────────────────────

/** Pick the locale side of an application-owned [ar, en] label pair. */
function uiLabel(pair: [string, string], locale: Locale): string {
  return locale === 'en' ? pair[1] : pair[0];
}

/** Fallback-aware label for system enum codes (unknown keys stay verbatim). */
function storedLabel(map: Record<string, [string, string]>, key: string, locale: Locale): string {
  const pair = map[key];
  return pair ? uiLabel(pair, locale) : key;
}

// ── Formatting helpers (presentation only — no recomputation) ─

function fmtNum(value: number | null | undefined, digits = 1, locale: Locale = 'ar'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return unavailableLabel(locale);
  return formatNumber(value, { locale, maximumFractionDigits: digits });
}

function fmtSigned(value: number | null | undefined, digits = 1, locale: Locale = 'ar'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return unavailableLabel(locale);
  const sign = value > 0 ? '+' : '';
  return `${sign}${fmtNum(value, digits, locale)}`;
}

export function labelForNoteCode(code: string, locale: Locale = 'ar'): string {
  return storedLabel(NOTE_CODE_LABELS, code, locale);
}

// ── View types ────────────────────────────────────────────────

export type AnalyticsViewKind =
  | 'READY'
  | 'UNAVAILABLE'
  | 'ERROR'
  | 'TIMEOUT'
  | 'LOADING'
  | 'IDLE';

export interface AnalyticsBadgeView {
  label: string;
  tone: Tone;
}

export interface AnalyticsAnomalyView {
  title: string;
  metricLabel: string;
  month: string;
  observedLabel: string;
  rangeLabel: string;
  zLabel: string;
  severity: AnalyticsBadgeView;
  confidence: AnalyticsBadgeView;
  noteLabel: string;
}

export interface AnalyticsPatternView {
  pairLabel: string;
  monthsLabel: string;
  confidence: AnalyticsBadgeView;
  noteLabel: string;
}

export interface AnalyticsCorrelationView {
  pairLabel: string;
  coefficientLabel: string;
  sampleLabel: string;
  strengthLabel: string;
  strengthTone: Tone;
  confidence: AnalyticsBadgeView;
}

export interface AnalyticsDeltaChipView {
  label: string;
  text: string;
  tone: Tone;
}

export interface AnalyticsGapView {
  areaLabel: string;
  reasonLabel: string;
  detailLabel: string;
}

export interface AnalyticsReadyView {
  kind: 'READY';
  periodLabel: string;
  overallConfidence: AnalyticsBadgeView;
  /** §7 trend statistics — verbatim from the result. */
  trend: {
    statusLabel: string;
    facts: KeyValueFact[];
    directionLabel: string;
    confidence: AnalyticsBadgeView;
    missingLabel: string | null;
  };
  /** §10 anomalies. */
  anomalies: AnalyticsAnomalyView[];
  /** §17 cross-domain temporal associations. */
  patterns: AnalyticsPatternView[];
  /** §18 correlations. */
  correlations: AnalyticsCorrelationView[];
  /** §6 period-over-period count deltas. */
  deltas: AnalyticsDeltaChipView[];
  /** §8 concentration chips — measurable facts only. */
  concentration: Array<{ label: string; text: string }>;
  /** §19 analytics data-quality gaps — never hidden. */
  gaps: AnalyticsGapView[];
  unavailableMetricsLabel: string | null;
  noteLabels: string[];
}

export type AnalyticsView =
  | AnalyticsReadyView
  | { kind: 'LOADING' }
  | { kind: 'IDLE' }
  | { kind: 'UNAVAILABLE'; reason: string; message: string }
  | { kind: 'TIMEOUT'; reason: 'TIMEOUT'; message: string }
  | { kind: 'ERROR'; reason: string; message: string };

// ── Builder ───────────────────────────────────────────────────

export function buildAnalyticsView(api: AnalyticsApiResponse | undefined, locale: Locale = 'ar'): AnalyticsView {
  if (!api) return { kind: 'IDLE' };
  if (api.status === 'ANALYTICS_UNAVAILABLE') {
    return { kind: 'UNAVAILABLE', reason: api.reason, message: api.message };
  }
  if (api.status === 'ANALYTICS_TIMEOUT') {
    // Distinct state (Phase 5.2 spec §10/§11): a timeout is rendered
    // separately — not "unavailable", not a generic error.
    return { kind: 'TIMEOUT', reason: 'TIMEOUT', message: api.message };
  }
  if (api.status === 'ANALYTICS_ERROR') {
    return { kind: 'ERROR', reason: api.reason, message: api.message };
  }

  const r = api.analytics;
  const trend = r.trendAnalysis;
  const stats = trend.stats;

  // §7 trend facts — every value verbatim.
  const trendFacts: KeyValueFact[] = [
    { label: uiLabel(['أشهر متاحة', 'Months available'], locale), value: formatInteger(trend.availableMonths, locale), unavailable: false },
    {
      label: uiLabel(['المتوسط', 'Mean'], locale),
      value: stats ? fmtNum(stats.mean, 1, locale) : unavailableLabel(locale),
      unavailable: !stats,
    },
    {
      label: uiLabel(['الوسيط', 'Median'], locale),
      value: stats ? fmtNum(stats.median, 1, locale) : unavailableLabel(locale),
      unavailable: !stats,
    },
    {
      label: uiLabel(['أدنى / أعلى', 'Min / Max'], locale),
      value: stats ? `${fmtNum(stats.min, 1, locale)} / ${fmtNum(stats.max, 1, locale)}` : unavailableLabel(locale),
      unavailable: !stats,
    },
    {
      label: uiLabel(['المدى', 'Range'], locale),
      value: stats ? fmtNum(stats.range, 1, locale) : unavailableLabel(locale),
      unavailable: !stats,
    },
    {
      label: uiLabel(['الانحراف المعياري', 'Std deviation'], locale),
      value: stats ? fmtNum(stats.stdDev, 2, locale) : unavailableLabel(locale),
      unavailable: !stats,
    },
    {
      label: uiLabel(['الميل الشهري', 'Monthly slope'], locale),
      value: stats && stats.slopePerMonth !== null
        ? `${fmtSigned(stats.slopePerMonth, 2, locale)} ${locale === 'en' ? 'pp/month' : 'pp/شهر'}`
        : unavailableLabel(locale),
      unavailable: !stats || stats.slopePerMonth === null,
    },
    {
      label: uiLabel(['معامل الاختلاف', 'Coefficient of variation'], locale),
      value: stats && stats.coefficientOfVariationPct !== null
        ? formatPercentage(stats.coefficientOfVariationPct, { locale })
        : unavailableLabel(locale),
      unavailable: !stats || stats.coefficientOfVariationPct === null,
    },
  ];

  const anomalies: AnalyticsAnomalyView[] = r.anomalies.map((a) => ({
    title: anomalyTitle(a.anomalyType, locale),
    metricLabel: storedLabel(METRIC_LABELS, a.metric, locale),
    month: a.month ?? unavailableLabel(locale),
    observedLabel: a.anomalyType === 'SCORE_DROP'
      ? `${fmtSigned(a.observedValue, 2, locale)} pp`
      : fmtNum(a.observedValue, 0, locale),
    rangeLabel: a.expectedRange.method === 'FIXED_THRESHOLD'
      ? locale === 'en'
        ? `Fixed threshold: ≤ ${fmtNum(a.expectedRange.high, 0, locale)}`
        : `عتبة ثابتة: ≤ ${fmtNum(a.expectedRange.high, 0, locale)}`
      : locale === 'en'
        ? `Expected range: ${fmtNum(a.expectedRange.low, 1, locale)} – ${fmtNum(a.expectedRange.high, 1, locale)}`
        : `النطاق المتوقع: ${fmtNum(a.expectedRange.low, 1, locale)} – ${fmtNum(a.expectedRange.high, 1, locale)}`,
    zLabel: a.zScore !== null ? `z = ${fmtNum(a.zScore, 2, locale)}` : unavailableLabel(locale),
    severity: {
      label: storedLabel(SEVERITY_LABELS, a.severity, locale),
      tone: SEVERITY_TONES[a.severity] ?? 'warn',
    },
    confidence: {
      label: storedLabel(CONFIDENCE_LABELS, a.confidence, locale),
      tone: CONFIDENCE_TONES[a.confidence] ?? 'neutral',
    },
    noteLabel: labelForNoteCode(a.noteCode, locale),
  }));

  const patterns: AnalyticsPatternView[] = r.crossDomainPatterns.map((p) => ({
    pairLabel: `${storedLabel(DOMAIN_LABELS, p.domainA, locale)} × ${storedLabel(DOMAIN_LABELS, p.domainB, locale)}`,
    monthsLabel: locale === 'en'
      ? `Concurrent increase in ${formatInteger(p.sharedIncreaseMonths.length, locale)} of ${formatInteger(p.monthsAnalyzed, locale)} months: ${p.sharedIncreaseMonths.join(', ')}`
      : `تزامن ارتفاع في ${formatInteger(p.sharedIncreaseMonths.length, locale)} من ${formatInteger(p.monthsAnalyzed, locale)} أشهر: ${p.sharedIncreaseMonths.join('، ')}`,
    confidence: {
      label: storedLabel(CONFIDENCE_LABELS, p.confidence, locale),
      tone: CONFIDENCE_TONES[p.confidence] ?? 'neutral',
    },
    noteLabel: labelForNoteCode(p.noteCode, locale),
  }));

  const correlations: AnalyticsCorrelationView[] = r.correlations.map((c) => ({
    pairLabel: `${storedLabel(DOMAIN_LABELS, c.variables[0], locale)} × ${storedLabel(DOMAIN_LABELS, c.variables[1], locale)}`,
    coefficientLabel: `r = ${fmtNum(c.coefficient, 3, locale)}`,
    sampleLabel: `n = ${formatInteger(c.sampleSize, locale)}`,
    strengthLabel: storedLabel(STRENGTH_LABELS, c.strength, locale),
    strengthTone: c.strength === 'STRONG' ? 'info' : 'neutral',
    confidence: {
      label: storedLabel(CONFIDENCE_LABELS, c.confidence, locale),
      tone: CONFIDENCE_TONES[c.confidence] ?? 'neutral',
    },
  }));

  const deltas: AnalyticsDeltaChipView[] = Object.entries(r.periodComparison.deltas)
    .map(([domain, delta]) => ({
      label: storedLabel(DOMAIN_LABELS, domain, locale),
      text: fmtSigned(delta, 0, locale),
      tone: delta > 0 ? 'warn' as Tone : delta < 0 ? 'good' as Tone : 'neutral' as Tone,
    }));

  const concentration = r.patternAnalysis.observations.byCategory.concentration
    .map((c) => ({
      label: c.label,
      text: locale === 'en'
        ? `${formatInteger(c.count, locale)} of ${formatInteger(r.patternAnalysis.observations.byCategory.total, locale)} observations (${fmtNum(c.sharePct, 1, locale)}%)`
        : `${formatInteger(c.count, locale)} من ${formatInteger(r.patternAnalysis.observations.byCategory.total, locale)} ملاحظة (${fmtNum(c.sharePct, 1, locale)}%)`,
    }));

  const gaps: AnalyticsGapView[] = r.dataQuality.insufficientSamples.map((s) => ({
    areaLabel: storedLabel(AREA_LABELS, s.area, locale),
    reasonLabel: storedLabel(REASON_LABELS, s.reason, locale),
    detailLabel: s.detail
      ?? (s.required !== undefined
        ? locale === 'en'
          ? `Required ${s.required} — Available ${s.actual ?? unavailableLabel(locale)}`
          : `المطلوب ${s.required} — المتاح ${s.actual ?? unavailableLabel(locale)}`
        : ''),
  }));

  const noteLabels = Array.from(new Set([
    ...r.dataQuality.notes.map((note) => labelForEngineNote(note, locale)),
    ...collectNoteCodes(r, locale),
  ].filter(Boolean))) as string[];

  return {
    kind: 'READY',
    periodLabel: `${r.input.monthKey ?? unavailableLabel(locale)} — ${VALUE_BASIS_LABELS[r.input.valueBasis ?? ''] ? uiLabel(VALUE_BASIS_LABELS[r.input.valueBasis ?? ''], locale) : r.input.valueBasis ?? unavailableLabel(locale)}`,
    overallConfidence: {
      label: storedLabel(CONFIDENCE_LABELS, r.overallConfidence, locale),
      tone: CONFIDENCE_TONES[r.overallConfidence] ?? 'neutral',
    },
    trend: {
      statusLabel: trend.status === 'OK'
        ? uiLabel(['إحصاءات الاتجاه', 'Trend statistics'], locale)
        : uiLabel(['بيانات الاتجاه غير كافية', 'Insufficient trend data'], locale),
      facts: trendFacts,
      directionLabel: stats?.direction
        ? storedLabel(DIRECTION_LABELS, stats.direction, locale)
        : unavailableLabel(locale),
      confidence: {
        label: storedLabel(CONFIDENCE_LABELS, trend.confidence, locale),
        tone: CONFIDENCE_TONES[trend.confidence] ?? 'neutral',
      },
      missingLabel: trend.missingMonths.length > 0
        ? locale === 'en'
          ? `Months without a KPI result (never counted as zero): ${trend.missingMonths.join(', ')}`
          : `أشهر بدون نتيجة KPI (لا تُعدّ صفراً): ${trend.missingMonths.join('، ')}`
        : null,
    },
    anomalies,
    patterns,
    correlations,
    deltas,
    concentration,
    gaps,
    unavailableMetricsLabel: r.dataQuality.unavailableMetrics.length > 0
      ? r.dataQuality.unavailableMetrics.join(' • ')
      : null,
    noteLabels,
  };
}

function anomalyTitle(anomalyType: string, locale: Locale = 'ar'): string {
  if (anomalyType === 'SCORE_DROP') {
    return locale === 'en' ? 'Sharp drop in the quality score' : 'هبوط حاد في درجة الجودة';
  }
  if (anomalyType.endsWith('_COUNT_SPIKE')) {
    const prefix = anomalyType.replace('_COUNT_SPIKE', '');
    const domainKey = ANOMALY_TYPE_PREFIX[prefix];
    const domain = domainKey ? uiLabel(DOMAIN_LABELS[domainKey], locale) : prefix;
    return locale === 'en' ? `Unusual increase in ${domain} count` : `ارتفاع غير معتاد في عدد ${domain}`;
  }
  return anomalyType;
}

/** Translate a handful of known engine note sentences; pass others through. */
function labelForEngineNote(note: string, locale: Locale = 'ar'): string {
  if (note.startsWith('ARCHIVED_BUT_ELIGIBLE')) {
    return locale === 'en'
      ? 'Employee currently archived — the valid historical period remains analyzable with no fabricated activity after archiving.'
      : 'موظف مؤرشف حالياً — الفترة التاريخية الصالحة تبقى قابلة للتحليل دون أي نشاط مُختلق بعد الأرشفة.';
  }
  if (note.startsWith('ABSENT_MONTH_IS_ZERO_RECORDS')) {
    return uiLabel(NOTE_CODE_LABELS.ABSENT_MONTH_IS_ZERO_RECORDS, locale);
  }
  if (note.startsWith('MTD_PARTIAL_MONTH')) {
    return uiLabel(NOTE_CODE_LABELS.MTD_PARTIAL_MONTH, locale);
  }
  if (note.startsWith('Monthly records outside')) {
    const detail = note.split(':').slice(1).join(':').trim();
    return locale === 'en'
      ? `Monthly records outside the analysis window were excluded (${detail})`
      : `سجلات شهرية خارج نافذة التحليل تم استبعادها (${detail})`;
  }
  return '';
}

function collectNoteCodes(r: import('@/lib/analytics/types').EmployeeAnalyticsResult, locale: Locale = 'ar'): string[] {
  const codes = new Set<string>();
  const push = (code?: string | null) => {
    if (code && NOTE_CODE_LABELS[code]) codes.add(uiLabel(NOTE_CODE_LABELS[code], locale));
  };
  for (const block of [
    r.patternAnalysis.observations,
    r.patternAnalysis.repeatedIssues,
    r.patternAnalysis.deductions,
    r.distributionAnalysis.complaints,
    r.distributionAnalysis.capa,
    r.distributionAnalysis.followUps,
    r.distributionAnalysis.deals,
    r.distributionAnalysis.attendance,
  ]) {
    for (const code of (block as { noteCodes?: string[] }).noteCodes ?? []) push(code);
  }
  push(r.periodComparison.noteCode);
  return Array.from(codes);
}
