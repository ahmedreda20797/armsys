'use client';

// ══════════════════════════════════════════════════════════════
//  TeamPerformanceReport — teams as operating units (§16/§17)
//
//  NOT a stack of employee cards: each unit row aggregates the
//  canonical facts (employees · average quality · change · approved
//  observations · repeated issues · high/critical · improving /
//  declining). Selecting exactly ONE unit turns the shared
//  distributions and the ranking table into THAT unit's report —
//  the drill-down is the selection itself (canonical narrowing).
//  Department scope renders the same machinery with department
//  units + team comparison (§17).
// ══════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { Focus } from 'lucide-react';
import type { KpiInsightsReport, UnitInsights } from '@/lib/kpi-reporting';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatNumber } from '@/lib/i18n/format';
import { formatScore } from '../kpi-reports-shared';
import { pick, TERMS } from './insights-labels';
import { QualityDeltaChip } from './PerformanceOverview';
import { EmployeePerformanceReport } from './EmployeePerformanceReport';
import type { EmployeeTableFilters } from './EmployeePerformanceReport';

function UnitsTable({
  units,
  drillLabel,
  onDrill,
}: {
  units: ReadonlyArray<UnitInsights>;
  drillLabel: string;
  onDrill: (unit: UnitInsights) => void;
}) {
  const { locale } = useLanguage();
  if (units.length === 0) {
    return (
      <p className="py-3 text-center text-xs text-slate-500">
        <T>لا توجد وحدات تنظيمية قابلة للعرض في هذا النطاق.</T>
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700/40">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-700/50 text-[11px] text-slate-500">
            <th className="px-3 py-2 text-start font-medium">{drillLabel}</th>
            <th className="px-3 py-2 text-start font-medium"><T>{TERMS.employees[0]}</T></th>
            <th className="px-3 py-2 text-start font-medium"><T>{TERMS.averageQuality[0]}</T></th>
            <th className="px-3 py-2 text-start font-medium"><T>{TERMS.changeVsPrevious[0]}</T></th>
            <th className="px-3 py-2 text-start font-medium"><T>{TERMS.approvedObservations[0]}</T></th>
            <th className="px-3 py-2 text-start font-medium"><T>{TERMS.repeatedIssues[0]}</T></th>
            <th className="px-3 py-2 text-start font-medium"><T>{TERMS.highCritical[0]}</T></th>
            <th className="px-3 py-2 text-start font-medium"><T>تحسن</T> / <T>تراجع</T></th>
            <th className="px-3 py-2 no-print" />
          </tr>
        </thead>
        <tbody>
          {units.map((unit) => (
            <tr key={unit.key} className="border-b border-slate-800/60 hover:bg-slate-800/40">
              <td className="px-3 py-2 font-medium text-slate-200">{unit.label}</td>
              <td className="px-3 py-2 font-mono tabular-nums text-slate-300">
                {formatNumber(unit.employeeCount, { locale })}
              </td>
              <td className="px-3 py-2 font-mono tabular-nums text-slate-100">
                {formatScore(unit.avgQuality, locale)}
              </td>
              <td className="px-3 py-2">
                {unit.deltaPoints !== null
                  ? <QualityDeltaChip delta={unit.deltaPoints} />
                  : <span className="text-slate-600">—</span>}
              </td>
              <td className="px-3 py-2 font-mono tabular-nums text-slate-300">
                {formatNumber(unit.observationsApproved, { locale })}
              </td>
              <td className="px-3 py-2 font-mono tabular-nums">
                <span className={unit.repeatedIssues > 0 ? 'text-amber-300' : 'text-slate-500'}>
                  {formatNumber(unit.repeatedIssues, { locale })}
                </span>
              </td>
              <td className="px-3 py-2 font-mono tabular-nums">
                <span className={unit.highCritical > 0 ? 'text-red-300' : 'text-slate-500'}>
                  {formatNumber(unit.highCritical, { locale })}
                </span>
              </td>
              <td className="px-3 py-2 font-mono tabular-nums">
                <span className="text-emerald-400">{formatNumber(unit.improving, { locale })}</span>
                <span className="text-slate-600"> / </span>
                <span className="text-red-400">{formatNumber(unit.declining, { locale })}</span>
              </td>
              <td className="px-3 py-2 no-print">
                <button
                  type="button"
                  title={pick(locale, ['عرض كتقرير مستقل', 'View as standalone report'])}
                  onClick={() => onDrill(unit)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700/60 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700/40"
                >
                  <Focus className="size-3" />
                  <T>عرض</T>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TeamPerformanceReport({
  report,
  filters,
  onOpenEmployeeReport,
  onDrillToTeam,
  onDrillToDepartment,
  singleUnitLabel,
}: {
  report: KpiInsightsReport;
  filters: EmployeeTableFilters;
  onOpenEmployeeReport: (employeeId: string) => void;
  /** Narrows the selection to one team (node id when resolvable). */
  onDrillToTeam: (unit: UnitInsights) => void;
  onDrillToDepartment: (unit: UnitInsights) => void;
  /** Set by the page when exactly ONE org unit is selected. */
  singleUnitLabel: string | null;
}) {
  const { locale } = useLanguage();

  const rankingRows = useMemo(
    () =>
      [...report.rows].sort((a, b) => {
        const av = a.quality?.rawScore;
        const bv = b.quality?.rawScore;
        if (av == null && bv == null) return a.employeeName.localeCompare(b.employeeName, 'ar');
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av;
      }),
    [report.rows],
  );

  return (
    <div className="space-y-5">
      {report.departmentUnits.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-200">
            <T>مقارنة الأقسام</T>
          </h3>
          <UnitsTable
            units={report.departmentUnits}
            drillLabel={pick(locale, ['القسم', 'Department'])}
            onDrill={onDrillToDepartment}
          />
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-200">
          <T>الفرق كوحدات تشغيلية</T>
        </h3>
        <UnitsTable units={report.teamUnits} drillLabel={pick(locale, ['الفريق', 'Team'])} onDrill={onDrillToTeam} />
      </section>

      {singleUnitLabel && (
        <p className="text-[11px] text-slate-500">
          <T>النظرة العامة والتوزيعات أعلاه تعكس وحدة واحدة:</T>{' '}
          <span className="text-slate-300">{singleUnitLabel}</span>
        </p>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-200">
          <T>ترتيب الموظفين حسب نسبة الجودة</T>
        </h3>
        <EmployeePerformanceReport
          report={{ ...report, rows: rankingRows }}
          filters={filters}
          onOpenEmployeeReport={onOpenEmployeeReport}
        />
      </section>
    </div>
  );
}
