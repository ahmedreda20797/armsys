// ══════════════════════════════════════════════════════════════
//  Quality AI — input builder (Phase 6.2, spec §9/§10)
//
//  Builds the STRUCTURED AI input from the VERIFIED sources only:
//    EmployeePerformanceDataset  (permission + scope already applied)
//  + EmployeeAnalyticsResult     (deterministic TypeScript engine)
//
//  HARD RULES (spec §9/§10/§29/§35):
//    • never a Firebase dump — compact, purpose-built payload only
//    • no employee NAME, no codes, no unrelated employees
//    • attendance is CONTEXT-ONLY and labelled as such
//    • every fact points at an evidence-catalog entry the AI may cite
//    • data sufficiency is computed HERE, deterministically — the AI
//      can never upgrade it (spec §2/§20/§56)
// ══════════════════════════════════════════════════════════════

import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence/types';
import type { EmployeeAnalyticsResult } from '@/lib/analytics/types';
import { formatMonthLabelAr } from '@/lib/month-label';

// ── payload contract ────────────────────────────────────────────

export interface QualityAIEvidenceCatalogEntry {
  /** Stable short id the AI cites (e.g. 'observations'). */
  refId: string;
  /** Canonical RTDB collection (real name — same as Evidence Preview). */
  collection: string;
  recordIds: string[];
  count: number;
  completeRecordList: true;
}

export interface QualityAIVerifiedFact {
  id: string;
  statement: string;
  value?: number;
  /** Which catalog entry proves this fact. */
  evidenceRefId: string;
}

export interface QualityAIAnalysisPayload {
  schemaVersion: 1;
  subject: { kind: 'employee'; employeeId: string };
  period: {
    from: string;
    to: string;
    label: string;
    mtd: boolean;
    finalized: boolean;
    valueBasis: string;
  };
  employee: {
    /** NO name, NO code — data minimization (spec §10/§31). */
    department: string | null;
    employmentStatus: string;
    eligibleForPeriod: boolean;
    archivedButEligible: boolean;
  };
  verifiedFacts: QualityAIVerifiedFact[];
  analytics: Record<string, unknown> | null;
  evidenceCatalog: QualityAIEvidenceCatalogEntry[];
  dataQuality: {
    windowMonths: string[];
    unattributedRecords: Array<{ collection: string; count: number }>;
    notes: string[];
  };
}

export type QualityAIInputOutcome =
  | { kind: 'READY'; payload: QualityAIAnalysisPayload; dataSufficiency: 'SUFFICIENT_DATA' | 'LIMITED_DATA' }
  | { kind: 'NO_DATA'; message: string }
  | { kind: 'INSUFFICIENT_DATA'; message: string }
  | { kind: 'ANALYTICS_ERROR'; reason: string };

// ── builder ─────────────────────────────────────────────────────

export function buildQualityAIAnalysisInput(
  dataset: EmployeePerformanceDataset,
  analytics: EmployeeAnalyticsResult | null,
  analyticsErrorReason: string | null,
): QualityAIInputOutcome {
  if (!analytics) {
    return {
      kind: 'ANALYTICS_ERROR',
      reason: analyticsErrorReason ?? 'ANALYTICS_UNAVAILABLE',
    };
  }

  const label = formatMonthLabelAr(dataset.period.monthKey);
  const month = dataset.period.monthKey;

  // ── §56 CASE A: nothing recorded anywhere → no AI call at all ──
  const observationsTotal = dataset.quality.observations.total;
  const hasAnyData =
    observationsTotal > 0 ||
    dataset.quality.deductions.count > 0 ||
    dataset.complaints.total > 0 ||
    dataset.capa.total > 0 ||
    dataset.followUps.total > 0 ||
    dataset.deals.total > 0;
  if (!hasAnyData) {
    return {
      kind: 'NO_DATA',
      message: `لا توجد بيانات مسجلة في ${label} — لا يوجد ما يمكن تحليله لهذه الفترة.`,
    };
  }

  // ── §56: zero observations in the period → the report's core
  // source is empty; a clear message beats a paid AI call.
  if (observationsTotal === 0) {
    return {
      kind: 'INSUFFICIENT_DATA',
      message: `لا توجد ملاحظات جودة مسجلة في ${label} — البيانات غير كافية حاليًا لإجراء التحليل الذكي.`,
    };
  }

  // ── Evidence catalog (only domains the dataset actually carries) ──
  const catalog: QualityAIEvidenceCatalogEntry[] = [];
  for (const ref of dataset.evidence.kpi) {
    catalog.push({
      refId: ref.collection === 'monthSnapshots' ? 'kpi_document' : 'kpi_scheme',
      collection: ref.collection,
      recordIds: ref.recordIds,
      count: ref.recordIds.length,
      completeRecordList: true,
    });
  }
  const domainRefs: Array<[string, { collection: string; recordIds: string[] } | null]> = [
    ['observations', dataset.evidence.observations],
    ['deductions', dataset.evidence.deductions],
    ['complaints', dataset.evidence.complaints],
    ['capa', dataset.evidence.capa],
    ['followUps', dataset.evidence.followUps],
    ['deals', dataset.evidence.deals],
    ['attendance', dataset.evidence.attendance],
  ];
  for (const [refId, ref] of domainRefs) {
    if (!ref) continue;
    catalog.push({
      refId,
      collection: ref.collection,
      recordIds: ref.recordIds,
      count: ref.recordIds.length,
      completeRecordList: true,
    });
  }

  // ── Verified facts (each traceable to a catalog entry) ──
  const facts: QualityAIVerifiedFact[] = [];
  const push = (
    id: string,
    statement: string,
    evidenceRefId: string,
    value?: number,
  ) => facts.push({ id, statement, evidenceRefId, ...(value !== undefined ? { value } : {}) });

  const kpi = dataset.kpi.quality;
  if (kpi && kpi.rawScore !== null) {
    push(
      'fact_kpi_score',
      `نتيجة الجودة الخام للفترة ${kpi.rawScore} من 100 بوزن ${kpi.weight}٪ ومساهمة مرجحة ${kpi.weightedContribution ?? 0} من أصل ${kpi.maxContribution}.`,
      'kpi_document',
      kpi.rawScore,
    );
  } else if (dataset.kpi.message) {
    push('fact_kpi_status', dataset.kpi.message, 'kpi_document');
  }

  const obs = dataset.quality.observations;
  push(
    'fact_observations_total',
    `تم تسجيل ${obs.total} ملاحظة خلال الفترة (${obs.approved} معتمدة، ${obs.pending} بانتظار الاعتماد، ${obs.rejected} مرفوضة).`,
    'observations',
    obs.total,
  );
  const severity = obs.bySeverity;
  const severityText = Object.entries(severity)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${severityAr(k)}: ${n}`)
    .join('، ');
  if (severityText) push('fact_observations_severity', `توزيع الخطورة — ${severityText}.`, 'observations');

  const topCategories = [...obs.byCategory].sort((a, b) => b.count - a.count).slice(0, 3);
  for (const c of topCategories) {
    push(
      `fact_obs_category_${c.categoryId ?? 'unclassified'}`,
      `التصنيف «${c.categoryName}» سُجلت له ${c.count} ملاحظة.`,
      'observations',
      c.count,
    );
  }

  const windowGroups = [...dataset.quality.repeatedIssues.windowByCategory]
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
    .slice(0, 3);
  for (const g of windowGroups) {
    push(
      `fact_repeated_${g.issueKey}`,
      `مشكلة متكررة «${g.label}» بحدوث ${g.occurrenceCount} مرة عبر ${g.monthsPresent} شهر مختلف من نافذة التحليل.`,
      'observations',
      g.occurrenceCount,
    );
  }

  const ded = dataset.quality.deductions;
  if (ded.count > 0) {
    push(
      'fact_deductions',
      `عدد خصومات الجودة ${ded.count} بإجمالي ${ded.totalDays} يوم و${ded.totalAmount} مبلغ.`,
      'deductions',
      ded.count,
    );
  }

  const complaints = dataset.complaints;
  if (complaints.total > 0) {
    push(
      'fact_complaints',
      `عدد الشكاوى ${complaints.total} (${complaints.resolvedOrClosed} محلولة/مغلقة، ${complaints.stillOpen} مفتوحة)${complaints.avgResolutionDays !== null ? ` بمتوسط حل ${complaints.avgResolutionDays} يوم` : ''}.`,
      'complaints',
      complaints.total,
    );
  }

  const capa = dataset.capa;
  if (capa.total > 0) {
    push(
      'fact_capa',
      `حالات CAPA: ${capa.total} (${capa.active} نشطة، ${capa.overdue} متأخرة${capa.avgOverdueDays !== null ? ` بمتوسط تأخير ${capa.avgOverdueDays} يوم` : ''}).`,
      'capa',
      capa.total,
    );
  }

  const fu = dataset.followUps;
  if (fu.total > 0) {
    push(
      'fact_followups',
      `المتابعات: ${fu.total} (${fu.overdue} متأخرة، ${fu.dueToday} مستحقة اليوم، نسبة الإنجاز ${fu.completionRate ?? 'غير متاح'}٪).`,
      'followUps',
      fu.total,
    );
  }

  const deals = dataset.deals;
  if (deals.total > 0) {
    push(
      'fact_deals',
      `صفقات السفر: ${deals.total} (${deals.completed} مكتملة، ${deals.canceled} ملغاة، نسبة الإنجاز ${deals.completionRate ?? 'غير متاح'}٪).`,
      'deals',
      deals.total,
    );
  }

  // §35: attendance stays CONTEXT-ONLY — explicitly labelled.
  const att = dataset.attendance;
  if (att.status === 'AVAILABLE' && att.result) {
    push(
      'fact_attendance_context',
      `سياق الحضور فقط (ليس جزءًا من KPI الجودة): أيام تأخير ${att.result.lateDays}، أيام غياب ${att.result.absentDays}، التزام ${att.result.compliance}٪.`,
      'attendance',
      att.result.compliance,
    );
  }

  // ── Compact deterministic-analytics digest (§29: engine owns numbers) ──
  const t = analytics.trendAnalysis;
  const obsPattern = analytics.patternAnalysis.observations;
  const analyticsDigest: Record<string, unknown> = {
    engine: 'typescript-analytics-engine',
    engineVersion: analytics.analyticsEngineVersion,
    deterministic: true,
    overallConfidence: analytics.overallConfidence,
    trend: {
      status: t.status,
      availableMonths: t.availableMonths,
      direction: t.stats?.direction ?? null,
      slopePerMonth: t.stats?.slopePerMonth ?? null,
      mean: t.stats?.mean ?? null,
      stdDev: t.stats?.stdDev ?? null,
      confidence: t.confidence,
      mtdPartial: t.mtdPartial,
    },
    observationsPattern: {
      total: obsPattern.total,
      approvalDistribution: obsPattern.approvalDistribution,
      monthlyCounts: obsPattern.monthlySeries,
      bySeverity: obsPattern.bySeverity,
      topCategories: obsPattern.byCategory.items.slice(0, 5),
    },
    repeatedIssues: {
      byCategory: analytics.patternAnalysis.repeatedIssues.byCategory.slice(0, 5),
      byType: analytics.patternAnalysis.repeatedIssues.byType.slice(0, 5),
      windowByCategory: analytics.patternAnalysis.repeatedIssues.windowByCategory.slice(0, 5),
    },
    deductions: {
      count: analytics.patternAnalysis.deductions.count,
      totalDays: analytics.patternAnalysis.deductions.totalDays,
      totalAmount: analytics.patternAnalysis.deductions.totalAmount,
    },
    complaints: {
      total: analytics.distributionAnalysis.complaints.total,
      resolution: analytics.distributionAnalysis.complaints.resolution,
    },
    capa: {
      total: analytics.distributionAnalysis.capa.total,
      active: analytics.distributionAnalysis.capa.active,
      overdueRatePct: analytics.distributionAnalysis.capa.overdueRatePct,
    },
    followUps: {
      total: analytics.distributionAnalysis.followUps.total,
      overdueRatePct: analytics.distributionAnalysis.followUps.overdueRatePct,
      completionRatePctEcho: analytics.distributionAnalysis.followUps.completionRatePctEcho,
    },
    deals: {
      total: analytics.distributionAnalysis.deals.total,
      cancellationRatePct: analytics.distributionAnalysis.deals.cancellationRatePct,
    },
    anomalies: analytics.anomalies.slice(0, 5).map((a) => ({
      anomalyType: a.anomalyType,
      metric: a.metric,
      month: a.month,
      observedValue: a.observedValue,
      expectedRange: a.expectedRange,
      direction: a.direction,
      severity: a.severity,
      confidence: a.confidence,
    })),
    crossDomainPatterns: analytics.crossDomainPatterns.slice(0, 3),
    correlations: analytics.correlations.slice(0, 3).map((c) => ({
      variables: c.variables,
      coefficient: c.coefficient,
      sampleSize: c.sampleSize,
      strength: c.strength,
      confidence: c.confidence,
      limitations: c.limitations,
    })),
    periodComparison: {
      status: analytics.periodComparison.status,
      deltas: analytics.periodComparison.deltas,
    },
  };

  // ── Data sufficiency (§2/§20/§69) — computed deterministically ──
  const limited =
    analytics.overallConfidence === 'INSUFFICIENT_DATA' ||
    analytics.overallConfidence === 'LOW' ||
    t.status === 'INSUFFICIENT_DATA';
  const dataSufficiency: 'SUFFICIENT_DATA' | 'LIMITED_DATA' = limited ? 'LIMITED_DATA' : 'SUFFICIENT_DATA';

  const payload: QualityAIAnalysisPayload = {
    schemaVersion: 1,
    subject: { kind: 'employee', employeeId: dataset.employee.employeeId },
    period: {
      from: month,
      to: month,
      label,
      mtd: !dataset.period.finalized,
      finalized: dataset.period.finalized,
      valueBasis: String(dataset.period.valueBasis),
    },
    employee: {
      department: dataset.employee.department,
      employmentStatus: dataset.employee.employmentStatus,
      eligibleForPeriod: dataset.employee.eligibleForPeriod,
      archivedButEligible: dataset.employee.archivedButEligible,
    },
    verifiedFacts: facts,
    analytics: analyticsDigest,
    evidenceCatalog: catalog,
    dataQuality: {
      windowMonths: dataset.dataQuality.windowMonths,
      unattributedRecords: dataset.dataQuality.unattributedRecords,
      notes: dataset.dataQuality.notes,
    },
  };

  return { kind: 'READY', payload, dataSufficiency };
}

function severityAr(key: string): string {
  switch (key) {
    case 'low': return 'منخفضة';
    case 'medium': return 'متوسطة';
    case 'high': return 'عالية';
    case 'critical': return 'حرجة';
    default: return key;
  }
}
