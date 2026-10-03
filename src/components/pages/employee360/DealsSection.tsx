'use client';

// ══════════════════════════════════════════════════════════════
//  Employee 360 — Deal Performance (rebuild)
//
//  §DEAL-DATES semantics are the whole point of this section: every
//  metric is labeled with ITS OWN canonical date dimension and the
//  dimensions are never mixed:
//    DEAL_CLOSED (dealClosedAt)  → deals CLOSED WITH THE EMPLOYEE
//                                  (الصفقات المغلقة — any current status)
//    CLOSED      (closedAt)      → deals COMPLETED in the period
//                                  (تاريخ الاكتمال — completion metrics)
//    CREATED     (createdAt)     → intake activity for the period
//    TRAVEL      (departureDate) → travel volume for the period
//  Current-status counts (تعديل/جاري/مكتمل/ملغي) are the ALL-TIME
//  operational snapshot — independent of every date dimension.
//  Unknown dates (legacy records without dealClosedAt/closedAt) stay
//  "بتاريخ غير معروف" — never attributed to a month, never counted
//  into a period. Every number is a projection of the canonical
//  performance dataset (§13 — no page-side deal arithmetic).
// ══════════════════════════════════════════════════════════════

import { Plane } from 'lucide-react';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import {
  navigateToClosedDeals,
  navigateToCompletedDeals,
  navigateToCurrentDeals,
  navigateToClosureStatusDeals,
  navigateToTravelDeals,
} from '@/lib/employee-360/navigation';
import { SectionShell, MetricTile, DrillLink } from '@/components/pages/employee360/ui';
import type { Employee360Data } from '@/lib/employee-360/client-types';

export function DealsSection({ deals, employeeId, monthKey, periodLabel }: {
  deals: NonNullable<Employee360Data['deals']>;
  employeeId: string;
  monthKey: string;
  periodLabel: string;
}) {
  const { locale } = useLanguage();
  void locale;

  // §32/§35 CLOSURE-BREAKDOWN — the SAME period closure population
  // split by CURRENT status; the parts reconcile with the headline
  // (a September closure cancelled later is still a September closure).
  const breakdown = deals.closedWithEmployeeInPeriodByStatus;
  const stillActiveClosures = breakdown.upcoming + breakdown.in_progress;
  // §27 — the CURRENT-DEALS snapshot (upcoming + in_progress, all-time).
  const currentDeals = deals.statusAllTime.upcoming + deals.statusAllTime.in_progress;

  return (
    <SectionShell
      title={<T>الصفقات</T>}
      icon={<Plane className="size-4 text-brand-500" />}
      periodLabel={periodLabel}
    >
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {/* DEAL_CLOSED dimension — إجمالي الصفقات المغلقة (all-time history) */}
        <MetricTile
          big
          label={<T>إجمالي الصفقات المغلقة</T>}
          value={deals.closedWithEmployeeTotal}
          sub={<><T>تاريخ تقفيل الديل</T> · <T>كل الفترات</T></>}
          onClick={() => navigateToClosedDeals(employeeId)}
        />

        {/* DEAL_CLOSED dimension — closed with the employee IN the period */}
        <MetricTile
          big
          label={<T>مغلقة خلال الفترة</T>}
          value={deals.closedWithEmployeeInPeriod}
          sub={<><T>تاريخ تقفيل الديل</T> · {periodLabel}</>}
          onClick={() => navigateToClosedDeals(employeeId, monthKey)}
        />

        {/* CLOSED dimension — completed in the period (completion ≠ closure) */}
        <MetricTile
          big
          label={<T>مكتملة خلال الفترة</T>}
          value={deals.closedTotal}
          sub={<><T>تاريخ الاكتمال</T> · {periodLabel}</>}
          onClick={() => navigateToCompletedDeals(employeeId, monthKey)}
        />

        {/* TRAVEL dimension — operational volume */}
        <MetricTile
          big
          label={<T>رحلات غادرت (تاريخ السفر)</T>}
          value={deals.travelTotal}
          sub={<><T>تاريخ السفر</T> · {periodLabel}</>}
          onClick={() => navigateToTravelDeals(employeeId, monthKey)}
        />

        {/* §27 CURRENT DEALS — the current-status snapshot (upcoming +
            in_progress); a NOW question, never a date attribution */}
        <MetricTile
          big
          label={<T>الصفقات الحالية</T>}
          value={currentDeals}
          sub={<T>الحالة الحالية: تعديل + جاري</T>}
          onClick={() => navigateToCurrentDeals(employeeId)}
        />
      </div>

      {/* §32 CLOSURE-BREAKDOWN strip — the period's closure population
          split by current status; confirms + cancels + active reconcile */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-slate-500/10 px-2.5 py-1 text-slate-400 border border-slate-500/20">
          <T>تقفيلات الفترة: مؤكدة</T>: <span className="font-semibold tabular-nums">{breakdown.completed}</span>
        </span>
        <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-red-400 border border-red-500/20">
          <T>ملغاة بعد التقفيل</T>: <span className="font-semibold tabular-nums">{breakdown.canceled}</span>
        </span>
        <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-400 border border-amber-500/20">
          <T>ما تزال جارية</T>: <span className="font-semibold tabular-nums">{stillActiveClosures}</span>
        </span>
        {/* All-time current-status strip — تعديل / جاري / ملغي */}
        <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-blue-400 border border-blue-500/20">
          <T>التعديل</T>: <span className="font-semibold tabular-nums">{deals.statusAllTime.upcoming}</span>
        </span>
        <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-400 border border-amber-500/20">
          <T>الجاري</T>: <span className="font-semibold tabular-nums">{deals.statusAllTime.in_progress}</span>
        </span>
        <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-red-400 border border-red-500/20">
          <T>الملغي</T>: <span className="font-semibold tabular-nums">{deals.statusAllTime.canceled}</span>
        </span>
        <span className="rounded-full bg-slate-500/10 px-2.5 py-1 text-slate-400 border border-slate-500/20">
          <T>صفقات مُنشأة (تاريخ الإنشاء)</T>: <span className="font-semibold tabular-nums">{deals.createdTotal}</span>
        </span>
      </div>

      {/* Unknown dates — surfaced, never attributed (legacy records) */}
      {deals.closedWithEmployeeUnknownMonth > 0 && (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {deals.closedWithEmployeeUnknownMonth} <T>صفقة بتاريخ تقفيل غير معروف (أرشيفية) — لا تُنسب لأي شهر في مقاييس الفترة.</T>
        </p>
      )}
      {deals.closedUnknownMonth > 0 && (
        <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {deals.closedUnknownMonth} <T>صفقة مكتملة بتاريخ اكتمال غير معروف (أرشيفية) — لا تُنسب لأي شهر ولا تُحتسب في فترة التقرير.</T>
        </p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <p className="text-[10px] leading-relaxed text-muted-foreground/80">
          <T>كل بعد زمني مستقل: التقفيل، الاكتمال، الإنشاء، السفر — لا بُعد يعوّض آخر، والحالة الحالية مقياس منفصل.</T>
        </p>
        <DrillLink onClick={() => navigateToTravelDeals(employeeId)} label={<T>فتح قائمة السفر</T>} />
      </div>
    </SectionShell>
  );
}
