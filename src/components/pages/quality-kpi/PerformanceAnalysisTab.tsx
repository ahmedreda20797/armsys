'use client';

// ══════════════════════════════════════════════════════════════
//  KPI Reports — Performance Analysis tab (Phase 3, spec §25)
//
//  MINIMAL verification view over the deterministic employee-period
//  analytical dataset (/api/performance-intelligence). It renders
//  FACTS ONLY — counts, keys, statuses, evidence ids — exactly as
//  the service produced them. No AI narrative, no interpretation,
//  no redesign of the existing KPI report tabs.
//
//  CLIENT-SAFE: the dataset shape is imported TYPE-ONLY (the
//  performance-intelligence barrel is server-side — same rule as
//  kpi-reports-shared.tsx).
// ══════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Brain, Search, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import { useEmployees } from '@/hooks/use-queries';
import { usePerformanceIntelligence } from '@/hooks/use-kpi-queries';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { usePrintReportStore } from '@/components/print/print-report-store';
import { performanceDatasetToPrintModel } from '@/components/print/print-adapters';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import {
  StatusBadge,
  ValueBasisBadge,
  formatScore,
  formatContribution,
} from './kpi-reports-shared';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { translateUIText } from '@/lib/i18n/ui-text';
import { formatMonthKey, formatNumber, formatInteger, formatDateTime } from '@/lib/i18n/format';

const TREND_LABELS: Record<string, [string, string]> = {
  UP: ['▲ اتجاه صاعد', '▲ Upward trend'],
  DOWN: ['▼ اتجاه هابط', '▼ Downward trend'],
  STABLE: ['─ مستقر', '─ Stable'],
};

const TREND_STYLES: Record<string, string> = {
  UP: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  DOWN: 'bg-red-500/15 text-red-300 border-red-500/30',
  STABLE: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

function Fact({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-200">{value}</div>
    </div>
  );
}

function CountChip({ label, count }: { label: React.ReactNode; count: number }) {
  const { locale } = useLanguage();
  return (
    <Badge variant="outline" className="bg-slate-800/40 text-slate-300 border-slate-700/50 font-normal">
      {label}: <span className="font-mono mx-1">{formatInteger(count, locale)}</span>
    </Badge>
  );
}

export default function PerformanceAnalysisTab({ month }: { month: string }) {
  const { locale } = useLanguage();
  const [employeeId, setEmployeeId] = useState<string>('');
  const employeesQuery = useEmployees();
  const datasetQuery = usePerformanceIntelligence(employeeId || null, month);
  // §PRINT — dedicated clean A4 print view from the loaded dataset.
  const openPrintReport = usePrintReportStore((st) => st.openPrintReport);

  return (
    <div className="space-y-4">
      {/* ── Controls (never printed) ── */}
      <Card className="no-print bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label><T>الموظف</T></Label>
            <EmployeeSearchInput
              employees={employeesQuery.data ?? []}
              value={employeeId}
              onChange={(id) => setEmployeeId(id)}
              placeholder={translateUIText('ابحث بالاسم أو الرقم الوظيفي...', locale)}
              showDepartment
            />
          </div>
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5" />
            <T>عرض تحقّق للبيانات التحليلية المتحقق منها (حقائق منظمة فقط — بلا أي سرد أو تفسير). ستستهلكها لاحقًا طبقة التقارير الذكية.</T>
          </p>
          {datasetQuery.data ? (
            <Button
              size="sm"
              variant="outline"
              className="no-print h-8 gap-1.5 w-fit border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
              onClick={() => openPrintReport(performanceDatasetToPrintModel(datasetQuery.data as EmployeePerformanceDataset))}
            >
              <Printer className="size-3.5" />
              <T>طباعة / PDF</T>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {!employeeId && (
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-10 text-center text-slate-400 space-y-2">
            <Search className="h-8 w-8 mx-auto opacity-50" />
            <p><T>ابحث عن موظف لعرض تحليل أدائه للفترة المختارة</T></p>
          </CardContent>
        </Card>
      )}

      {employeeId !== '' && datasetQuery.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-2xl bg-slate-800/40" />
          <Skeleton className="h-64 w-full rounded-2xl bg-slate-800/40" />
        </div>
      ) : null}

      {employeeId !== '' && datasetQuery.isError ? (
        <Card className="bg-red-950/20 border-red-800/40">
          <CardContent className="p-6 text-red-300 text-sm">
            <T>تعذر تحميل التحليل — أعد المحاولة لاحقًا.</T>
          </CardContent>
        </Card>
      ) : null}

      {employeeId !== '' && datasetQuery.data ? (
        <DatasetBody dataset={datasetQuery.data as EmployeePerformanceDataset} />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Dataset body — facts sections only
// ─────────────────────────────────────────────────────────────

function DatasetBody({ dataset }: { dataset: EmployeePerformanceDataset }) {
  const { locale } = useLanguage();
  const { employee, period, kpi, trend, quality, complaints, capa, followUps, deals, attendance, dataQuality, evidence } = dataset;
  const mom = trend.mom;

  return (
    <div className="space-y-4">
      {/* ── Identity + KPI facts ── */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-slate-100 flex items-center gap-2">
            <Brain className="h-4 w-4 text-brand-400" />
            {employee.employeeName || employee.employeeId}
            <span className="text-xs font-normal text-slate-500">
              {employee.employeeCode ? `(${employee.employeeCode})` : ''} · {employee.department ?? '—'}
            </span>
            {employee.archivedButEligible && (
              <Badge variant="outline" className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[10px]">
                <T>مؤرشف — فترة تاريخية</T>
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            <Fact label={<T>الفترة</T>} value={`${formatMonthKey(period.monthKey, locale)}`} />
            <Fact label={<T>أساس القيمة</T>} value={<ValueBasisBadge basis={period.valueBasis} />} />
            <Fact
              label={<T>درجة الجودة (خام)</T>}
              value={<span className="text-lg">{formatScore(kpi.quality?.rawScore ?? null, locale)}</span>}
            />
            <Fact
              label={<><T>المساهمة الموزونة (وزن </T>{kpi.quality?.weight != null ? formatNumber(kpi.quality.weight, { locale }) : '—'}%)</>}
              value={formatContribution(kpi.quality?.weightedContribution ?? null, kpi.quality?.maxContribution ?? null, locale)}
            />
            <Fact label={<T>حالة المكون</T>} value={<StatusBadge status={kpi.quality?.status ?? null} />} />
            <Fact label={<T>حالة صف KPI</T>} value={<StatusBadge status={kpi.rowStatus} />} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs text-slate-400">
            <Fact
              label={<T>المخطط</T>}
              value={kpi.scheme ? <>{kpi.scheme.schemeName} — <T>إصدار</T> {kpi.scheme.schemeVersion}</> : '—'}
            />
            <Fact label={<T>نتيجة المحرك</T>} value={<span className="font-mono">{kpi.outcomeStatus}</span>} />
            <Fact
              label={<T>مقارنة بالشهر السابق</T>}
              value={
                mom ? (
                  <span className={mom.deltaPoints > 0 ? 'text-emerald-300' : mom.deltaPoints < 0 ? 'text-red-300' : 'text-slate-300'}>
                    {mom.deltaPoints > 0 ? '+' : ''}{formatNumber(mom.deltaPoints, { locale })} <T>نقطة مئوية</T>
                    <span className="text-slate-500"> (<T>نمو </T>{mom.growthPercent != null ? formatNumber(mom.growthPercent, { locale }) : '—'}%)</span>
                  </span>
                ) : '—'
              }
            />
            <Fact
              label={<T>الاتجاه</T>}
              value={
                trend.direction ? (
                  <Badge variant="outline" className={`text-[11px] ${TREND_STYLES[trend.direction]}`}>
                    {TREND_LABELS[trend.direction]?.[locale === 'en' ? 1 : 0]}
                  </Badge>
                ) : '—'
              }
            />
          </div>

          {/* Score trend — months with results only (missing = غير متاح) */}
          <div className="flex flex-wrap gap-2">
            {trend.points.map((p) => (
              <Badge
                key={p.monthKey}
                variant="outline"
                className={p.available ? 'bg-slate-800/50 text-slate-200 border-slate-700/60' : 'bg-slate-900/40 text-slate-600 border-slate-800'}
              >
                {formatMonthKey(p.monthKey, locale)}: {p.available ? formatScore(p.rawScore, locale) : translateUIText('غير متاح', locale)}{p.finalized ? ' 🔒' : ''}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Quality evidence ── */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-200"><T>تحليل الملاحظات — </T>{formatMonthKey(period.monthKey, locale)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <CountChip label={<T>الإجمالي</T>} count={quality.observations.total} />
            <CountChip label={<T>معتمدة</T>} count={quality.observations.approved} />
            <CountChip label={<T>معلّقة</T>} count={quality.observations.pending} />
            <CountChip label={<T>مرفوضة</T>} count={quality.observations.rejected} />
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(quality.observations.bySeverity).map(([severity, count]) => (
              <CountChip key={severity} label={<><T>شدة</T>: {severity}</>} count={count} />
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700/50">
                <TableHead className="text-right"><T>الفئة (مفتاح مخزّن)</T></TableHead>
                <TableHead className="text-right"><T>الاسم المخزّن</T></TableHead>
                <TableHead className="text-right"><T>العدد</T></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quality.observations.byCategory.map((cat) => (
                <TableRow key={cat.categoryId ?? '_unclassified'} className="border-slate-800/60">
                  <TableCell className="font-mono text-xs text-slate-400">{cat.categoryId ?? '_unclassified'}</TableCell>
                  <TableCell className="text-slate-200">{cat.categoryName}</TableCell>
                  <TableCell className="font-mono">{formatInteger(cat.count, locale)}</TableCell>
                </TableRow>
              ))}
              {quality.observations.byCategory.length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-slate-500 text-sm"><T>لا توجد ملاحظات في هذه الفترة</T></TableCell></TableRow>
              )}
            </TableBody>
          </Table>

          {/* Repeated issues — deterministic keys only */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">
              <T>مشكلات متكررة (حد أدنى </T>{formatInteger(quality.repeatedIssues.minOccurrences, locale)} <T>تكرارات — تجميع حتمي حسب categoryId)</T>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700/50">
                  <TableHead className="text-right"><T>المفتاح</T></TableHead>
                  <TableHead className="text-right"><T>التسمية</T></TableHead>
                  <TableHead className="text-right"><T>التكرار</T></TableHead>
                  <TableHead className="text-right"><T>أول / آخر ظهور</T></TableHead>
                  <TableHead className="text-right"><T>تكرار عبر النافذة</T></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quality.repeatedIssues.byCategory.map((group) => {
                  const window = quality.repeatedIssues.windowByCategory.find((g) => g.issueKey === group.issueKey);
                  return (
                    <TableRow key={group.issueKey} className="border-slate-800/60">
                      <TableCell className="font-mono text-xs text-slate-400">{group.issueKey}</TableCell>
                      <TableCell className="text-slate-200">{group.label}</TableCell>
                      <TableCell className="font-mono">{formatInteger(group.occurrenceCount, locale)}</TableCell>
                      <TableCell className="text-xs text-slate-400 font-mono">{group.firstOccurrence} → {group.lastOccurrence}</TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {window ? <>{formatInteger(window.occurrenceCount, locale)} <T>مرات عبر </T>{formatInteger(window.monthsPresent, locale)} <T>أشهر</T></> : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {quality.repeatedIssues.byCategory.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-slate-500 text-sm"><T>لا توجد فئات متكررة</T></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Payroll deductions — separate units */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300"><T>خصومات الجودة (رواتب — وحدات منفصلة)</T></div>
            <div className="flex flex-wrap gap-2">
              <CountChip label={<T>عدد</T>} count={quality.deductions.count} />
              <CountChip label={<T>إجمالي الأيام</T>} count={quality.deductions.totalDays} />
              <CountChip label={<T>إجمالي المبلغ</T>} count={quality.deductions.totalAmount} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Operational facts ── */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-200"><T>حقائق تشغيلية — </T>{formatMonthKey(period.monthKey, locale)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300"><T>الشكاوى (ربط مباشر مؤكد)</T></div>
              <div className="flex flex-wrap gap-2">
                <CountChip label={<T>الإجمالي</T>} count={complaints.total} />
                <CountChip label={<T>محلولة/مغلقة</T>} count={complaints.resolvedOrClosed} />
                <CountChip label={<T>مفتوحة</T>} count={complaints.stillOpen} />
                <CountChip label={<T>عبر صفقة</T>} count={complaints.viaDealCount} />
              </div>
              {complaints.repeatedTypes.length > 0 && (
                <div className="text-xs text-slate-400">
                  <T>أنواع متكررة: </T>{complaints.repeatedTypes.map((t) => `${t.issueKey} (${formatInteger(t.occurrenceCount, locale)})`).join('، ')}
                </div>
              )}
              <div className="text-xs font-semibold text-slate-300 pt-2"><T>المتابعات</T></div>
              <div className="flex flex-wrap gap-2">
                <CountChip label={<T>الإجمالي</T>} count={followUps.total} />
                <CountChip label={<T>متأخرة (قاعدة النظام)</T>} count={followUps.overdue} />
                <CountChip label={<T>مستحقة اليوم</T>} count={followUps.dueToday} />
                <CountChip label={<T>مكتملة</T>} count={followUps.completed} />
                <CountChip label={<T>نسبة الإكمال %</T>} count={followUps.completionRate ?? 0} />
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300"><T>إجراءات CAPA (ربط مباشر + غير مباشر)</T></div>
              <div className="flex flex-wrap gap-2">
                <CountChip label={<T>الإجمالي</T>} count={capa.total} />
                <CountChip label={<T>نشطة</T>} count={capa.active} />
                <CountChip label={<T>متأخرة (SLA النظام)</T>} count={capa.overdue} />
                <CountChip label={<T>مغلقة</T>} count={capa.closedCount} />
                <CountChip label={<T>ارتباط غير مباشر</T>} count={capa.indirectCount} />
              </div>
              <div className="text-xs font-semibold text-slate-300 pt-2"><T>صفقات السفر (مصنّفة بتاريخها المرجعي)</T></div>
              <div className="flex flex-wrap gap-2">
                <CountChip label={<T>مكتملة (تاريخ الإغلاق)</T>} count={deals.closedTotal} />
                <CountChip label={<T>حجم السفر (تاريخ المغادرة)</T>} count={deals.travelTotal} />
                <CountChip label={<T>ملغاة</T>} count={deals.canceled} />
                <CountChip label={<T>نشطة</T>} count={deals.active} />
                {deals.closedUnknownMonth > 0 && <CountChip label={<T>بتاريخ إغلاق غير محدد</T>} count={deals.closedUnknownMonth} />}
              </div>
              <div className="text-xs font-semibold text-slate-300 pt-2"><T>الحضور (سياق فقط — خارج KPI الجودة)</T></div>
              {attendance.result ? (
                <div className="flex flex-wrap gap-2">
                  <CountChip label={<T>أيام التأخير</T>} count={attendance.result.lateDays} />
                  <CountChip label={<T>أيام الغياب</T>} count={attendance.result.absentDays} />
                  <CountChip label={<T>الالتزام %</T>} count={attendance.result.compliance} />
                </div>
              ) : (
                <div className="text-xs text-slate-500"><T>لا توجد نتيجة شهرية مخزّنة (NOT_AVAILABLE)</T></div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Data quality + evidence ── */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-200"><T>جودة البيانات والمراجع (Evidence)</T></CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            {[
              ['qualityObservations', evidence.observations.recordIds.length],
              ['qualityDeductions', evidence.deductions.recordIds.length],
              ['complaints', evidence.complaints.recordIds.length],
              ['capaCases', evidence.capa.recordIds.length],
              ['followUps', evidence.followUps.recordIds.length],
              ['travelDeals', evidence.deals.recordIds.length],
            ].map(([collection, count]) => (
              <Badge key={String(collection)} variant="outline" className="bg-slate-900/40 text-slate-400 border-slate-800 font-mono text-[10px]">
                {collection}: {formatInteger(Number(count), locale)}
              </Badge>
            ))}
            {evidence.attendance && (
              <Badge variant="outline" className="bg-slate-900/40 text-slate-400 border-slate-800 font-mono text-[10px]">
                attendanceResults: {formatInteger(evidence.attendance.recordIds.length, locale)}
              </Badge>
            )}
          </div>
          {dataQuality.unattributedRecords.length > 0 && (
            <div className="text-xs text-amber-300/90">
              <T>سجلات بلا شهر قابل للإسناد (استُثنت دون تخمين): </T>
              {dataQuality.unattributedRecords.map((u) => `${u.collection} (${formatInteger(u.count, locale)})`).join('، ')}
            </div>
          )}
          <ul className="text-[11px] text-slate-500 space-y-1">
            {dataQuality.notes.map((note) => (
              <li key={note}>• {note}</li>
            ))}
          </ul>
          <div className="text-[10px] text-slate-600 font-mono">generatedAt: {formatDateTime(dataset.generatedAt, locale)}</div>
        </CardContent>
      </Card>
    </div>
  );
}
