'use client';

// ══════════════════════════════════════════════════════════════
//  Employee 360 — Operations sections (rebuild)
//
//  Quality · Attendance · Follow-ups · Complaints/CAPA · HR
//  deductions · Requests. Every number is the canonical dataset's
//  own aggregate for the SELECTED period; every section shows its
//  data state honestly (no records ≠ zero ≠ no permission).
// ══════════════════════════════════════════════════════════════

import {
  Award, Banknote, ClipboardCheck, Clock, FileText, MessageSquareWarning, ShieldAlert, Eye,
} from 'lucide-react';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatMonthKey } from '@/lib/i18n/format';
import { useAppStore } from '@/lib/store';
import {
  SectionShell, MetricTile, EmptyState, scoreTone,
} from '@/components/pages/employee360/ui';
import type { Employee360Data } from '@/lib/employee-360/client-types';

function go(page: string, params?: Record<string, string>, highlightId?: string) {
  const store = useAppStore.getState();
  store.navigateTo(page, highlightId, params);
  store.closeEmployee360();
}

/* ═══ Quality ═══ */

export function QualitySection({ quality, periodLabel }: {
  quality: NonNullable<Employee360Data['quality']>;
  periodLabel: string;
}) {
  const obs = quality.observations;
  return (
    <SectionShell title={<T>الجودة</T>} icon={<Award className="size-4 text-brand-500" />} periodLabel={periodLabel}>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile
          big
          label={<T>درجة الجودة</T>}
          value={quality.score.state === 'value' && quality.score.rawScore !== null ? quality.score.rawScore : '—'}
          sub={quality.score.state === 'value'
            ? (quality.score.weight !== null ? <><T>الوزن</T> {quality.score.weight}%</> : null)
            : <T>لا توجد نتيجة بعد</T>}
          tone={scoreTone(quality.score.rawScore)}
        />
        <MetricTile big label={<T>الملاحظات</T>} value={obs.total} sub={<T>إجمالي الفترة</T>} />
        <MetricTile big label={<T>معتمدة</T>} value={obs.approved} tone="good" />
        <MetricTile big label={<T>قيد الاعتماد</T>} value={obs.pending} tone="warn" />
        <MetricTile big label={<T>خصومات (أيام)</T>} value={quality.deductions.totalDays} tone={quality.deductions.totalDays > 0 ? 'bad' : 'neutral'} />
        <MetricTile big label={<T>خصومات (مالي)</T>} value={quality.deductions.totalAmount} />
      </div>

      {quality.deductions.count === 0 && obs.total === 0 && (
        <EmptyState text={<T>لا توجد ملاحظات أو خصومات جودة في هذه الفترة</T>} />
      )}

      {/* Repeated issues — deterministic dataset grouping (min 2) */}
      {quality.repeatedIssues.byCategory.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground"><T>مشاكل متكررة داخل الفترة</T></p>
          <div className="flex flex-wrap gap-1.5">
            {quality.repeatedIssues.byCategory.map((g) => (
              <span key={g.issueKey} className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
                {g.label} ×{g.occurrenceCount}
              </span>
            ))}
          </div>
        </div>
      )}
    </SectionShell>
  );
}

/* ═══ Attendance (stored result — canonical) ═══ */

export function AttendanceSection({ attendance, periodLabel }: {
  attendance: NonNullable<Employee360Data['attendance']>;
  periodLabel: string;
}) {
  const r = attendance.result;
  return (
    <SectionShell title={<T>الحضور</T>} icon={<Clock className="size-4 text-brand-500" />} periodLabel={periodLabel}>
      {attendance.status !== 'AVAILABLE' || !r ? (
        <EmptyState text={<T>لم يتم إنشاء نتيجة حضور مخزنة لهذا الشهر — لا تُعاد الحسابات من السجلات الخام داخل الملف</T>} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <MetricTile big label={<T>نسبة الالتزام</T>} value={`${r.compliance}%`} tone={scoreTone(r.compliance)} />
            <MetricTile big label={<T>أيام حضور</T>} value={r.presentDays} tone="good" />
            <MetricTile big label={<T>أيام تأخير</T>} value={r.lateDays} tone={r.lateDays > 0 ? 'warn' : 'neutral'} sub={`${r.totalMinutesLate} د`} />
            <MetricTile big label={<T>أيام غياب</T>} value={r.absentDays} tone={r.absentDays > 0 ? 'bad' : 'neutral'} />
            <MetricTile big label={<T>أيام معفاة</T>} value={r.exemptDays} />
            <MetricTile big label={<T>أيام غير محتسبة</T>} value={r.unaccountedDays} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span><T>خصم أيام الحضور:</T> <span className="font-semibold text-foreground" dir="ltr">{r.attendanceDeductionDays}</span></span>
            <span><T>خصم التأخير:</T> <span className="font-semibold text-foreground" dir="ltr">{r.lateDeductionDays}</span></span>
            <span><T>خصم الغياب:</T> <span className="font-semibold text-foreground" dir="ltr">{r.absenceDeductionDays}</span></span>
            <span dir="ltr">engine: {r.engineVersion}</span>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground/80">
            <T>النتيجة المخزنة الشهرية (attendance-v1) — أصل الحضور القانوني، بلا إعادة حساب.</T>
          </p>
        </>
      )}
    </SectionShell>
  );
}

/* ═══ Follow-ups ═══ */

const FOLLOW_UP_STATUS_AR: Record<string, string> = {
  open: 'مفتوحة', under_review: 'تحت المراجعة', under_follow_up: 'تحت المتابعة',
  resolved: 'تمت', closed: 'مغلقة', cancelled: 'ملغاة',
};

export function FollowUpsSection({ followUps, employeeId, periodLabel }: {
  followUps: NonNullable<Employee360Data['followUps']>;
  employeeId: string;
  periodLabel: string;
}) {
  const statusEntries = Object.entries(followUps.byStatus);
  return (
    <SectionShell
      title={<T>المتابعات</T>}
      icon={<ClipboardCheck className="size-4 text-brand-500" />}
      periodLabel={periodLabel}
      actions={
        <button
          type="button"
          onClick={() => go('followUps', { employeeId })}
          className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
        >
          <T>فتح المتابعات</T>
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <MetricTile big label={<T>النشطة الآن</T>} value={followUps.active} tone={followUps.active > 0 ? 'brand' : 'neutral'} />
        <MetricTile big label={<T>متأخرة الآن</T>} value={followUps.overdue} tone={followUps.overdue > 0 ? 'bad' : 'neutral'} sub={<T>حسب تاريخ الاستحقاق</T>} />
        <MetricTile big label={<T>مستحقة اليوم</T>} value={followUps.dueToday} tone={followUps.dueToday > 0 ? 'warn' : 'neutral'} />
        <MetricTile big label={<T>منتهية</T>} value={followUps.completed} tone="good" />
        <MetricTile big label={<T>معدل الإنجاز</T>} value={followUps.completionRate !== null ? `${followUps.completionRate}%` : '—'} sub={followUps.total === 0 ? <T>لا متابعات</T> : undefined} />
        <MetricTile big label={<T>الإجمالي</T>} value={followUps.total} />
      </div>

      {followUps.total === 0 ? (
        <EmptyState text={<T>لا توجد متابعات في هذه الفترة</T>} />
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {statusEntries.map(([status, count]) => (
            <span key={status} className="rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
              {FOLLOW_UP_STATUS_AR[status] ?? status}: <span className="font-semibold text-foreground">{count}</span>
            </span>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

/* ═══ Complaints + CAPA ═══ */

export function ComplaintsCapaSection({ complaints, capa, employeeId, periodLabel }: {
  complaints: NonNullable<Employee360Data['complaints']>;
  capa: NonNullable<Employee360Data['capa']>;
  employeeId: string;
  periodLabel: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <SectionShell
        title={<T>الشكاوى</T>}
        icon={<MessageSquareWarning className="size-4 text-brand-500" />}
        periodLabel={periodLabel}
        actions={
          <button type="button" onClick={() => go('complaints', { employeeId })}
            className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
            <T>فتح الشكاوى</T>
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <MetricTile big label={<T>مفتوحة</T>} value={complaints.stillOpen} tone={complaints.stillOpen > 0 ? 'bad' : 'neutral'} />
          <MetricTile big label={<T>تمت / مغلقة</T>} value={complaints.resolvedOrClosed} tone="good" />
          <MetricTile big label={<T>الإجمالي</T>} value={complaints.total} />
          <MetricTile big label={<T>أنواع مكررة</T>} value={complaints.repeatedTypes.length} tone={complaints.repeatedTypes.length > 0 ? 'warn' : 'neutral'} />
        </div>
        {complaints.total === 0 && <EmptyState text={<T>لا شكاوى في هذه الفترة</T>} />}
      </SectionShell>

      <SectionShell
        title={<T>CAPA</T>}
        icon={<ShieldAlert className="size-4 text-brand-500" />}
        periodLabel={periodLabel}
        actions={
          <button type="button" onClick={() => go('capa', { employeeId })}
            className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
            <T>فتح CAPA</T>
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <MetricTile big label={<T>نشطة</T>} value={capa.active} tone={capa.active > 0 ? 'warn' : 'neutral'} />
          <MetricTile big label={<T>متأخرة</T>} value={capa.overdue} tone={capa.overdue > 0 ? 'bad' : 'neutral'} />
          <MetricTile big label={<T>منتهية</T>} value={capa.terminal} tone="good" />
          <MetricTile big label={<T>معاد فتحها</T>} value={countReopened(capa.byStatus)} />
        </div>
        {capa.total === 0 && <EmptyState text={<T>لا حالات CAPA في هذه الفترة</T>} />}
      </SectionShell>
    </div>
  );
}

function countReopened(byStatus: Record<string, number>): number {
  return byStatus.reopened ?? 0;
}

/* ═══ HR deductions ═══ */

export function HrDeductionsSection({ hr, monthKey }: {
  hr: NonNullable<Employee360Data['hrDeductions']>;
  monthKey: string;
}) {
  const { locale } = useLanguage();
  return (
    <SectionShell
      title={<T>خصومات الموارد البشرية</T>}
      icon={<Banknote className="size-4 text-brand-500" />}
      periodLabel={formatMonthKey(monthKey, locale)}
    >
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <MetricTile big label={<T>عدد الخصومات</T>} value={hr.deductionCount} tone={hr.deductionCount > 0 ? 'warn' : 'neutral'} />
        <MetricTile big label={<T>أيام خصم</T>} value={hr.deductionDays} tone={hr.deductionDays > 0 ? 'bad' : 'neutral'} />
        <MetricTile big label={<T>مبلغ مالي</T>} value={hr.deductionAmount} />
        <div className="rounded-xl border border-border/50 bg-muted/30 px-3.5 py-3">
          <p className="text-[11px] font-medium text-muted-foreground"><T>حسب الحالة</T></p>
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(hr.statusCounts).map(([status, count]) => (
              <span key={status} className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {status}: {count}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground/80">
        <T>سجلات الخصم المخزنة للفترة — كامل الحالات مشمولة، والأيام والمال منفصلان. لا تُعاد بناء الخصومات من ملاحظات أخرى.</T>
      </p>
    </SectionShell>
  );
}

/* ═══ Requests (period-scoped) ═══ */

export function RequestsSection({ requests, periodLabel }: {
  requests: NonNullable<Employee360Data['requests']>;
  periodLabel: string;
}) {
  return (
    <SectionShell title={<T>الطلبات</T>} icon={<FileText className="size-4 text-brand-500" />} periodLabel={periodLabel}>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <MetricTile big label={<T>الإجمالي</T>} value={requests.total} />
        <MetricTile big label={<T>معلقة</T>} value={requests.pending} tone={requests.pending > 0 ? 'warn' : 'neutral'} />
        <MetricTile big label={<T>مقبولة</T>} value={requests.approved} tone="good" />
        <MetricTile big label={<T>مرفوضة</T>} value={requests.rejected} tone="bad" />
      </div>
      {requests.total === 0 && <EmptyState text={<T>لا طلبات في هذه الفترة</T>} />}
    </SectionShell>
  );
}

/* ═══ Observations summary (own section gate) ═══ */

export function ObservationsSummarySection({ observations, employeeId, monthKey, periodLabel }: {
  observations: NonNullable<Employee360Data['quality']>['observations'];
  employeeId: string;
  monthKey: string;
  periodLabel: string;
}) {
  void employeeId; void monthKey;
  return (
    <SectionShell
      title={<T>ملاحظات الجودة</T>}
      icon={<Eye className="size-4 text-brand-500" />}
      periodLabel={periodLabel}
      actions={
        <button type="button" onClick={() => go('observations', { employeeId, month: monthKey })}
          className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
          <T>فتح الملاحظات</T>
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <MetricTile big label={<T>الإجمالي</T>} value={observations.total} />
        <MetricTile big label={<T>معتمدة</T>} value={observations.approved} tone="good" />
        <MetricTile big label={<T>قيد الاعتماد</T>} value={observations.pending} tone="warn" />
        <MetricTile big label={<T>مرفوضة</T>} value={observations.rejected} tone="bad" />
        <MetricTile
          big
          label={<T>حسب الخطورة (عالية/حرجة)</T>}
          value={(observations.bySeverity.high ?? 0) + (observations.bySeverity.critical ?? 0)}
          tone="warn"
        />
      </div>
      {observations.total === 0 && <EmptyState text={<T>لا ملاحظات جودة في هذه الفترة</T>} />}
    </SectionShell>
  );
}
