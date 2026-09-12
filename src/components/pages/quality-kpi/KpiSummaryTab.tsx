'use client';

// ══════════════════════════════════════════════════════════════
//  KPI Reports — Management Summary tab (Phase 2, spec §15)
//
//  Concise management-level statistics for the selected period.
//  §15 BINDING: while only Quality is calculated these are QUALITY
//  KPI statistics — the payload's statisticsKind is displayed
//  explicitly so they are never mistaken for company-wide KPI.
// ══════════════════════════════════════════════════════════════

import { Info, Award, TrendingDown, Users, CheckCircle2, Clock, Lock, AlertOctagon, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePrintReportStore } from '@/components/print/print-report-store';
import { qualitySummaryToPrintModel } from '@/components/print/print-adapters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useKpiManagementSummary } from '@/hooks/use-kpi-queries';
import type { KpiManagementSummary } from '@/lib/kpi-reporting';
import { ValueBasisBadge, formatScore, formatContribution } from './kpi-reports-shared';

export default function KpiSummaryTab({ month }: { month: string }) {
  const query = useKpiManagementSummary(month);
  const summary = query.data as KpiManagementSummary | undefined;
  // §PRINT — hook order: called unconditionally at the top (the
  // loading/error early-returns below must not skip it).
  const openPrintReport = usePrintReportStore((st) => st.openPrintReport);

  if (query.isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl bg-slate-800/40" />
        ))}
      </div>
    );
  }

  if (query.isError || !summary) {
    return (
      <Card className="bg-red-950/20 border-red-800/40">
        <CardContent className="p-6 text-red-300 text-sm">تعذر تحميل الملخص — أعد المحاولة.</CardContent>
      </Card>
    );
  }

  const { counts, qualityAverages: averages } = summary;

  return (
    <div className="space-y-4">
      {/* ── §15 QUALITY KPI statistics label — never company-wide ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
        <span className="flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0" />
          {summary.label}
        </span>
        <span className="flex items-center gap-2">
          <ValueBasisBadge basis={summary.valueBasis} />
          <Button
            size="sm"
            variant="outline"
            className="no-print h-7 gap-1.5 border-amber-500/40 bg-transparent text-amber-200 hover:bg-amber-500/15"
            onClick={() => openPrintReport(qualitySummaryToPrintModel(summary))}
          >
            <Printer className="size-3.5" />
            طباعة / PDF
          </Button>
        </span>
      </div>

      {/* ── Count cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<Users className="h-4 w-4" />} label="الموظفون المؤهلون" value={counts.eligible} tone="slate" />
        <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="KPI متاح" value={counts.available} tone="emerald" />
        <StatCard icon={<AlertOctagon className="h-4 w-4" />} label="KPI غير مكتمل" value={counts.incomplete} tone="amber" />
        <StatCard icon={<Clock className="h-4 w-4" />} label="KPI معلّق" value={counts.pending} tone="slate" />
        <StatCard icon={<Lock className="h-4 w-4" />} label="نتائج مجمّدة" value={counts.finalized} tone="sky" />
        <StatCard icon={<AlertOctagon className="h-4 w-4" />} label="صفر حقيقي" value={counts.zero} tone="red" />
        <StatCard icon={<AlertOctagon className="h-4 w-4" />} label="بدون مخطط" value={counts.noScheme} tone="purple" />
        <StatCard icon={<Users className="h-4 w-4" />} label="مؤرشفون بأهلية تاريخية" value={counts.archivedButEligible} tone="orange" />
      </div>

      {/* ── Averages ── */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-slate-200">متوسطات وأطراف الجودة</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-4 space-y-1">
            <p className="text-xs text-slate-400">متوسط درجة الجودة (خام)</p>
            <p className="text-2xl font-bold text-emerald-300">{formatScore(averages.avgRawScore)}</p>
          </div>
          <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-4 space-y-1">
            <p className="text-xs text-slate-400">متوسط مساهمة الجودة</p>
            <p className="text-2xl font-bold text-slate-100">
              {averages.avgContribution === null ? '—' : averages.avgContribution}
              <span className="text-sm text-slate-500"> نقطة</span>
            </p>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-1">
            <p className="text-xs text-emerald-300/80 flex items-center gap-1">
              <Award className="h-3.5 w-3.5" /> الأعلى
            </p>
            {averages.highest ? (
              <>
                <p className="text-lg font-bold text-slate-100">{formatScore(averages.highest.rawScore)}</p>
                <p className="text-xs text-slate-400">{averages.highest.employeeName}</p>
              </>
            ) : (
              <p className="text-sm text-slate-500 py-2">—</p>
            )}
          </div>
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-1">
            <p className="text-xs text-red-300/80 flex items-center gap-1">
              <TrendingDown className="h-3.5 w-3.5" /> الأدنى
            </p>
            {averages.lowest ? (
              <>
                <p className="text-lg font-bold text-slate-100">{formatScore(averages.lowest.rawScore)}</p>
                <p className="text-xs text-slate-400">{averages.lowest.employeeName}</p>
              </>
            ) : (
              <p className="text-sm text-slate-500 py-2">—</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Department / team breakdown ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BreakdownCard title="حسب القسم" rows={summary.departments} />
        <BreakdownCard title="حسب الفريق" rows={summary.teams} />
      </div>
    </div>
  );
}

function StatCard({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'slate' | 'emerald' | 'amber' | 'sky' | 'red' | 'purple' | 'orange';
}) {
  const toneClasses: Record<string, string> = {
    slate: 'text-slate-300 border-slate-600/40',
    emerald: 'text-emerald-300 border-emerald-500/40',
    amber: 'text-amber-300 border-amber-500/40',
    sky: 'text-sky-300 border-sky-500/40',
    red: 'text-red-300 border-red-500/40',
    purple: 'text-purple-300 border-purple-500/40',
    orange: 'text-orange-300 border-orange-500/40',
  };
  return (
    <div className={`rounded-xl border bg-slate-900/40 p-4 space-y-1 ${toneClasses[tone]}`}>
      <p className="text-xs text-slate-400 flex items-center gap-1.5">{icon}{label}</p>
      <p className="text-2xl font-bold text-slate-100">{value}</p>
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string;
  rows: KpiManagementSummary['departments'];
}) {
  return (
    <Card className="bg-slate-800/30 border-slate-700/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-slate-200">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">لا توجد بيانات مجمّعة</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700/40">
                <TableHead className="text-right">الاسم</TableHead>
                <TableHead className="text-right">الموظفون</TableHead>
                <TableHead className="text-right">متوسط الدرجة (خام)</TableHead>
                <TableHead className="text-right">متوسط المساهمة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key} className="border-slate-700/40">
                  <TableCell className="text-slate-200">
                    <span className="flex items-center gap-2">
                      {row.label}
                      <Badge variant="outline" className="text-[10px] border-slate-600/50 text-slate-500">جودة KPI</Badge>
                    </span>
                  </TableCell>
                  <TableCell className="text-slate-300 font-mono">{row.employeeCount}</TableCell>
                  <TableCell className="font-mono text-slate-100">{formatScore(row.avgRawScore)}</TableCell>
                  <TableCell className="font-mono text-slate-300">
                    {row.avgContribution === null ? '—' : formatContribution(row.avgContribution, null)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
