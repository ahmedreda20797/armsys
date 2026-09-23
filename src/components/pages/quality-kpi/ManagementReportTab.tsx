'use client';

// ══════════════════════════════════════════════════════════════
//  KPI Reports — Management Report tab (Milestone 7, Phase A)
//
//  The cross-domain management view for one period: the engine's
//  Quality KPI summary (consumed VERBATIM — §15 labeling carried
//  through) beside deterministic operational counts per department/
//  team (complaints · CAPA · follow-ups · HR deductions).
//
//  Every number arrives from /api/reports/management, which applies
//  authentication + permission + employee scope server-side. The UI
//  recalculates nothing and invents nothing.
// ══════════════════════════════════════════════════════════════

import { Info, ShieldAlert, ClipboardCheck, MessageSquareWarning, Banknote, Info as InfoIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useManagementReport } from '@/hooks/use-kpi-queries';
import type { ManagementReport, DepartmentManagementRow, DomainPeriodFacts } from '@/lib/management-reporting';
import type { ManagementDomainSource } from '@/lib/management-reporting';
import { ValueBasisBadge, formatScore } from './kpi-reports-shared';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { usePrintReportStore } from '@/components/print/print-report-store';
import { managementReportToPrintModel } from '@/components/print/print-adapters';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatNumber, formatInteger } from '@/lib/i18n/format';

const DOMAIN_ORDER: ManagementDomainSource[] = [
  'complaints',
  'capaCases',
  'followUps',
  'hrDeductions',
];

const DOMAIN_ICONS: Record<ManagementDomainSource, React.ReactNode> = {
  complaints: <MessageSquareWarning className="h-3.5 w-3.5" />,
  capaCases: <ShieldAlert className="h-3.5 w-3.5" />,
  followUps: <ClipboardCheck className="h-3.5 w-3.5" />,
  hrDeductions: <Banknote className="h-3.5 w-3.5" />,
};

export default function ManagementReportTab({ month }: { month: string }) {
  const { locale } = useLanguage();
  const query = useManagementReport(month);
  const report = query.data as ManagementReport | undefined;
  // §PRINT — hook order: called unconditionally before early returns.
  const openPrintReport = usePrintReportStore((st) => st.openPrintReport);

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-14 rounded-2xl bg-slate-800/40" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl bg-slate-800/40" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl bg-slate-800/40" />
      </div>
    );
  }

  if (query.isError || !report) {
    return (
      <Card className="bg-red-950/20 border-red-800/40">
        <CardContent className="p-6 text-red-300 text-sm"><T>تعذر تحميل التقرير الإداري — أعد المحاولة.</T></CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── §15 QUALITY KPI labeling carried through from the engine ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
        <span className="flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0" />
          <T>{report.qualitySummary.label}</T>
        </span>
        <span className="flex items-center gap-2">
          <ValueBasisBadge basis={report.qualitySummary.valueBasis} />
          <Button
            size="sm"
            variant="outline"
            className="no-print h-7 gap-1.5 border-amber-500/40 bg-transparent text-amber-200 hover:bg-amber-500/15"
            onClick={() => openPrintReport(managementReportToPrintModel(report))}
          >
            <Printer className="size-3.5" />
            <T>طباعة / PDF</T>
          </Button>
        </span>
      </div>

      {/* ── Company-wide operational totals for the period ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {DOMAIN_ORDER.map((domain) => (
          <DomainTotalCard key={domain} facts={report.totals.domains[domain]} />
        ))}
      </div>

      {/* ── Department breakdown ── */}
      <GroupTable
        title="الأقسام — جودة KPI + سجلات العمليات"
        rows={report.departments}
      />

      {/* ── Team breakdown ── */}
      <GroupTable
        title="الفرق — جودة KPI + سجلات العمليات"
        rows={report.teams}
      />

      {/* ── Explainability (traceability doctrine) ── */}
      <div className="flex items-start gap-2 rounded-lg border border-slate-700/40 bg-slate-900/40 p-3 text-xs text-slate-400">
        <InfoIcon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <p>{report.explanation}</p>
      </div>
    </div>
  );
}

function DomainTotalCard({ facts }: { facts: DomainPeriodFacts }) {
  const { locale } = useLanguage();
  return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-4 space-y-1">
      <p className="text-xs text-slate-400 flex items-center gap-1.5">
        {DOMAIN_ICONS[facts.source]}
        <T>{facts.label}</T>
      </p>
      <p className="text-2xl font-bold text-slate-100">{formatInteger(facts.total, locale)}</p>
      <p className="text-[11px] text-slate-500">
        <T>مفتوح: </T><span className="text-amber-300">{formatInteger(facts.open, locale)}</span>
        {' · '}
        <T>مغلق: </T><span className="text-emerald-300">{formatInteger(facts.closed, locale)}</span>
      </p>
    </div>
  );
}

function GroupTable({
  title,
  rows,
}: {
  title: string;
  rows: DepartmentManagementRow[];
}) {
  const { locale } = useLanguage();
  return (
    <Card className="bg-slate-800/30 border-slate-700/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-slate-200"><T>{title}</T></CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center"><T>لا توجد بيانات مجمّعة لهذه الفترة</T></p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700/40">
                  <TableHead className="text-right"><T>المجموعة</T></TableHead>
                  <TableHead className="text-right"><T>الموظفون</T></TableHead>
                  <TableHead className="text-right"><T>متوسط الجودة (خام)</T></TableHead>
                  <TableHead className="text-right"><T>متوسط المساهمة</T></TableHead>
                  {DOMAIN_ORDER.map((d) => (
                    <TableHead key={d} className="text-right">
                      {DOMAIN_ICONS[d]}
                      <span className="sr-only">{d}</span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key} className="border-slate-700/40">
                    <TableCell className="text-slate-200">
                      <span className="flex items-center gap-2">
                        {row.label}
                        {row.quality ? (
                          <Badge variant="outline" className="text-[10px] border-slate-600/50 text-slate-500"><T>جودة KPI</T></Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] border-slate-700/60 text-slate-600"><T>عمليات فقط</T></Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-slate-300 font-mono">{formatInteger(row.employeeCount, locale)}</TableCell>
                    <TableCell className="font-mono text-slate-100">
                      {row.quality ? formatScore(row.quality.avgRawScore, locale) : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-slate-300">
                      {row.quality?.avgContribution != null ? formatNumber(row.quality.avgContribution, { locale }) : '—'}
                    </TableCell>
                    {DOMAIN_ORDER.map((d) => {
                      const facts = row.domains[d];
                      return (
                        <TableCell key={d} className="font-mono text-xs">
                          <span className={facts.total > 0 ? 'text-slate-100' : 'text-slate-600'}>
                            {formatInteger(facts.total, locale)}
                          </span>
                          {facts.open > 0 && (
                            <span className="text-amber-400/80"> ({formatInteger(facts.open, locale)})</span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
