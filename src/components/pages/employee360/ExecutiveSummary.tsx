'use client';

// ══════════════════════════════════════════════════════════════
//  Employee 360 — Executive Summary strip (rebuild)
//
//  The manager's first screen: PERFORMANCE / QUALITY / PRODUCTION /
//  DISCIPLINE / DECISION in one compact strip. Every value is a
//  canonical view-model field — states are explicit (pending /
//  configuration required / not available), never 0-filled.
// ══════════════════════════════════════════════════════════════

import { motion } from 'framer-motion';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { navigateToClosedDeals } from '@/lib/employee-360/navigation';
import { MetricTile, scoreTone } from '@/components/pages/employee360/ui';
import type { Employee360Data } from '@/lib/employee-360/client-types';

const KPI_ROW_STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'متاح',
  INCOMPLETE: 'بيانات غير مكتملة',
  PENDING: 'قيد الانتظار',
  NOT_ELIGIBLE: 'غير مشمول بالفترة',
  NO_SCHEME: 'لا يوجد مخطط تقييم مُعد',
  AMBIGUOUS: 'تعدد مخططات — يتطلب إعداداً',
  OVERRIDE_NOT_RESOLVABLE: 'تجاوز الموظف غير قابل للحل',
  FROZEN_RESULT: 'نتيجة مثبتة',
  DERIVED: 'مشتق من أرشيف',
  LIVE: 'مباشر',
};

const DECISION_TONE: Record<string, 'good' | 'warn' | 'bad'> = {
  STABLE: 'good',
  IMPROVING: 'good',
  NEEDS_COACHING: 'warn',
  PERFORMANCE_IMPROVEMENT_REVIEW: 'bad',
  MANAGEMENT_REVIEW: 'bad',
};

export function ExecutiveSummary({ data, monthKey, employeeId }: {
  data: NonNullable<Employee360Data['executiveSummary']>;
  monthKey: string;
  employeeId: string;
}) {
  const overall = data.overall;
  const overallValue =
    overall.state === 'value' && overall.weightedTotal !== null
      ? `${overall.weightedTotal}`
      : null;
  const overallTone =
    overall.state === 'value' && overall.weightedTotal !== null
      ? scoreTone(overall.weightedTotal)
      : 'neutral';
  const partialWeight = overall.availableWeight !== null && overall.availableWeight < 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 26, delay: 0.05 }}
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6"
    >
      {/* Overall evaluation — the engine's weighted total of the available set */}
      <MetricTile
        big
        label={<><T>التقييم العام</T>{overall.state === 'value' && partialWeight ? ` (${overall.availableWeight}%)` : ''}</>}
        value={overallValue ?? <span className="text-sm font-semibold text-muted-foreground">—</span>}
        sub={
          overall.state === 'value'
            ? (KPI_ROW_STATUS_LABELS[overall.rowStatus] ?? overall.rowStatus)
            : overall.state === 'not_eligible'
              ? <T>غير مشمول بهذه الفترة</T>
              : overall.state === 'pending'
                ? <T>لا توجد نتيجة لهذه الفترة بعد</T>
                : <T>يتطلب إعداد مخطط التقييم</T>
        }
        tone={overallTone}
      />

      {/* Quality raw score (with its configured weight) */}
      <MetricTile
        big
        label={<T>الجودة</T>}
        value={data.qualityScore.state === 'value' && data.qualityScore.rawScore !== null
          ? data.qualityScore.rawScore
          : <span className="text-sm font-semibold text-muted-foreground">—</span>}
        sub={data.qualityScore.state === 'value'
          ? data.qualityScore.weight !== null
            ? <><T>الوزن</T> {data.qualityScore.weight}%</>
            : null
          : <T>لا توجد نتيجة جودة بعد</T>}
        tone={scoreTone(data.qualityScore.rawScore)}
      />

      {/* §DEAL-DATES — "الصفقات المغلقة" = closed WITH the employee
          (dealClosedAt) during the period, any current status. The
          completion count (closedAt) is the separate completedInPeriod
          fact shown as context — the two meanings never merge. */}
      <MetricTile
        big
        label={<T>صفقات مغلقة</T>}
        value={data.closedDeals.count}
        sub={data.closedDeals.unknownClosure > 0
          ? <><T>+</T>{data.closedDeals.unknownClosure}<T> بتاريخ تقفيل غير معروف</T>{data.closedDeals.completedInPeriod > 0 ? <> · {data.closedDeals.completedInPeriod}<T> مكتملة</T></> : null}</>
          : <><T>تقفيل الديل</T>{data.closedDeals.completedInPeriod > 0 ? <> · {data.closedDeals.completedInPeriod}<T> مكتملة</T></> : null}</>}
        onClick={() => navigateToClosedDeals(employeeId, monthKey)}
      />

      {/* Attendance — stored monthly result (NOT_AVAILABLE is explicit) */}
      <MetricTile
        big
        label={<T>الالتزام بالحضور</T>}
        value={data.attendance.state === 'available' && data.attendance.compliance !== null
          ? `${data.attendance.compliance}%`
          : <span className="text-sm font-semibold text-muted-foreground">—</span>}
        sub={data.attendance.state === 'available'
          ? <T>نتيجة مخزنة</T>
          : <T>لم تُنشأ نتيجة حضور لهذا الشهر</T>}
        tone={scoreTone(data.attendance.compliance)}
      />

      {/* Follow-up discipline */}
      <MetricTile
        big
        label={<T>المتابعات النشطة</T>}
        value={data.followUps.active}
        sub={data.followUps.overdue > 0
          ? <span className="font-semibold text-red-600 dark:text-red-400">{data.followUps.overdue}<T> متأخرة</T></span>
          : <T>لا متابعات متأخرة</T>}
        tone={data.followUps.overdue > 0 ? 'bad' : 'neutral'}
      />

      {/* Decision-support status (canonical vocabulary, no termination language) */}
      <MetricTile
        big
        label={<T>دعم القرار</T>}
        value={data.decisionStatus
          ? <span className="text-sm font-bold leading-snug">{data.decisionStatus.label}</span>
          : <span className="text-sm font-semibold text-muted-foreground">—</span>}
        sub={data.decisionStatus ? undefined : <T>غير متاح لهذه الفترة</T>}
        tone={data.decisionStatus ? DECISION_TONE[data.decisionStatus.status] ?? 'neutral' : 'neutral'}
      />
    </motion.div>
  );
}
