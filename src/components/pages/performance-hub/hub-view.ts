'use client';

// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — view model (pure projection)
//
//  Turns the server dataset + locale into display rows. NO business
//  logic here: every value/label was already decided by the canonical
//  engines and the deterministic rule layer (lib/performance-hub).
//  This module only formats (locale numbers/dates) and resolves the
//  bilingual label tuples from ./hub-labels.
// ══════════════════════════════════════════════════════════════

import type { Locale } from '@/lib/i18n/dictionary';
import { formatInteger, formatMonthKey, formatPercentage } from '@/lib/i18n/format';
import type {
  EmployeePerformanceHubDataset,
  HubChangeItem,
  HubDataQualityItem,
  HubDimension,
  HubDomain,
  HubEvidenceItem,
  HubPattern,
  HubRecommendation,
  HubTimelineEvent,
  TeamBenchmarkBlock,
} from '@/lib/performance-hub';
import {
  HUB_BENCHMARK_METRICS,
  HUB_CHANGE_METRICS,
  HUB_DATA_QUALITY_NOTES,
  HUB_DQ_STATES,
  HUB_DOMAINS,
  HUB_EVIDENCE,
  HUB_DIMENSIONS,
  HUB_DIMENSION_METRICS,
  HUB_DIMENSION_STATUS,
  HUB_EMPLOYMENT_STATUS,
  HUB_EVENT_TYPES,
  HUB_OVERVIEW_REASONS,
  HUB_OVERVIEW_STATUS,
  HUB_PATTERNS,
  HUB_RECOMMENDATIONS,
  HUB_RISK_FACTORS,
  HUB_RISK_LEVELS,
  HUB_TERMS,
  TIMELINE_STATUS_LABELS,
  evidenceSentence,
  pick,
} from './hub-labels';

// ─────────────────────────────────────────────────────────────
//  Value formatting
// ─────────────────────────────────────────────────────────────

export function formatUnitValue(
  locale: Locale,
  unit: HubChangeItem['unit'] | 'plain',
  value: number | null | undefined,
): string {
  if (value === null || value === undefined) return '—';
  switch (unit) {
    case 'percent':
    case 'points':
    case 'score':
      return formatPercentage(value, { locale, maximumFractionDigits: 1 });
    case 'count':
    case 'days':
    case 'plain':
    default:
      return formatInteger(value, locale);
  }
}

export function formatSignedDelta(locale: Locale, delta: number | null, unit: HubChangeItem['unit']): string {
  if (delta === null) return '—';
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const magnitude = formatUnitValue(locale, unit, Math.abs(delta));
  return `${sign}${magnitude}`;
}

/** The headline value of one dimension (unit inferred from the metric key). */
export function dimensionValueText(locale: Locale, dim: HubDimension): string {
  if (dim.value === null) return pick(locale, HUB_TERMS.unavailable);
  switch (dim.metric) {
    case 'qualityPercent':
    case 'attendanceCompliance':
    case 'followUpCompletion':
      return formatPercentage(dim.value, { locale, maximumFractionDigits: 1 });
    case 'calculatedPoints':
      return locale === 'en' ? `${dim.value} pts` : `${dim.value} نقطة`;
    default:
      return formatInteger(dim.value, locale);
  }
}

// ─────────────────────────────────────────────────────────────
//  Dimensions
// ─────────────────────────────────────────────────────────────

export interface DimensionRowView {
  key: string;
  label: string;
  statusLabel: string;
  statusKey: string;
  valueText: string;
  metricLabel: string | null;
  previousText: string | null;
  deltaText: string | null;
  /** Semantic direction for color: good / bad / neutral (data, not opinion). */
  tone: 'good' | 'bad' | 'none';
}

const HIGHER_IS_BETTER: ReadonlySet<string> = new Set(['quality', 'followUp', 'attendance', 'businessOutput']);

export function buildDimensionRows(dataset: EmployeePerformanceHubDataset, locale: Locale): DimensionRowView[] {
  return dataset.dimensions.map((dim) => {
    const hasDelta = dim.delta !== null && dim.previousValue !== null && dim.delta !== 0;
    const improving = hasDelta && ((HIGHER_IS_BETTER.has(dim.key) && dim.delta! > 0) || (!HIGHER_IS_BETTER.has(dim.key) && dim.delta! < 0));
    return {
      key: dim.key,
      label: pick(locale, HUB_DIMENSIONS[dim.key] ?? [dim.key, dim.key]),
      statusLabel: pick(locale, HUB_DIMENSION_STATUS[dim.status] ?? [dim.status, dim.status]),
      statusKey: dim.status,
      valueText: dimensionValueText(locale, dim),
      metricLabel: dim.metric ? pick(locale, HUB_DIMENSION_METRICS[dim.metric] ?? [dim.metric, dim.metric]) : null,
      previousText: hasDelta ? dimensionValueText(locale, { ...dim, value: dim.previousValue }) : null,
      deltaText: hasDelta ? formatSignedDelta(locale, dim.delta, 'points') : null,
      tone: !hasDelta ? 'none' : improving ? 'good' : 'bad',
    };
  });
}

// ─────────────────────────────────────────────────────────────
//  Changes (§17)
// ─────────────────────────────────────────────────────────────

export interface ChangeRowView {
  key: string;
  label: string;
  previousText: string;
  currentText: string;
  deltaText: string;
  tone: 'good' | 'bad' | 'neutral';
}

export function buildChangeRows(changes: HubChangeItem[], locale: Locale): ChangeRowView[] {
  return changes.map((c) => {
    const tone: ChangeRowView['tone'] = c.direction === 'FLAT' || c.delta === 0
      ? 'neutral'
      : ((c.delta! > 0) === c.higherIsBetter ? 'good' : 'bad');
    return {
      key: c.key,
      label: pick(locale, HUB_CHANGE_METRICS[c.key] ?? [c.key, c.key]),
      previousText: formatUnitValue(locale, c.unit, c.previous),
      currentText: formatUnitValue(locale, c.unit, c.current),
      deltaText: formatSignedDelta(locale, c.delta, c.unit),
      tone,
    };
  });
}

// ─────────────────────────────────────────────────────────────
//  Evidence-backed sentences (strengths / concerns / areas)
// ─────────────────────────────────────────────────────────────

export interface EvidenceItemView {
  key: string;
  sentence: string;
  sources: HubEvidenceItem['sources'];
  values?: Record<string, number | null>;
}

export function buildEvidenceItems(items: HubEvidenceItem[], locale: Locale): EvidenceItemView[] {
  return items.map((item) => ({
    key: item.key,
    sentence: evidenceSentence(locale, item) ?? pick(locale, HUB_EVIDENCE[item.key] ?? [item.key, item.key]),
    sources: item.sources,
    values: item.values,
  }));
}

export function buildOverviewReasons(reasons: string[], locale: Locale): string[] {
  return reasons
    .map((r) => (HUB_OVERVIEW_REASONS[r] ? pick(locale, HUB_OVERVIEW_REASONS[r]) : null))
    .filter((s): s is string => Boolean(s));
}

export function overviewStatusLabel(status: string, locale: Locale): string {
  return pick(locale, HUB_OVERVIEW_STATUS[status] ?? [status, status]);
}

export function employmentStatusLabel(status: string | null, locale: Locale): string | null {
  if (!status) return null;
  const pair = HUB_EMPLOYMENT_STATUS[status];
  return pair ? pick(locale, pair) : null;
}

// ─────────────────────────────────────────────────────────────
//  Patterns (§15)
// ─────────────────────────────────────────────────────────────

export interface PatternRowView {
  id: string;
  kindLabel: string;
  kindKey: string;
  label: string | null;
  occurrencesText: string | null;
  domainLabel: string;
  sources: HubPattern['sources'];
}

const PATTERN_DOMAIN_LABELS: Partial<Record<HubDomain, readonly [string, string]>> = {
  quality: HUB_DOMAINS.quality,
  followUp: HUB_DOMAINS.followUp,
  deals: HUB_DOMAINS.deals,
  hr: HUB_DOMAINS.hr,
  attendance: HUB_DOMAINS.attendance,
};

export function buildPatternRows(patterns: HubPattern[], locale: Locale): PatternRowView[] {
  return patterns.map((p, i) => ({
    id: `${p.kind}:${p.domain}:${p.label ?? 'dim'}:${i}`,
    kindLabel: pick(locale, HUB_PATTERNS[p.kind] ?? [p.kind, p.kind]),
    kindKey: p.kind,
    label: p.label,
    occurrencesText: p.occurrences !== null && p.occurrences !== undefined ? formatInteger(p.occurrences, locale) : null,
    domainLabel: PATTERN_DOMAIN_LABELS[p.domain] ? pick(locale, PATTERN_DOMAIN_LABELS[p.domain]!) : '—',
    sources: p.sources,
  }));
}

// ─────────────────────────────────────────────────────────────
//  Recommendations (§21)
// ─────────────────────────────────────────────────────────────

export interface RecommendationView {
  key: string;
  text: string;
  rationale: EvidenceItemView[];
}

export function buildRecommendationViews(recommendations: HubRecommendation[], locale: Locale): RecommendationView[] {
  return recommendations.map((r) => ({
    key: r.key,
    text: pick(locale, HUB_RECOMMENDATIONS[r.key] ?? [r.key, r.key]),
    rationale: buildEvidenceItems(r.rationale, locale),
  }));
}

// ─────────────────────────────────────────────────────────────
//  Timeline (§11)
// ─────────────────────────────────────────────────────────────

export interface TimelineRowView {
  id: string;
  typeLabel: string;
  title: string;
  dateText: string;
  statusLabel: string | null;
  severityClass: string;
  source: HubTimelineEvent['source'];
}

const TIMELINE_SEVERITY_CLASS: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  low: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

export function buildTimelineRows(events: HubTimelineEvent[], locale: Locale): TimelineRowView[] {
  return events.map((e) => ({
    id: e.id,
    typeLabel: pick(locale, HUB_EVENT_TYPES[e.eventType] ?? [e.eventType, e.eventType]),
    title: e.title,
    dateText: e.displayDate,
    statusLabel: e.status && TIMELINE_STATUS_LABELS[e.status] ? pick(locale, TIMELINE_STATUS_LABELS[e.status]) : null,
    severityClass: e.severity ? (TIMELINE_SEVERITY_CLASS[e.severity] ?? TIMELINE_SEVERITY_CLASS.low) : '',
    source: e.source,
  }));
}

// ─────────────────────────────────────────────────────────────
//  Team benchmark (§14)
// ─────────────────────────────────────────────────────────────

export interface BenchmarkRowView {
  key: string;
  label: string;
  employeeText: string;
  teamText: string;
  differenceText: string;
  rankText: string | null;
  membersText: string;
  tone: 'good' | 'bad' | 'neutral';
}

export function buildBenchmarkRows(benchmark: TeamBenchmarkBlock | null, locale: Locale): BenchmarkRowView[] {
  if (!benchmark || benchmark.status !== 'AVAILABLE') return [];
  return benchmark.metrics.map((m) => {
    const isPercent = m.key === 'quality' || m.key === 'attendance' || m.key === 'followUpCompletion';
    const fmt = (v: number | null) =>
      v === null ? '—' : isPercent ? formatPercentage(v, { locale, maximumFractionDigits: 1 }) : formatInteger(v, locale);
    const difference = m.difference;
    const tone: BenchmarkRowView['tone'] = difference === null || difference === 0 ? 'neutral' : difference > 0 ? 'good' : 'bad';
    const diffText = difference === null ? '—' : `${difference > 0 ? '+' : difference < 0 ? '−' : ''}${fmt(Math.abs(difference))}`;
    return {
      key: m.key,
      label: pick(locale, HUB_BENCHMARK_METRICS[m.key] ?? [m.key, m.key]),
      employeeText: fmt(m.employeeValue),
      teamText: fmt(m.teamAverage),
      differenceText: diffText,
      rankText: m.rank !== null ? `#${m.rank}` : null,
      membersText: formatInteger(m.membersWithData, locale),
      tone,
    };
  });
}

// ─────────────────────────────────────────────────────────────
//  Data quality (§24)
// ─────────────────────────────────────────────────────────────

export interface DataQualityRowView {
  id: string;
  domainLabel: string;
  stateLabel: string;
  stateKey: string;
  note: string | null;
}

export function buildDataQualityRows(items: HubDataQualityItem[], locale: Locale): DataQualityRowView[] {
  return items.map((item, i) => ({
    id: `${item.domain}:${i}`,
    domainLabel: pick(locale, HUB_DOMAINS[item.domain] ?? [item.domain, item.domain]),
    stateLabel: pick(locale, HUB_DQ_STATES[item.state] ?? [item.state, item.state]),
    stateKey: item.state,
    note: item.note && HUB_DATA_QUALITY_NOTES[item.note] ? pick(locale, HUB_DATA_QUALITY_NOTES[item.note]) : null,
  }));
}

// ─────────────────────────────────────────────────────────────
//  Small label helpers
// ─────────────────────────────────────────────────────────────

export function periodLabel(monthKey: string, locale: Locale): string {
  return formatMonthKey(monthKey, locale);
}

export function riskLevelLabel(level: string | null, locale: Locale): string | null {
  if (!level) return null;
  const pair = HUB_RISK_LEVELS[level];
  return pair ? pick(locale, pair) : null;
}

export function riskFactorLabel(factor: string, locale: Locale): string | null {
  const pair = HUB_RISK_FACTORS[factor];
  return pair ? pick(locale, pair) : null;
}

export function dimensionLabel(key: string, locale: Locale): string {
  return pick(locale, HUB_DIMENSIONS[key] ?? [key, key]);
}
