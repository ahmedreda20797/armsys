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
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import {
  StatusBadge,
  ValueBasisBadge,
  formatMonth,
  formatScore,
  formatContribution,
} from './kpi-reports-shared';

const TREND_LABELS: Record<string, string> = {
  UP: '▲ اتجاه صاعد',
  DOWN: '▼ اتجاه هابط',
  STABLE: '─ مستقر',
};

const TREND_STYLES: Record<string, string> = {
  UP: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  DOWN: 'bg-red-500/15 text-red-300 border-red-500/30',
  STABLE: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-200">{value}</div>
    </div>
  );
}

function CountChip({ label, count }: { label: string; count: number }) {
  return (
    <Badge variant="outline" className="bg-slate-800/40 text-slate-300 border-slate-700/50 font-normal">
      {label}: <span className="font-mono mx-1">{count}</span>
    </Badge>
  );
}

export default function PerformanceAnalysisTab({ month }: { month: string }) {
  const [employeeId, setEmployeeId] = useState<string>('');
  const employeesQuery = useEmployees();
  const datasetQuery = usePerformanceIntelligence(employeeId || null, month);

  return (
    <div className="space-y-4">
      {/* ── Controls (never printed) ── */}
      <Card className="no-print bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label>الموظف</Label>
            <EmployeeSearchInput
              employees={employeesQuery.data ?? []}
              value={employeeId}
              onChange={(id) => setEmployeeId(id)}
              placeholder="ابحث بالاسم أو الرقم الوظيفي..."
              showDepartment
            />
          </div>
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5" />
            عرض تحقّق للبيانات التحليلية المتحقق منها (حقائق منظمة فقط — بلا أي سرد أو تفسير). ستستهلكها لاحقًا طبقة التقارير الذكية.
          </p>
        </CardContent>
      </Card>

      {!employeeId && (
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-10 text-center text-slate-400 space-y-2">
            <Search className="h-8 w-8 mx-auto opacity-50" />
            <p>ابحث عن موظف لعرض تحليل أدائه للفترة المختارة</p>
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
            تعذر تحميل التحليل — أعد المحاولة لاحقًا.
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
  const { employee, period, kpi, trend, quality, complaints, capa, followUps, deals, attendance, dataQuality, evidence } = dataset;
  const mom = trend.mom;

  return (
    <div className="space-y-4">
      {/* ── Identity + KPI facts ── */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-slate-100 flex items-center gap-2">
            <Brain className="h-4 w-4 text-violet-400" />
            {employee.employeeName || employee.employeeId}
            <span className="text-xs font-normal text-slate-500">
              {employee.employeeCode ? `(${employee.employeeCode})` : ''} · {employee.department ?? '—'}
            </span>
            {employee.archivedButEligible && (
              <Badge variant="outline" className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[10px]">
                مؤرشف — فترة تاريخية
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            <Fact label="الفترة" value={`${formatMonth(period.monthKey)}`} />
            <Fact label="أساس القيمة" value={<ValueBasisBadge basis={period.valueBasis} />} />
            <Fact
              label="درجة الجودة (خام)"
              value={<span className="text-lg">{formatScore(kpi.quality?.rawScore ?? null)}</span>}
            />
            <Fact
              label={`المساهمة الموزونة (وزن ${kpi.quality?.weight ?? '—'}%)`}
              value={formatContribution(kpi.quality?.weightedContribution ?? null, kpi.quality?.maxContribution ?? null)}
            />
            <Fact label="حالة المكون" value={<StatusBadge status={kpi.quality?.status ?? null} />} />
            <Fact label="حالة صف KPI" value={<StatusBadge status={kpi.rowStatus} />} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs text-slate-400">
            <Fact label="المخطط" value={kpi.scheme ? `${kpi.scheme.schemeName} — إصدار ${kpi.scheme.schemeVersion}` : '—'} />
            <Fact label="نتيجة المحرك" value={<span className="font-mono">{kpi.outcomeStatus}</span>} />
            <Fact
              label="مقارنة بالشهر السابق"
              value={
                mom ? (
                  <span className={mom.deltaPoints > 0 ? 'text-emerald-300' : mom.deltaPoints < 0 ? 'text-red-300' : 'text-slate-300'}>
                    {mom.deltaPoints > 0 ? '+' : ''}{mom.deltaPoints} نقطة مئوية
                    <span className="text-slate-500"> (نمو {mom.growthPercent ?? '—'}%)</span>
                  </span>
                ) : '—'
              }
            />
            <Fact
              label="الاتجاه"
              value={
                trend.direction ? (
                  <Badge variant="outline" className={`text-[11px] ${TREND_STYLES[trend.direction]}`}>
                    {TREND_LABELS[trend.direction]}
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
                {formatMonth(p.monthKey)}: {p.available ? formatScore(p.rawScore) : 'غير متاح'}{p.finalized ? ' 🔒' : ''}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Quality evidence ── */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-200">تحليل الملاحظات — {formatMonth(period.monthKey)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <CountChip label="الإجمالي" count={quality.observations.total} />
            <CountChip label="معتمدة" count={quality.observations.approved} />
            <CountChip label="معلّقة" count={quality.observations.pending} />
            <CountChip label="مرفوضة" count={quality.observations.rejected} />
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(quality.observations.bySeverity).map(([severity, count]) => (
              <CountChip key={severity} label={`شدة: ${severity}`} count={count} />
            ))}
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700/50">
                <TableHead className="text-right">الفئة (مفتاح مخزّن)</TableHead>
                <TableHead className="text-right">الاسم المخزّن</TableHead>
                <TableHead className="text-right">العدد</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quality.observations.byCategory.map((cat) => (
                <TableRow key={cat.categoryId ?? '_unclassified'} className="border-slate-800/60">
                  <TableCell className="font-mono text-xs text-slate-400">{cat.categoryId ?? '_unclassified'}</TableCell>
                  <TableCell className="text-slate-200">{cat.categoryName}</TableCell>
                  <TableCell className="font-mono">{cat.count}</TableCell>
                </TableRow>
              ))}
              {quality.observations.byCategory.length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-slate-500 text-sm">لا توجد ملاحظات في هذه الفترة</TableCell></TableRow>
              )}
            </TableBody>
          </Table>

          {/* Repeated issues — deterministic keys only */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">
              مشكلات متكررة (حد أدنى {quality.repeatedIssues.minOccurrences} تكرارات — تجميع حتمي حسب categoryId)
            </div>
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700/50">
                  <TableHead className="text-right">المفتاح</TableHead>
                  <TableHead className="text-right">التسمية</TableHead>
                  <TableHead className="text-right">التكرار</TableHead>
                  <TableHead className="text-right">أول / آخر ظهور</TableHead>
                  <TableHead className="text-right">تكرار عبر النافذة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quality.repeatedIssues.byCategory.map((group) => {
                  const window = quality.repeatedIssues.windowByCategory.find((g) => g.issueKey === group.issueKey);
                  return (
                    <TableRow key={group.issueKey} className="border-slate-800/60">
                      <TableCell className="font-mono text-xs text-slate-400">{group.issueKey}</TableCell>
                      <TableCell className="text-slate-200">{group.label}</TableCell>
                      <TableCell className="font-mono">{group.occurrenceCount}</TableCell>
                      <TableCell className="text-xs text-slate-400 font-mono">{group.firstOccurrence} → {group.lastOccurrence}</TableCell>
                      <TableCell className="text-xs text-slate-400">
                        {window ? `${window.occurrenceCount} مرات عبر ${window.monthsPresent} أشهر` : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {quality.repeatedIssues.byCategory.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-slate-500 text-sm">لا توجد فئات متكررة</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Payroll deductions — separate units */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">خصومات الجودة (رواتب — وحدات منفصلة)</div>
            <div className="flex flex-wrap gap-2">
              <CountChip label="عدد" count={quality.deductions.count} />
              <CountChip label="إجمالي الأيام" count={quality.deductions.totalDays} />
              <CountChip label="إجمالي المبلغ" count={quality.deductions.totalAmount} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Operational facts ── */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-200">حقائق تشغيلية — {formatMonth(period.monthKey)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300">الشكاوى (ربط مباشر مؤكد)</div>
              <div className="flex flex-wrap gap-2">
                <CountChip label="الإجمالي" count={complaints.total} />
                <CountChip label="محلولة/مغلقة" count={complaints.resolvedOrClosed} />
                <CountChip label="مفتوحة" count={complaints.stillOpen} />
                <CountChip label="عبر صفقة" count={complaints.viaDealCount} />
              </div>
              {complaints.repeatedTypes.length > 0 && (
                <div className="text-xs text-slate-400">
                  أنواع متكررة: {complaints.repeatedTypes.map((t) => `${t.issueKey} (${t.occurrenceCount})`).join('، ')}
                </div>
              )}
              <div className="text-xs font-semibold text-slate-300 pt-2">المتابعات</div>
              <div className="flex flex-wrap gap-2">
                <CountChip label="الإجمالي" count={followUps.total} />
                <CountChip label="متأخرة (قاعدة النظام)" count={followUps.overdue} />
                <CountChip label="مستحقة اليوم" count={followUps.dueToday} />
                <CountChip label="مكتملة" count={followUps.completed} />
                <CountChip label="نسبة الإكمال %" count={followUps.completionRate ?? 0} />
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300">إجراءات CAPA (ربط مباشر + غير مباشر)</div>
              <div className="flex flex-wrap gap-2">
                <CountChip label="الإجمالي" count={capa.total} />
                <CountChip label="نشطة" count={capa.active} />
                <CountChip label="متأخرة (SLA النظام)" count={capa.overdue} />
                <CountChip label="مغلقة" count={capa.closedCount} />
                <CountChip label="ارتباط غير مباشر" count={capa.indirectCount} />
              </div>
              <div className="text-xs font-semibold text-slate-300 pt-2">صفقات السفر (حقائق تشغيلية فقط)</div>
              <div className="flex flex-wrap gap-2">
                <CountChip label="الإجمالي" count={deals.total} />
                <CountChip label="مكتملة" count={deals.completed} />
                <CountChip label="ملغاة" count={deals.canceled} />
                <CountChip label="نشطة" count={deals.active} />
              </div>
              <div className="text-xs font-semibold text-slate-300 pt-2">الحضور (سياق فقط — خارج KPI الجودة)</div>
              {attendance.result ? (
                <div className="flex flex-wrap gap-2">
                  <CountChip label="أيام التأخير" count={attendance.result.lateDays} />
                  <CountChip label="أيام الغياب" count={attendance.result.absentDays} />
                  <CountChip label="الالتزام %" count={attendance.result.compliance} />
                </div>
              ) : (
                <div className="text-xs text-slate-500">لا توجد نتيجة شهرية مخزّنة (NOT_AVAILABLE)</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Data quality + evidence ── */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-200">جودة البيانات والمراجع (Evidence)</CardTitle>
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
                {collection}: {String(count)}
              </Badge>
            ))}
            {evidence.attendance && (
              <Badge variant="outline" className="bg-slate-900/40 text-slate-400 border-slate-800 font-mono text-[10px]">
                attendanceResults: {evidence.attendance.recordIds.length}
              </Badge>
            )}
          </div>
          {dataQuality.unattributedRecords.length > 0 && (
            <div className="text-xs text-amber-300/90">
              سجلات بلا شهر قابل للإسناد (استُثنت دون تخمين):{' '}
              {dataQuality.unattributedRecords.map((u) => `${u.collection} (${u.count})`).join('، ')}
            </div>
          )}
          <ul className="text-[11px] text-slate-500 space-y-1">
            {dataQuality.notes.map((note) => (
              <li key={note}>• {note}</li>
            ))}
          </ul>
          <div className="text-[10px] text-slate-600 font-mono">generatedAt: {dataset.generatedAt}</div>
        </CardContent>
      </Card>
    </div>
  );
}
