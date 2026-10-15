'use client';

// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — print model adapter
//
//  Projects the Hub dataset into the SHARED generic print model
//  (PrintReportModel) — no second print engine. The printed document
//  carries: identity (name/code/org), the period, the overview,
//  dimensions, changes, patterns, strengths/areas, recommendations,
//  risk/HR blocks (exactly what the viewer is authorized to see —
//  restricted blocks are already null server-side), the team
//  benchmark and the data-quality limitations. Navigation controls,
//  internal ids and technical metadata never print.
// ══════════════════════════════════════════════════════════════

import type { Locale } from '@/lib/i18n/dictionary';
import { formatInteger } from '@/lib/i18n/format';
import type { EmployeePerformanceHubDataset } from '@/lib/performance-hub';
import type { PrintReportModel, PrintSection } from '@/components/print/print-report-store';
import {
  HUB_OVERVIEW_STATUS,
  HUB_TERMS,
  pick,
} from './hub-labels';
import {
  buildBenchmarkRows,
  buildChangeRows,
  buildDataQualityRows,
  buildDimensionRows,
  buildEvidenceItems,
  buildOverviewReasons,
  buildPatternRows,
  buildRecommendationViews,
  buildTimelineRows,
  periodLabel,
  riskFactorLabel,
  riskLevelLabel,
} from './hub-view';

function statsOf(entries: Array<[string, string]>): Array<{ label: string; value: string }> {
  return entries.map(([label, value]) => ({ label, value }));
}

function evidenceLines(items: ReturnType<typeof buildEvidenceItems>): string[] {
  return items.map((item) => item.sentence);
}

export function performanceHubToPrintModel(
  dataset: EmployeePerformanceHubDataset,
  locale: Locale,
): PrintReportModel {
  const title = locale === 'en' ? 'Employee Performance Hub' : 'مركز أداء الموظف';
  const sections: PrintSection[] = [];

  // ── Overview ──
  const overview = dataset.overview;
  sections.push({
    heading: locale === 'en' ? 'Performance Overview' : 'ملخص الأداء',
    stats: statsOf([
      [locale === 'en' ? 'Current status' : 'الحالة الحالية', pick(locale, HUB_OVERVIEW_STATUS[overview.status] ?? [overview.status, overview.status])],
      [locale === 'en' ? 'Quality percentage' : 'نسبة الجودة', dataset.dimensions.find((d) => d.key === 'quality')?.value !== null && dataset.dimensions.find((d) => d.key === 'quality')?.value !== undefined ? `${dataset.dimensions.find((d) => d.key === 'quality')!.value}` : HUB_TERMS.unavailable[locale === 'en' ? 1 : 0]],
      [locale === 'en' ? 'Period' : 'الفترة', periodLabel(dataset.period.monthKey, locale)],
    ]),
    paragraphs: buildOverviewReasons(overview.reasons, locale),
  });

  // ── Dimensions ──
  const dimRows = buildDimensionRows(dataset, locale);
  sections.push({
    heading: locale === 'en' ? 'Performance Dimensions' : 'أبعاد الأداء',
    table: {
      columns: locale === 'en'
        ? ['Dimension', 'Status', 'Value', 'Previous', 'Change']
        : ['البُعد', 'الحالة', 'القيمة', 'السابق', 'التغير'],
      rows: dimRows.map((d) => [d.label, d.statusLabel, d.valueText, d.previousText ?? '—', d.deltaText ?? '—']),
    },
  });

  // ── Changes ──
  const changeRows = buildChangeRows(dataset.changes, locale);
  if (changeRows.length > 0) {
    sections.push({
      heading: locale === 'en' ? 'Why Performance Changed' : 'لماذا تغيّر الأداء',
      table: {
        columns: locale === 'en' ? ['Metric', 'Previous', 'Current', 'Change'] : ['المؤشر', 'السابق', 'الحالي', 'التغير'],
        rows: changeRows.map((r) => [r.label, r.previousText, r.currentText, r.deltaText]),
      },
    });
  } else {
    sections.push({
      heading: locale === 'en' ? 'Why Performance Changed' : 'لماذا تغيّر الأداء',
      paragraphs: [locale === 'en'
        ? 'No sufficient evidence to explain a change.'
        : 'لا توجد أدلة كافية لتفسير تغيّر في الأداء.'],
    });
  }

  // ── Cross-signals (association wording only) ──
  if (dataset.crossSignals.length > 0) {
    sections.push({
      heading: locale === 'en' ? 'Cross-Signal Analysis' : 'التحليل المتقاطع',
      paragraphs: dataset.crossSignals.map((s) =>
        locale === 'en'
          ? `Observed overlap between ${s.signals[0]} and ${s.signals[1]}.`
          : `تزامن ملحوظ بين ${s.signals[0]} و${s.signals[1]}.`,
      ),
    });
  }

  // ── Patterns ──
  const patternRows = buildPatternRows(dataset.patterns, locale);
  if (patternRows.length > 0) {
    sections.push({
      heading: locale === 'en' ? 'Patterns' : 'الأنماط',
      table: {
        columns: locale === 'en' ? ['Pattern', 'Domain', 'Label', 'Occurrences'] : ['النمط', 'المجال', 'البيان', 'التكرار'],
        rows: patternRows.map((p) => [p.kindLabel, p.domainLabel, p.label ?? '—', p.occurrencesText ?? '—']),
      },
    });
  }

  // ── Strengths / Areas to develop ──
  const strengths = buildEvidenceItems(dataset.strengths, locale);
  if (strengths.length > 0) {
    sections.push({ heading: locale === 'en' ? 'Strengths' : 'نقاط القوة', paragraphs: evidenceLines(strengths) });
  }
  const areas = buildEvidenceItems(dataset.developmentAreas, locale);
  if (areas.length > 0) {
    sections.push({ heading: locale === 'en' ? 'Areas to Develop' : 'جوانب للتطوير', paragraphs: evidenceLines(areas) });
  }

  // ── Recommendations ──
  const recommendations = buildRecommendationViews(dataset.recommendations, locale);
  if (recommendations.length > 0) {
    sections.push({
      heading: locale === 'en' ? 'Recommended Actions' : 'الإجراءات الموصى بها',
      paragraphs: recommendations.map((r) => r.text),
    });
  }

  // ── Risk (server-gated — prints only what the viewer may see) ──
  if (dataset.risk) {
    sections.push({
      heading: locale === 'en' ? 'Operational Risk' : 'المخاطر التشغيلية',
      stats: statsOf([
        [locale === 'en' ? 'Risk level' : 'مستوى المخاطر', riskLevelLabel(dataset.risk.level, locale) ?? dataset.risk.level],
        [locale === 'en' ? 'Risk score' : 'درجة المخاطر', String(dataset.risk.score)],
        [locale === 'en' ? 'Previous score' : 'الدرجة السابقة', dataset.risk.previousScore !== null ? String(dataset.risk.previousScore) : '—'],
      ]),
      table: dataset.risk.signals.length > 0
        ? {
            columns: locale === 'en' ? ['Signal', 'Count', 'Points'] : ['الإشارة', 'العدد', 'النقاط'],
            rows: dataset.risk.signals.map((s) => [riskFactorLabel(s.factor, locale) ?? s.factor, formatInteger(s.count, locale), formatInteger(s.points, locale)]),
          }
        : undefined,
      paragraphs: dataset.risk.signals.length === 0
        ? [locale === 'en' ? 'No active risk signals.' : 'لا توجد إشارات مخاطر نشطة.']
        : undefined,
    });
  }

  // ── HR (server-gated) ──
  if (dataset.hr?.current) {
    sections.push({
      heading: locale === 'en' ? 'HR Discipline' : 'انتظام الموارد البشرية',
      stats: statsOf([
        [locale === 'en' ? 'Deductions (current)' : 'الخصومات (الحالية)', formatInteger(dataset.hr.current.deductionCount, locale)],
        [locale === 'en' ? 'Deductions (previous)' : 'الخصومات (السابقة)', dataset.hr.previous ? formatInteger(dataset.hr.previous.deductionCount, locale) : '—'],
      ]),
    });
  }

  // ── Team benchmark ──
  const benchmarkRows = buildBenchmarkRows(dataset.teamBenchmark, locale);
  if (benchmarkRows.length > 0) {
    sections.push({
      heading: locale === 'en' ? `Team Benchmark — ${dataset.teamBenchmark?.teamName ?? ''}` : `المقارنة الفريقية — ${dataset.teamBenchmark?.teamName ?? ''}`,
      table: {
        columns: locale === 'en' ? ['Metric', 'Employee', 'Team Average', 'Difference', 'Rank'] : ['المؤشر', 'الموظف', 'متوسط الفريق', 'الفرق', 'الترتيب'],
        rows: benchmarkRows.map((r) => [r.label, r.employeeText, r.teamText, r.differenceText, r.rankText ?? '—']),
      },
    });
  }

  // ── Timeline (compact) ──
  const timelineRows = buildTimelineRows(dataset.timeline, locale);
  if (timelineRows.length > 0) {
    sections.push({
      heading: locale === 'en' ? 'Timeline' : 'السجل الزمني',
      table: {
        columns: locale === 'en' ? ['Date', 'Event', 'Title', 'Status'] : ['التاريخ', 'الحدث', 'البيان', 'الحالة'],
        rows: timelineRows.slice(0, 40).map((t) => [t.dateText, t.typeLabel, t.title || '—', t.statusLabel ?? '—']),
      },
    });
  }

  // ── Data quality ──
  const dqRows = buildDataQualityRows(dataset.dataQuality, locale);
  if (dqRows.length > 0) {
    sections.push({
      heading: locale === 'en' ? 'Data Quality' : 'جودة البيانات',
      table: {
        columns: locale === 'en' ? ['Domain', 'State', 'Note'] : ['المجال', 'الحالة', 'ملاحظة'],
        rows: dqRows.map((r) => [r.domainLabel, r.stateLabel, r.note ?? '—']),
      },
    });
  }

  return {
    title,
    identity: {
      name: dataset.employee.employeeName,
      code: dataset.employee.employeeCode,
      team: dataset.organizationContext.team,
      department: dataset.organizationContext.department,
      position: dataset.employee.position,
      manager: dataset.organizationContext.manager,
    },
    period: periodLabel(dataset.period.monthKey, locale),
    generatedAt: dataset.generatedAt,
    stats: statsOf([
      [locale === 'en' ? 'Status' : 'الحالة', pick(locale, HUB_OVERVIEW_STATUS[overview.status] ?? [overview.status, overview.status])],
    ]),
    sections,
    footerNote: locale === 'en'
      ? 'Official report — source: system database for the selected period. Values are shown as produced by the deterministic engines, with no estimation.'
      : 'تقرير رسمي — مصدر البيانات: قاعدة بيانات النظام للفترة المحددة. تُعرض القيم كما أنتجها المحركات الحتمية دون أي تقدير.',
  };
}
