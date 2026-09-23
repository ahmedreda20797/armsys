'use client';

// ══════════════════════════════════════════════════════════════
//  Employee 360 — Scoped Performance History Section (Milestone 5)
//
//  First consumer of the shared Time-Scope + Performance-History
//  contract. Every value below comes from the stored-results
//  reader /api/employee-performance/[employeeId]:
//
//    • الشهر الحالي — the current month's OWN stored results only
//      (nulls shown explicitly; history is never promoted).
//    • السجل الشهري — stored monthly results for earlier months,
//      with the shared TimeScope selector (no second range system).
//    • المسار الوظيفي (كل الفترات) — career aggregations DERIVED
//      from stored monthly results (never a new counter/trend).
//    • تطور الأداء — the historical monthly progression, exactly
//      as stored (no scoring system, no final KPI — future work).
//
//  Domains stay attributable: الحضور (نتائج الحضور المخزنة),
//  الجودة (لقطة الشهر المخزنة), خصومات HR (مجال مستقل).
// ══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Award, Banknote, CalendarDays, Clock, History, Loader2, TrendingUp } from 'lucide-react';
import { authFetch } from '@/lib/api-fetch';
import { generateMonthOptions } from '@/lib/date-utils';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatMonthKey } from '@/lib/i18n/format';

// ─── Types (response of /api/employee-performance/[employeeId]) ───

interface AttendanceMonthSummary {
  month: string;
  compliance: number;
  workDays: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  exemptDays: number;
  unaccountedDays: number;
  lateDeductionDays: number;
  absenceDeductionDays: number;
  attendanceDeductionDays: number;
  engineVersion: string;
  generatedAt: string;
}

interface QualityMonthSummary {
  month: string;
  score: number;
  deductionPoints: number;
  bonusPoints: number;
  observationCount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  rank: number | null;
  snapshotStatus: 'open' | 'closed';
  generatedAt: string | null;
}

interface HrMonthSummary {
  month: string;
  deductionCount: number;
  deductionDays: number;
  deductionAmount: number;
  statusCounts: Record<string, number>;
}

interface MonthRow {
  month: string;
  attendance: AttendanceMonthSummary | null;
  quality: QualityMonthSummary | null;
  hr: HrMonthSummary | null;
}

interface CareerPoint<T> { month: string; value: number; result: T }

interface CareerSummary<T> {
  sampleSize: number;
  firstMonth: string | null;
  lastMonth: string | null;
  bestMonth: CareerPoint<T> | null;
  worstMonth: CareerPoint<T> | null;
  averageValue: number | null;
  monthOverMonthDeltas: { month: string; delta: number }[];
}

interface PerformanceResponse {
  employeeId: string;
  scope: { kind: string; label: string; describe: string; months: string[] | null };
  currentMonthKey: string;
  current: MonthRow;
  history: MonthRow[];
  career: {
    attendance: CareerSummary<never>;
    quality: CareerSummary<never>;
    hr: CareerSummary<never>;
  };
}

type ScopeKind =
  | 'career' | 'current_month' | 'previous_month' | 'selected_month'
  | 'last_3_months' | 'last_6_months' | 'current_year';

// ─── Helpers ───


function scoreColor(value: number): string {
  if (value >= 90) return 'text-emerald-400';
  if (value >= 75) return 'text-yellow-400';
  if (value >= 60) return 'text-orange-400';
  return 'text-red-400';
}

function scoreBarColor(value: number): string {
  if (value >= 90) return 'bg-emerald-500';
  if (value >= 75) return 'bg-yellow-500';
  if (value >= 60) return 'bg-orange-500';
  return 'bg-red-500';
}

const SCOPE_OPTIONS: { kind: ScopeKind; label: string }[] = [
  { kind: 'career', label: 'المسار الوظيفي (كل الفترات)' },
  { kind: 'current_month', label: 'الشهر الحالي' },
  { kind: 'previous_month', label: 'الشهر السابق' },
  { kind: 'last_3_months', label: 'آخر 3 أشهر' },
  { kind: 'last_6_months', label: 'آخر 6 أشهر' },
  { kind: 'current_year', label: 'السنة الحالية' },
];

const NO_DATA = 'لا توجد بيانات';
const NO_ATTENDANCE_RESULT = 'لم يتم إنشاء نتيجة الحضور لهذا الشهر';

// ─── Sub-components ───

function DomainCard({ title, icon, scopeLabel, children }: {
  title: string;
  icon: React.ReactNode;
  scopeLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="bg-slate-800/40 border border-slate-700/30 backdrop-blur-sm">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-white text-sm font-semibold flex items-center gap-2">{icon}{title}</h4>
          <span className="text-[10px] text-slate-500 border border-slate-700/40 rounded-md px-1.5 py-0.5">{scopeLabel}</span>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-slate-500 text-xs py-2">{text}</p>;
}

/** One career summary mini-card (derived, stored-history only). */
function CareerSummaryCard({ title, icon, career, unit, valueLabel, worstLabel }: {
  title: string;
  icon: React.ReactNode;
  career: CareerSummary<never>;
  unit: string;
  valueLabel: string;
  worstLabel: string;
}) {
  const { locale } = useLanguage();
  return (
    <Card className="bg-slate-800/40 border border-slate-700/30">
      <CardContent className="p-4 space-y-2.5">
        <h4 className="text-white text-sm font-semibold flex items-center gap-2">{icon}{title}</h4>
        {career.sampleSize === 0 ? (
          <EmptyState text={translateUIText('لا توجد نتائج شهرية مخزنة بعد', locale)} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-700/20 border border-slate-700/20 rounded-lg p-2">
                <p className="text-slate-500 text-[10px] mb-0.5"><T>عدد الشهور الموثقة</T></p>
                <p className="text-white font-bold">{career.sampleSize}</p>
              </div>
              <div className="bg-slate-700/20 border border-slate-700/20 rounded-lg p-2">
                <p className="text-slate-500 text-[10px] mb-0.5"><T>الفترة</T></p>
                <p className="text-white font-bold text-[11px]" dir="ltr">
                  {career.firstMonth} ← {career.lastMonth}
                </p>
              </div>
              {career.averageValue !== null && (
                <div className="bg-slate-700/20 border border-slate-700/20 rounded-lg p-2">
                  <p className="text-slate-500 text-[10px] mb-0.5"><T>المتوسط الشهري</T></p>
                  <p className="text-white font-bold">{career.averageValue}{unit}</p>
                </div>
              )}
              {career.bestMonth && (
                <div className="bg-slate-700/20 border border-slate-700/20 rounded-lg p-2">
                  <p className="text-slate-500 text-[10px] mb-0.5">{valueLabel}</p>
                  <p className="text-white font-bold">
                    {career.bestMonth.value}{unit}
                    <span className="text-slate-500 font-normal text-[10px] mr-1" dir="ltr">{career.bestMonth.month}</span>
                  </p>
                </div>
              )}
              {career.worstMonth && (
                <div className="bg-slate-700/20 border border-slate-700/20 rounded-lg p-2">
                  <p className="text-slate-500 text-[10px] mb-0.5">{worstLabel}</p>
                  <p className="text-white font-bold">
                    {career.worstMonth.value}{unit}
                    <span className="text-slate-500 font-normal text-[10px] mr-1" dir="ltr">{career.worstMonth.month}</span>
                  </p>
                </div>
              )}
              <div className="bg-slate-700/20 border border-slate-700/20 rounded-lg p-2">
                <p className="text-slate-500 text-[10px] mb-0.5"><T>التغير الشهري الأخير</T></p>
                {career.monthOverMonthDeltas.length === 0 ? (
                  <p className="text-slate-500 font-bold text-[11px]"><T>لا يوجد اتجاه بعد (يتطلب شهرين)</T></p>
                ) : (
                  <p className="text-white font-bold" dir="ltr">
                    {(() => {
                      const last = career.monthOverMonthDeltas[career.monthOverMonthDeltas.length - 1];
                      const sign = last.delta > 0 ? '+' : '';
                      const color = last.delta > 0 ? 'text-emerald-400' : last.delta < 0 ? 'text-red-400' : 'text-slate-400';
                      return <span className={color}>{sign}{last.delta}</span>;
                    })()}
                    <span className="text-slate-500 font-normal text-[10px]"> ({career.monthOverMonthDeltas[career.monthOverMonthDeltas.length - 1].month})</span>
                  </p>
                )}
              </div>
            </div>
            <p className="text-slate-600 text-[10px]">مشتق من النتائج الشهرية المخزنة — {career.sampleSize < 2 ? 'لا يُستنتج اتجاه من أقل من شهرين' : `${career.monthOverMonthDeltas.length} تغيّر شهري موثّق`}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Historical monthly progression of one stored value — display only, no scoring (spec §19). */
function DevelopmentBars({ title, points, unit }: {
  title: string;
  points: { month: string; value: number }[];
  unit: string;
}) {
  const { locale } = useLanguage();
  if (points.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-slate-400 text-xs font-medium">{title}</p>
      <div className="space-y-1.5">
        {points.map((point) => (
          <div key={point.month} className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 w-24 flex-shrink-0" dir="ltr">{formatMonthKey(point.month, locale)}</span>
            <div className="flex-1 h-2.5 rounded-full bg-slate-700/40 overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${scoreBarColor(point.value)}`}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(Math.max(point.value, 0), 100)}%` }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <span className={`font-bold w-14 text-left flex-shrink-0 ${scoreColor(point.value)}`} dir="ltr">{point.value}{unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Section ───

export function EmployeePerformanceSection({ employeeId }: { employeeId: string }) {
  const { locale } = useLanguage();
  const [scopeKind, setScopeKind] = useState<ScopeKind>('career');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => generateMonthOptions('YYYY-MM')[1] ?? '');
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPerformance = useCallback(async () => {
    if (!employeeId) return;
    try {
      const params = new URLSearchParams({ scope: scopeKind });
      if (scopeKind === 'selected_month' && selectedMonth) params.set('month', selectedMonth);
      const res = await authFetch(`/api/employee-performance/${employeeId}?${params.toString()}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        setError(errData?.error || 'فشل تحميل سجل الأداء');
        return;
      }
      setData(await res.json());
      setError(null);
    } catch {
      setError('خطأ في الاتصال بالخادم');
    }
  }, [employeeId, scopeKind, selectedMonth]);

  useEffect(() => {
    let active = true;
    (async () => {
      await fetchPerformance();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [fetchPerformance]);

  /** Scope changes raise the loading flag in the handler (event-driven), not in the effect. */
  const changeScope = (kind: ScopeKind) => {
    setLoading(true);
    setScopeKind(kind);
  };

  const changeSelectedMonth = (month: string) => {
    setLoading(true);
    setSelectedMonth(month);
  };

  const monthOptions = generateMonthOptions('YYYY-MM');

  // ─── Loading / error states ───
  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64 rounded-lg bg-slate-800/60" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Skeleton className="h-36 rounded-xl bg-slate-800/40" />
          <Skeleton className="h-36 rounded-xl bg-slate-800/40" />
          <Skeleton className="h-36 rounded-xl bg-slate-800/40" />
        </div>
        <Skeleton className="h-56 rounded-xl bg-slate-800/40" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="bg-slate-800/40 border border-slate-700/30">
        <CardContent className="p-5 flex items-center justify-between">
          <p className="text-slate-400 text-sm">{error || 'لا توجد بيانات'}</p>
          <button
            onClick={fetchPerformance}
            className="text-emerald-400 hover:text-emerald-300 text-sm flex items-center gap-1"
          >
            <Loader2 className="size-3.5" /> إعادة المحاولة
          </button>
        </CardContent>
      </Card>
    );
  }

  const { current, history, career } = data;
  const currentScopeLabel = translateUIText('الشهر الحالي — ', locale) + formatMonthKey(data.currentMonthKey, locale);

  // Chronological stored series for the development view (oldest → newest,
  // current month appended only when its own stored result exists).
  const attendanceSeries = [
    ...[...history].reverse().filter((row) => row.attendance).map((row) => ({ month: row.month, value: row.attendance!.compliance })),
    ...(current.attendance ? [{ month: current.month, value: current.attendance.compliance }] : []),
  ];
  const qualitySeries = [
    ...[...history].reverse().filter((row) => row.quality).map((row) => ({ month: row.month, value: row.quality!.score })),
    ...(current.quality ? [{ month: current.month, value: current.quality!.score }] : []),
  ];

  return (
    <div className="space-y-5">
      {/* ═══ A. Current Month Overview (الشهر الحالي) ═══ */}
      <Card className="bg-slate-800/40 border border-slate-700/30 backdrop-blur-sm">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <CalendarDays className="size-4 text-emerald-400" />
              </div>
              <T>نظرة الشهر الحالي</T>
            </h3>
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/5 text-xs rounded-lg">
              {currentScopeLabel}
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Attendance — stored canonical result */}
            <DomainCard title={translateUIText('الحضور', locale)} icon={<Clock className="size-4 text-emerald-400" />} scopeLabel={translateUIText('الشهر الحالي', locale)}>
              {current.attendance ? (
                <>
                  <p className={`text-2xl font-bold ${scoreColor(current.attendance.compliance)}`}>
                    {current.attendance.compliance}%
                    <span className="text-slate-500 text-xs font-normal mr-1.5"><T>نسبة الالتزام</T></span>
                  </p>
                  <div className="text-xs text-slate-400 space-y-1">
                    <p><T>مؤشر أداء الحضور (KPI): </T><span className="text-white font-semibold">{current.attendance.compliance} / 100</span></p>
                    <p><T>خصم أيام الحضور: </T><span className="text-white font-semibold">{current.attendance.attendanceDeductionDays}</span><T> يوم</T></p>
                    <p>حضور {current.attendance.presentDays} · تأخير {current.attendance.lateDays} · غياب {current.attendance.absentDays}</p>
                  </div>
                </>
              ) : (
                <EmptyState text={NO_ATTENDANCE_RESULT} />
              )}
            </DomainCard>

            {/* Quality — stored month snapshot entry */}
            <DomainCard title={translateUIText('الجودة', locale)} icon={<Award className="size-4 text-orange-400" />} scopeLabel={translateUIText('الشهر الحالي', locale)}>
              {current.quality ? (
                <>
                  <p className={`text-2xl font-bold ${scoreColor(current.quality.score)}`}>
                    {current.quality.score}
                    <Badge variant="outline" className={`text-[10px] px-1.5 mr-2 rounded-md ${
                      current.quality.snapshotStatus === 'closed'
                        ? 'border-slate-500/40 text-slate-400'
                        : 'border-yellow-500/40 text-yellow-400 bg-yellow-500/5'
                    }`}>
                      {current.quality.snapshotStatus === 'closed' ? 'لقطة مغلقة' : 'لقطة مفتوحة'}
                    </Badge>
                  </p>
                  <div className="text-xs text-slate-400 space-y-1">
                    <p><T>نقاط الخصم: </T><span className="text-white font-semibold">{current.quality.deductionPoints}</span></p>
                    <p><T>عدد الملاحظات: </T><span className="text-white font-semibold">{current.quality.observationCount}</span></p>
                  </div>
                </>
              ) : (
                <EmptyState text={translateUIText('لا توجد لقطة جودة مخزنة لهذا الشهر — الجودة المباشرة تُعرض في تبويب الجودة', locale)} />
              )}
            </DomainCard>

            {/* HR deductions — own attributable domain */}
            <DomainCard title={translateUIText('خصومات HR', locale)} icon={<Banknote className="size-4 text-pink-400" />} scopeLabel={translateUIText('الشهر الحالي', locale)}>
              {current.hr ? (
                <>
                  <p className="text-2xl font-bold text-white">
                    {current.hr.deductionDays}
                    <span className="text-slate-500 text-xs font-normal mr-1.5"><T>يوم خصم</T></span>
                  </p>
                  <div className="text-xs text-slate-400 space-y-1">
                    <p><T>عدد الخصومات: </T><span className="text-white font-semibold">{current.hr.deductionCount}</span></p>
                    {current.hr.deductionAmount > 0 && (
                      <p><T>خصم مالي: </T><span className="text-white font-semibold">{current.hr.deductionAmount}</span><T> جنيه</T></p>
                    )}
                  </div>
                </>
              ) : (
                <EmptyState text={translateUIText('لا توجد خصومات HR لهذا الشهر', locale)} />
              )}
            </DomainCard>
          </div>

          <p className="text-slate-600 text-[10px]">
            <T>قيم الشهر الحالي من النتائج المخزنة فقط — لا تُنقل قيم الشهور السابقة إلى الشهر الحالي، ولا يُعرض مؤشر أداء نهائي (عمل مستقبلي).</T>
          </p>
        </CardContent>
      </Card>

      {/* ═══ B + C. Scope selector + monthly history list ═══ */}
      <Card className="bg-slate-800/40 border border-slate-700/30 backdrop-blur-sm">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <History className="size-4 text-cyan-400" />
              </div>
              <T>السجل الشهري</T>
            </h3>

            {/* Shared TimeScope selector — no second range system */}
            <div className="flex items-center gap-2 flex-wrap">
              {SCOPE_OPTIONS.map((option) => (
                <button
                  key={option.kind}
                  onClick={() => changeScope(option.kind)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                    scopeKind === option.kind
                      ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                      : 'border-slate-700/40 text-slate-400 hover:text-slate-300 hover:bg-slate-800/60'
                  }`}
                >
                  {option.label}
                </button>
              ))}
              {scopeKind === 'selected_month' && (
                <Select value={selectedMonth} onValueChange={changeSelectedMonth}>
                  <SelectTrigger className="w-36 h-8 text-xs bg-slate-900/60 border-slate-700/50">
                    <SelectValue placeholder={translateUIText('اختر شهراً', locale)} />
                  </SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((month) => (
                      <SelectItem key={month} value={month}>{formatMonthKey(month, locale)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <Badge variant="outline" className="border-slate-600/40 text-slate-400 text-[10px] rounded-md">
            {data.scope.label} — النطاق الزمني الحالي
          </Badge>

          {loading ? (
            <div className="flex items-center justify-center py-8 text-slate-500 text-sm gap-2">
              <Loader2 className="size-4 animate-spin" /> جارٍ التحميل…
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10">
              <CalendarDays className="size-8 text-slate-600 mb-2" />
              <p className="text-slate-400 text-sm"><T>لا توجد نتائج شهرية مخزنة في هذا النطاق</T></p>
              <p className="text-slate-600 text-xs mt-1"><T>الشهور تظهر هنا بعد توليد نتيجة الحضور أو إغلاق لقطة الجودة الخاصة بها</T></p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-slate-500 text-xs border-b border-slate-700/40">
                    <th className="text-right font-medium py-2 pl-2"><T>الشهر</T></th>
                    <th className="text-right font-medium py-2"><T>الحضور (نتيجة مخزنة)</T></th>
                    <th className="text-right font-medium py-2"><T>الجودة (لقطة مخزنة)</T></th>
                    <th className="text-right font-medium py-2"><T>خصومات HR</T></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.month} className="border-b border-slate-700/20 hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5 pl-2 text-white font-medium" dir="ltr">{formatMonthKey(row.month, locale)}</td>
                      <td className="py-2.5">
                        {row.attendance ? (
                          <span>
                            <span className={`font-bold ${scoreColor(row.attendance.compliance)}`}>{row.attendance.compliance}%</span>
                            <span className="text-slate-500 text-xs mr-1.5">(خصم {row.attendance.attendanceDeductionDays} يوم)</span>
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">{NO_ATTENDANCE_RESULT}</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        {row.quality ? (
                          <span>
                            <span className={`font-bold ${scoreColor(row.quality.score)}`}>{row.quality.score}</span>
                            <span className="text-slate-500 text-xs mr-1.5">
                              ({row.quality.snapshotStatus === 'closed' ? 'مغلقة' : 'مفتوحة'})
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">{NO_DATA}</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        {row.hr ? (
                          <span className="text-white font-semibold">{row.hr.deductionDays} يوم</span>
                        ) : (
                          <span className="text-slate-600 text-xs">{NO_DATA}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-slate-600 text-[10px]">
            <T>القيم التاريخية تُقرأ من النتائج المخزنة كما وُلّدت — لا تُعاد حسابها من البيانات الخام، ولا تتأثر بتغييرات الموظف أو القواعد الحالية.</T>
          </p>
        </CardContent>
      </Card>

      {/* ═══ D. Career summary — المسار الوظيفي (كل الفترات) ═══ */}
      <Card className="bg-slate-800/40 border border-slate-700/30 backdrop-blur-sm">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
                <TrendingUp className="size-4 text-brand-400" />
              </div>
              <T>الملخص الوظيفي</T>
            </h3>
            <Badge variant="outline" className="border-brand-500/30 text-brand-400 bg-brand-500/5 text-xs rounded-lg">
              <T>المسار الوظيفي (كل الفترات)</T>
            </Badge>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <CareerSummaryCard
              title={translateUIText('الحضور', locale)}
              icon={<Clock className="size-4 text-emerald-400" />}
              career={career.attendance}
              unit="%"
              valueLabel={translateUIText('أفضل شهر التزام', locale)}
              worstLabel={translateUIText('أقل شهر التزام', locale)}
            />
            <CareerSummaryCard
              title={translateUIText('الجودة', locale)}
              icon={<Award className="size-4 text-orange-400" />}
              career={career.quality}
              unit=""
              valueLabel={translateUIText('أفضل شهر', locale)}
              worstLabel={translateUIText('أضعف شهر', locale)}
            />
            <CareerSummaryCard
              title={translateUIText('خصومات HR', locale)}
              icon={<Banknote className="size-4 text-pink-400" />}
              career={career.hr}
              unit={translateUIText(' يوم', locale)}
              valueLabel={translateUIText('أعلى شهر خصومات', locale)}
              worstLabel={translateUIText('أقل شهر خصومات', locale)}
            />
          </div>
        </CardContent>
      </Card>

      {/* ═══ E. Performance development view — historical progression ═══ */}
      {(attendanceSeries.length > 0 || qualitySeries.length > 0) && (
        <Card className="bg-slate-800/40 border border-slate-700/30 backdrop-blur-sm">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-white font-semibold flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <TrendingUp className="size-4 text-blue-400" />
                </div>
                <T>تطور الأداء (عرض تاريخي)</T>
              </h3>
              <Badge variant="outline" className="border-slate-600/40 text-slate-400 text-[10px] rounded-md">
                <T>قيم شهرية مخزنة — من الأقدم إلى الأحدث</T>
              </Badge>
            </div>

            <DevelopmentBars title={translateUIText('نسبة الالتزام بالحضور (نتائج مخزنة)', locale)} points={attendanceSeries} unit="%" />
            <DevelopmentBars title={translateUIText('درجة الجودة (لقطات مخزنة)', locale)} points={qualitySeries} unit="" />

            <p className="text-slate-600 text-[10px]">
              <T>عرض تاريخي للقيم الشهرية الموثقة فقط — بدون نظام تقييم جديد وبدون مؤشر أداء نهائي (عمل مستقبلي).</T>
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
