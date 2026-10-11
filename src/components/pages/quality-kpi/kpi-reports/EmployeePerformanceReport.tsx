'use client';

// ══════════════════════════════════════════════════════════════
//  EmployeePerformanceReport — dense employee intelligence table
//
//  §14 the WHO + HOW table: employee · quality % · change · approved
//      observations · repeated issues · high/critical · evaluation
//      status. Percentage terminology only; missing data renders '—'
//      (never 0, never a raw status key).
//  §15 employee vs team benchmark: every scored row shows the gap to
//      its OWN team's average — a personal dip inside a team-wide
//      dip must be visible as the operational pattern it is.
// ══════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { ArrowDown, ArrowUp, FileBarChart, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KpiInsightsReport, KpiReportRow } from '@/lib/kpi-reporting';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatNumber } from '@/lib/i18n/format';
import { useAppStore } from '@/lib/store';
import { useRecordHighlight } from '@/hooks/use-record-highlight';
import { StatusBadge, formatScore } from '../kpi-reports-shared';
import { pick, TERMS } from './insights-labels';
import { QualityDeltaChip } from './PerformanceOverview';

export interface EmployeeTableFilters {
  search: string;
  status: string;
}

function filterRows(
  rows: ReadonlyArray<KpiReportRow>,
  filters: EmployeeTableFilters,
): KpiReportRow[] {
  let out = [...rows];
  const query = filters.search.trim().toLowerCase();
  if (query) {
    out = out.filter(
      (r) =>
        r.employeeName.toLowerCase().includes(query) ||
        (r.employeeCode ?? '').toLowerCase().includes(query),
    );
  }
  if (filters.status) {
    out = out.filter((r) => r.rowStatus === filters.status);
  }
  return out;
}

export function EmployeePerformanceReport({
  report,
  filters,
  onOpenEmployeeReport,
}: {
  report: KpiInsightsReport;
  filters: EmployeeTableFilters;
  onOpenEmployeeReport: (employeeId: string) => void;
}) {
  const { locale } = useLanguage();
  const openEmployee360 = useAppStore((s) => s.openEmployee360);
  useRecordHighlight({ ready: report.rows.length > 0 });

  const rows = useMemo(() => filterRows(report.rows, filters), [report.rows, filters]);
  const teamAvgByLabel = useMemo(
    () => new Map(report.teamUnits.map((u) => [u.key, u.avgQuality])),
    [report.teamUnits],
  );

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-6 text-center text-xs text-slate-400">
        <T>لا توجد صفوف موظفين مطابقة في هذا النطاق والفلاتر — البيانات غير المتوفرة لا تُعرض كصفر.</T>
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700/40 bg-slate-800/20">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-700/50 text-start text-[11px] text-slate-500">
            <th className="px-3 py-2 text-start font-medium"><T>الموظف</T></th>
            <th className="px-3 py-2 text-start font-medium"><T>{TERMS.qualityPct[0]}</T></th>
            <th className="px-3 py-2 text-start font-medium"><T>{TERMS.changeVsPrevious[0]}</T></th>
            <th className="px-3 py-2 text-start font-medium"><T>{TERMS.approvedObservations[0]}</T></th>
            <th className="px-3 py-2 text-start font-medium"><T>{TERMS.repeatedIssues[0]}</T></th>
            <th className="px-3 py-2 text-start font-medium"><T>{TERMS.highCritical[0]}</T></th>
            <th className="px-3 py-2 text-start font-medium hidden md:table-cell"><T>مقارنة بالفريق</T></th>
            <th className="px-3 py-2 text-start font-medium"><T>{TERMS.evaluationStatus[0]}</T></th>
            <th className="px-3 py-2 text-start font-medium no-print" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const facts = report.employeeFacts[row.employeeId];
            const teamAvg = row.team ? teamAvgByLabel.get(row.team) ?? null : null;
            const rawScore = row.quality?.rawScore ?? null;
            const benchmarkDelta =
              rawScore !== null && teamAvg !== null ? Math.round((rawScore - teamAvg) * 100) / 100 : null;
            return (
              <tr
                key={row.employeeId}
                data-record-id={row.employeeId}
                className="border-b border-slate-800/60 transition-colors hover:bg-slate-800/40"
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-200">{row.employeeName}</span>
                    {row.employeeCode && (
                      <span className="text-[10px] text-slate-500 font-mono">{row.employeeCode}</span>
                    )}
                    {row.archivedButEligible && (
                      <span className="rounded border border-slate-600/50 px-1 text-[10px] text-slate-400">
                        <T>مؤرشف</T>
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {[row.department, row.team].filter(Boolean).join(' · ') || '—'}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono tabular-nums text-slate-100">
                  {formatScore(rawScore, locale)}
                </td>
                <td className="px-3 py-2">
                  {facts?.deltaPoints != null
                    ? <QualityDeltaChip delta={facts.deltaPoints} />
                    : <span className="text-slate-600">—</span>}
                </td>
                <td className="px-3 py-2 font-mono tabular-nums text-slate-300">
                  {facts ? formatNumber(facts.observationsApproved, { locale }) : '—'}
                </td>
                <td className="px-3 py-2 font-mono tabular-nums">
                  {facts && facts.repeatedIssues > 0 ? (
                    <span className="text-amber-300">{formatNumber(facts.repeatedIssues, { locale })}</span>
                  ) : facts ? (
                    <span className="text-slate-500">0</span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono tabular-nums">
                  {facts && facts.highCritical > 0 ? (
                    <span className="text-red-300">{formatNumber(facts.highCritical, { locale })}</span>
                  ) : facts ? (
                    <span className="text-slate-500">0</span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="hidden px-3 py-2 md:table-cell">
                  {benchmarkDelta === null ? (
                    <span className="text-slate-600">—</span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px]">
                      {benchmarkDelta > 0 && <ArrowUp className="size-3 text-emerald-400" />}
                      {benchmarkDelta < 0 && <ArrowDown className="size-3 text-red-400" />}
                      {benchmarkDelta === 0 && <Minus className="size-3 text-slate-500" />}
                      <span
                        dir="ltr"
                        className={cn(
                          'font-mono tabular-nums',
                          benchmarkDelta > 0 && 'text-emerald-400',
                          benchmarkDelta < 0 && 'text-red-400',
                          benchmarkDelta === 0 && 'text-slate-400',
                        )}
                      >
                        {benchmarkDelta > 0 ? `+${benchmarkDelta}` : benchmarkDelta}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        <T>عن متوسط</T> {row.team}
                      </span>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.rowStatus} />
                </td>
                <td className="px-3 py-2 no-print">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title={pick(locale, TERMS.viewEmployeeReport)}
                      onClick={() => onOpenEmployeeReport(row.employeeId)}
                      className="rounded-md border border-slate-700/60 p-1.5 text-slate-400 hover:border-brand-500/40 hover:text-brand-200"
                    >
                      <FileBarChart className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title={pick(locale, TERMS.openEmployee360)}
                      onClick={() => openEmployee360(row.employeeId)}
                      className="rounded-md border border-slate-700/60 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700/40"
                    >
                      <T>الملف</T>
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
