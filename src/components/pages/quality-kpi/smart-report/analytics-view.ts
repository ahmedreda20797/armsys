// ══════════════════════════════════════════════════════════════
//  Smart Quality Report — Statistical Insights view (Phase 5)
//
//  Pure, client-safe mapping from the Python analytics OUTPUT
//  contract to display-ready labels/tones. Presentation only:
//  NOTHING here recalculates, aggregates or infers — every number
//  is rendered verbatim from the analytics result (spec §31:
//  minimum integration, facts-only sections stay untouched).
//
//  Directly unit-testable under node:test (no React import).
// ══════════════════════════════════════════════════════════════

import type { AnalyticsApiResponse } from '@/lib/analytics/types';
import { UNAVAILABLE, type KeyValueFact, type Tone } from './view-model';

// ── Label maps (Arabic, same doctrine as view-model.ts) ───────

const CONFIDENCE_LABELS: Record<string, string> = {
  HIGH: 'ثقة عالية',
  MEDIUM: 'ثقة متوسطة',
  LOW: 'ثقة منخفضة',
  INSUFFICIENT_DATA: 'بيانات غير كافية',
};

const CONFIDENCE_TONES: Record<string, Tone> = {
  HIGH: 'good',
  MEDIUM: 'info',
  LOW: 'warn',
  INSUFFICIENT_DATA: 'neutral',
};

const SEVERITY_LABELS: Record<string, string> = {
  HIGH: 'شدة عالية',
  MEDIUM: 'شدة متوسطة',
};

const SEVERITY_TONES: Record<string, Tone> = {
  HIGH: 'bad',
  MEDIUM: 'warn',
};

const DIRECTION_LABELS: Record<string, string> = {
  UP: 'صاعد',
  DOWN: 'هابط',
  STABLE: 'مستقر',
};

const DOMAIN_LABELS: Record<string, string> = {
  observations: 'الملاحظات',
  complaints: 'الشكاوى',
  capa: 'إجراءات CAPA',
  followUps: 'المتابعات',
  deals: 'صفقات السفر',
};

const ANOMALY_TYPE_PREFIX: Record<string, string> = {
  OBSERVATIONS: DOMAIN_LABELS.observations,
  COMPLAINTS: DOMAIN_LABELS.complaints,
  CAPA: DOMAIN_LABELS.capa,
  FOLLOWUPS: DOMAIN_LABELS.followUps,
  DEALS: DOMAIN_LABELS.deals,
};

const METRIC_LABELS: Record<string, string> = {
  'observations.monthlyCount': 'العدد الشهري للملاحظات',
  'complaints.monthlyCount': 'العدد الشهري للشكاوى',
  'capa.monthlyCount': 'العدد الشهري لإجراءات CAPA',
  'followUps.monthlyCount': 'العدد الشهري للمتابعات',
  'deals.monthlyCount': 'العدد الشهري للصفقات',
  'kpi.quality.rawScore.deltaPoints': 'التغير الشهري في درجة الجودة',
};

const NOTE_CODE_LABELS: Record<string, string> = {
  ANOMALY_NOT_WRONGDOING: 'الاختلاف الإحصائي ليس حكماً على الموظف ولا دليلاً على مخالفة.',
  ASSOCIATION_NOT_CAUSATION: 'تزامن زمني بين المؤشرين فقط — لا يُعد علاقة سببية.',
  CORRELATION_NOT_CAUSATION: 'الارتباط الإحصائي ليس سببية.',
  MTD_PARTIAL_MONTH: 'الشهر الحالي جزئي (حتى تاريخه) — التحليلات الحساسة للشهر الجزئي مستبعدة عمداً.',
  ABSENT_MONTH_IS_ZERO_RECORDS: 'الشهر داخل النافذة دون سجلات مخزنة يُحسب صفر سجلات (حقيقة مخزنة)؛ درجات KPI الغائبة لا تُعدّ صفراً أبداً.',
  ANALYSIS_GATED_ON_CONFIRMED_ATTRIBUTION: 'تحليل الاتجاه مشروط بـ attribution مؤكد للشكاوى.',
  INSUFFICIENT_TREND_DATA: 'عدد الأشهر المتاحة لا يكفي لإحصاءات الاتجاه.',
  ATTENDANCE_NOT_AVAILABLE: 'نتيجة الحضور غير متاحة لهذه الفترة.',
};

const REASON_LABELS: Record<string, string> = {
  INSUFFICIENT_SAMPLE: 'حجم عينة غير كافٍ',
  INSUFFICIENT_BASELINE: 'خط أساس غير كافٍ',
  FLAT_BASELINE: 'خط أساس دون تشتت كافٍ',
  NO_VARIANCE: 'لا يوجد تشتت في السلسلة',
  MTD_PARTIAL_MONTH: 'شهر جزئي (حتى تاريخه)',
};

const AREA_LABELS: Record<string, string> = {
  anomalyDetection: 'كشف الاختلافات',
  correlation: 'الارتباطات',
  crossDomainPatterns: 'الأنماط عبر النطاقات',
  trend: 'تحليل الاتجاه',
  mtdPartialMonth: 'الشهر الحالي الجزئي',
  attendance: 'الحضور',
};

const VALUE_BASIS_LABELS: Record<string, string> = {
  MTD: 'حتى تاريخه (MTD)',
  LIVE: 'حية (غير مقفلة)',
  FINALIZED: 'نهائية (مقفلة)',
};

const STRENGTH_LABELS: Record<string, string> = {
  STRONG: 'قوية',
  MODERATE: 'متوسطة',
  WEAK: 'ضعيفة',
  NEGLIGIBLE: 'ضئيلة',
};

// ── Formatting helpers (presentation only — no recomputation) ─

function fmtNum(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return UNAVAILABLE;
  const fixed = Number(value).toFixed(digits);
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function fmtSigned(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return UNAVAILABLE;
  const sign = value > 0 ? '+' : '';
  return `${sign}${fmtNum(value, digits)}`;
}

export function labelForNoteCode(code: string): string {
  return NOTE_CODE_LABELS[code] ?? code;
}

// ── View types ────────────────────────────────────────────────

export type AnalyticsViewKind =
  | 'READY'
  | 'UNAVAILABLE'
  | 'ERROR'
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
  | { kind: 'ERROR'; reason: string; message: string };

// ── Builder ───────────────────────────────────────────────────

export function buildAnalyticsView(api: AnalyticsApiResponse | undefined): AnalyticsView {
  if (!api) return { kind: 'IDLE' };
  if (api.status === 'ANALYTICS_UNAVAILABLE') {
    return { kind: 'UNAVAILABLE', reason: api.reason, message: api.message };
  }
  if (api.status === 'ANALYTICS_ERROR') {
    return { kind: 'ERROR', reason: api.reason, message: api.message };
  }

  const r = api.analytics;
  const trend = r.trendAnalysis;
  const stats = trend.stats;

  // §7 trend facts — every value verbatim.
  const trendFacts: KeyValueFact[] = [
    { label: 'أشهر متاحة', value: String(trend.availableMonths), unavailable: false },
    {
      label: 'المتوسط',
      value: stats ? fmtNum(stats.mean) : UNAVAILABLE,
      unavailable: !stats,
    },
    {
      label: 'الوسيط',
      value: stats ? fmtNum(stats.median) : UNAVAILABLE,
      unavailable: !stats,
    },
    {
      label: 'أدنى / أعلى',
      value: stats ? `${fmtNum(stats.min)} / ${fmtNum(stats.max)}` : UNAVAILABLE,
      unavailable: !stats,
    },
    {
      label: 'المدى',
      value: stats ? fmtNum(stats.range) : UNAVAILABLE,
      unavailable: !stats,
    },
    {
      label: 'الانحراف المعياري',
      value: stats ? fmtNum(stats.stdDev, 2) : UNAVAILABLE,
      unavailable: !stats,
    },
    {
      label: 'الميل الشهري',
      value: stats && stats.slopePerMonth !== null
        ? `${fmtSigned(stats.slopePerMonth, 2)} pp/شهر`
        : UNAVAILABLE,
      unavailable: !stats || stats.slopePerMonth === null,
    },
    {
      label: 'معامل الاختلاف',
      value: stats && stats.coefficientOfVariationPct !== null
        ? `${fmtNum(stats.coefficientOfVariationPct)}%`
        : UNAVAILABLE,
      unavailable: !stats || stats.coefficientOfVariationPct === null,
    },
  ];

  const anomalies: AnalyticsAnomalyView[] = r.anomalies.map((a) => ({
    title: anomalyTitle(a.anomalyType),
    metricLabel: METRIC_LABELS[a.metric] ?? a.metric,
    month: a.month ?? UNAVAILABLE,
    observedLabel: a.anomalyType === 'SCORE_DROP'
      ? `${fmtSigned(a.observedValue, 2)} pp`
      : fmtNum(a.observedValue, 0),
    rangeLabel: a.expectedRange.method === 'FIXED_THRESHOLD'
      ? `عتبة ثابتة: ≤ ${fmtNum(a.expectedRange.high, 0)}`
      : `النطاق المتوقع: ${fmtNum(a.expectedRange.low, 1)} – ${fmtNum(a.expectedRange.high, 1)}`,
    zLabel: a.zScore !== null ? `z = ${fmtNum(a.zScore, 2)}` : UNAVAILABLE,
    severity: {
      label: SEVERITY_LABELS[a.severity] ?? a.severity,
      tone: SEVERITY_TONES[a.severity] ?? 'warn',
    },
    confidence: {
      label: CONFIDENCE_LABELS[a.confidence] ?? a.confidence,
      tone: CONFIDENCE_TONES[a.confidence] ?? 'neutral',
    },
    noteLabel: labelForNoteCode(a.noteCode),
  }));

  const patterns: AnalyticsPatternView[] = r.crossDomainPatterns.map((p) => ({
    pairLabel: `${DOMAIN_LABELS[p.domainA] ?? p.domainA} × ${DOMAIN_LABELS[p.domainB] ?? p.domainB}`,
    monthsLabel: `تزامن ارتفاع في ${p.sharedIncreaseMonths.length} من ${p.monthsAnalyzed} أشهر: ${p.sharedIncreaseMonths.join('، ')}`,
    confidence: {
      label: CONFIDENCE_LABELS[p.confidence] ?? p.confidence,
      tone: CONFIDENCE_TONES[p.confidence] ?? 'neutral',
    },
    noteLabel: labelForNoteCode(p.noteCode),
  }));

  const correlations: AnalyticsCorrelationView[] = r.correlations.map((c) => ({
    pairLabel: `${DOMAIN_LABELS[c.variables[0]] ?? c.variables[0]} × ${DOMAIN_LABELS[c.variables[1]] ?? c.variables[1]}`,
    coefficientLabel: `r = ${fmtNum(c.coefficient, 3)}`,
    sampleLabel: `n = ${c.sampleSize}`,
    strengthLabel: STRENGTH_LABELS[c.strength] ?? c.strength,
    strengthTone: c.strength === 'STRONG' ? 'info' : 'neutral',
    confidence: {
      label: CONFIDENCE_LABELS[c.confidence] ?? c.confidence,
      tone: CONFIDENCE_TONES[c.confidence] ?? 'neutral',
    },
  }));

  const deltas: AnalyticsDeltaChipView[] = Object.entries(r.periodComparison.deltas)
    .map(([domain, delta]) => ({
      label: DOMAIN_LABELS[domain] ?? domain,
      text: fmtSigned(delta, 0),
      tone: delta > 0 ? 'warn' as Tone : delta < 0 ? 'good' as Tone : 'neutral' as Tone,
    }));

  const concentration = r.patternAnalysis.observations.byCategory.concentration
    .map((c) => ({
      label: c.label,
      text: `${c.count} من ${r.patternAnalysis.observations.byCategory.total} ملاحظة (${fmtNum(c.sharePct)}%)`,
    }));

  const gaps: AnalyticsGapView[] = r.dataQuality.insufficientSamples.map((s) => ({
    areaLabel: AREA_LABELS[s.area] ?? s.area,
    reasonLabel: REASON_LABELS[s.reason] ?? s.reason,
    detailLabel: s.detail
      ?? (s.required !== undefined
        ? `المطلوب ${s.required} — المتاح ${s.actual ?? UNAVAILABLE}`
        : ''),
  }));

  const noteLabels = Array.from(new Set([
    ...r.dataQuality.notes.map(labelForEngineNote),
    ...collectNoteCodes(r),
  ].filter(Boolean))) as string[];

  return {
    kind: 'READY',
    periodLabel: `${r.input.monthKey ?? UNAVAILABLE} — ${VALUE_BASIS_LABELS[r.input.valueBasis ?? ''] ?? r.input.valueBasis ?? UNAVAILABLE}`,
    overallConfidence: {
      label: CONFIDENCE_LABELS[r.overallConfidence] ?? r.overallConfidence,
      tone: CONFIDENCE_TONES[r.overallConfidence] ?? 'neutral',
    },
    trend: {
      statusLabel: trend.status === 'OK' ? 'إحصاءات الاتجاه' : 'بيانات الاتجاه غير كافية',
      facts: trendFacts,
      directionLabel: stats?.direction
        ? (DIRECTION_LABELS[stats.direction] ?? stats.direction)
        : UNAVAILABLE,
      confidence: {
        label: CONFIDENCE_LABELS[trend.confidence] ?? trend.confidence,
        tone: CONFIDENCE_TONES[trend.confidence] ?? 'neutral',
      },
      missingLabel: trend.missingMonths.length > 0
        ? `أشهر بدون نتيجة KPI (لا تُعدّ صفراً): ${trend.missingMonths.join('، ')}`
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

function anomalyTitle(anomalyType: string): string {
  if (anomalyType === 'SCORE_DROP') return 'هبوط حاد في درجة الجودة';
  if (anomalyType.endsWith('_COUNT_SPIKE')) {
    const prefix = anomalyType.replace('_COUNT_SPIKE', '');
    const domain = ANOMALY_TYPE_PREFIX[prefix] ?? prefix;
    return `ارتفاع غير معتاد في عدد ${domain}`;
  }
  return anomalyType;
}

/** Translate a handful of known engine note sentences; pass others through. */
function labelForEngineNote(note: string): string {
  if (note.startsWith('ARCHIVED_BUT_ELIGIBLE')) {
    return 'موظف مؤرشف حالياً — الفترة التاريخية الصالحة تبقى قابلة للتحليل دون أي نشاط مُختلق بعد الأرشفة.';
  }
  if (note.startsWith('ABSENT_MONTH_IS_ZERO_RECORDS')) {
    return NOTE_CODE_LABELS.ABSENT_MONTH_IS_ZERO_RECORDS;
  }
  if (note.startsWith('MTD_PARTIAL_MONTH')) {
    return NOTE_CODE_LABELS.MTD_PARTIAL_MONTH;
  }
  if (note.startsWith('Monthly records outside')) {
    return `سجلات شهرية خارج نافذة التحليل تم استبعادها (${note.split(':').slice(1).join(':').trim()})`;
  }
  return '';
}

function collectNoteCodes(r: import('@/lib/analytics/types').EmployeeAnalyticsResult): string[] {
  const codes = new Set<string>();
  const push = (code?: string | null) => {
    if (code && NOTE_CODE_LABELS[code]) codes.add(NOTE_CODE_LABELS[code]);
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
