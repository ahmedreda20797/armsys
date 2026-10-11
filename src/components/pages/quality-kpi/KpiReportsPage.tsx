'use client';

// ══════════════════════════════════════════════════════════════
//  KPI Reports Page 2.0 — Operational Performance Intelligence
//  Workspace
//
//  RESTRUCTURE CONTRACT (KPI Reports 2.0):
//    • The former الشهري / MTD / تاريخي period tabs are REMOVED —
//      they were period modes, not report types. ONE canonical
//      period selector lives in the control bar; the value basis
//      (MTD / LIVE / FINALIZED) is displayed as read-only context.
//    • Report TYPES: أداء الموظفين · أداء الفرق · مقارنة الأداء ·
//      دعم قرارات الموارد البشرية.
//    • SCOPE: الشركة / موظفون / فرق / أقسام — canonical Organization
//      Tree node ids; the server intersects the selection with the
//      AUTHORIZED scope (a selection can only narrow).
//    • Quality Observations are the analytical explanation layer:
//      overview → signals → quality intelligence → improvement
//      opportunities → management attention → data quality.
//    • All calculations reuse the canonical engines (insights
//      endpoint composes buildMonthlyKpiReport + the deterministic
//      observation analysis). No AI anywhere in the numbers.
//    • Page state persists per user (v3) and restores through the
//      SPA history snapshots (browser Back) — legacy v2 shapes map
//      forward.
// ══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { FileBarChart, Printer, Sheet as SheetIcon } from 'lucide-react';
import { PageIdentity } from '@/components/shared/PageIdentity';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useMonthSnapshots, useKpiInsights } from '@/hooks/use-kpi-queries';
import { useEmployees } from '@/hooks/use-queries';
import { usePageState } from '@/hooks/use-page-state';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import {
  audienceMayReceiveTechnicalReports,
  resolveReportAudience,
} from '@/lib/report-audience/profiles';
import type { KpiInsightsReport } from '@/lib/kpi-reporting';
import { buildMonthOptions, currentMonthKey, downloadKpiReportExcel } from './kpi-reports-shared';
import HrPerformanceReportTab from './HrPerformanceReportTab';
import { openPrintReport } from '@/components/print/print-report-store';
import { kpiInsightsToPrintModel } from '@/components/print/print-adapters';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatMonthKey } from '@/lib/i18n/format';
import {
  KpiReportsControlBar,
  type KpiReportType,
  type KpiScopeMode,
  type KpiReportsFilters,
} from './kpi-reports/KpiReportsControlBar';
import { PerformanceOverview } from './kpi-reports/PerformanceOverview';
import { QualityIntelligenceSection } from './kpi-reports/QualityIntelligenceSection';
import { EmployeePerformanceReport } from './kpi-reports/EmployeePerformanceReport';
import { TeamPerformanceReport } from './kpi-reports/TeamPerformanceReport';
import { ComparisonReport } from './kpi-reports/ComparisonReport';
import {
  ImprovementOpportunitiesSection,
  ManagementAttentionSection,
  DataQualitySection,
} from './kpi-reports/InsightsSections';
import { KpiEmployeeReportDialog } from './kpi-reports/KpiEmployeeReportDialog';
import { normalizeView, DEFAULT_FILTERS, type WorkspaceView } from './kpi-reports/view-state';
import { useAppStore } from '@/lib/store';

export default function KpiReportsPage() {
  const { locale } = useLanguage();
  const { user } = useAuth();
  const { canView: canViewHrReport } = usePermissions('reports');

  // ── Audience (client mirror of the SERVER gates — the routes
  //    enforce the same resolution): technical detail reaches only
  //    TECHNICAL audiences; HR / TEAM_LEADER use the HR report type.
  const audience = useMemo(
    () => resolveReportAudience({ role: user?.role, permissions: user?.permissions }),
    [user?.role, user?.permissions],
  );
  const technical = audienceMayReceiveTechnicalReports(audience);
  const availableReportTypes: ReadonlyArray<KpiReportType> = technical
    ? ['employees', 'teams', 'comparison', 'hr']
    : ['hr'];

  // ── Navigation seeds (existing nav params — win for this mount) ──
  const navMonth = useAppStore((s) => {
    const m = s.navParams.month;
    return typeof m === 'string' && m.length === 7 && m[4] === '-' ? m : null;
  });
  const navEmployeeId = useAppStore((s) => {
    const e = s.navParams.employeeId;
    return typeof e === 'string' && e.length > 0 ? e : null;
  });
  const hasNavSeed = navMonth !== null || navEmployeeId !== null;

  // ── The work context persists per user (v3) and restores on Back ──
  const [view, setView] = usePageState<WorkspaceView>({
    page: 'kpiReports',
    slot: 'view',
    version: 3,
    skipRestore: hasNavSeed,
    initial: () => ({
      reportType: 'employees',
      month: navMonth ?? currentMonthKey(),
      scopeMode: navEmployeeId ? 'employees' : 'company',
      employeeIds: navEmployeeId ? [navEmployeeId] : [],
      orgNodeIds: [],
      filters: { ...DEFAULT_FILTERS },
    }),
    validate: (raw) => normalizeView(raw),
  });

  const snapshotsQuery = useMonthSnapshots();
  const monthOptions = useMemo(
    () =>
      buildMonthOptions(
        snapshotsQuery.data as Array<{ monthKey: string; status: 'open' | 'closed' }> | undefined,
        locale,
      ),
    [snapshotsQuery.data, locale],
  );
  const month = monthOptions.some((o) => o.value === view.month) ? view.month : monthOptions[0]?.value ?? view.month;
  const reportType: KpiReportType = availableReportTypes.includes(view.reportType)
    ? view.reportType
    : availableReportTypes[0];

  const setViewPart = (patch: Partial<WorkspaceView>) => setView((s) => ({ ...s, ...patch }));

  // ── Canonical insights payload (one assembly for the workspace) ──
  const insightsParams = {
    employeeIds: view.scopeMode === 'employees' ? view.employeeIds : [],
    orgNodeIds:
      view.scopeMode === 'teams' || view.scopeMode === 'departments' ? view.orgNodeIds : [],
    includeArchived: view.filters.includeArchived,
  };
  const insightsQuery = useKpiInsights(month, {
    ...insightsParams,
    enabled: reportType !== 'hr',
  });
  const report = (insightsQuery.data ?? null) as KpiInsightsReport | null;

  const employeesQuery = useEmployees();
  const employeeOptions = useMemo(
    () =>
      ((employeesQuery.data ?? []) as Array<{ id: string; name: string; department?: string | null }>).map(
        (e) => ({ id: e.id, label: e.name, hint: e.department ?? null }),
      ),
    [employeesQuery.data],
  );

  const teamOptions = useMemo(
    () => (report?.vocab.teams ?? []).map((t) => ({ id: t.nodeId, label: t.label, hint: `${t.employeeCount}` })),
    [report],
  );
  const departmentOptions = useMemo(
    () => (report?.vocab.departments ?? []).map((d) => ({ id: d.nodeId, label: d.label, hint: `${d.employeeCount}` })),
    [report],
  );

  // Exactly one org unit selected → the shared distributions ARE that
  // unit's report (server-side canonical narrowing).
  const singleUnitLabel =
    (view.scopeMode === 'teams' || view.scopeMode === 'departments') && view.orgNodeIds.length === 1
      ? [...(report?.vocab.teams ?? []), ...(report?.vocab.departments ?? [])].find(
          (v) => v.nodeId === view.orgNodeIds[0],
        )?.label ?? null
      : null;

  const rowNameById = useMemo(
    () => new Map((report?.rows ?? []).map((r) => [r.employeeId, r.employeeName])),
    [report],
  );
  const employeeNameOf = (employeeId: string): string => rowNameById.get(employeeId) ?? employeeId;

  // ── Drill-down: employee report dialog ──
  const [employeeDialogId, setEmployeeDialogId] = useState<string | null>(null);

  // ── Unit drill = canonical narrowing through the selection ──
  const drillToUnit = (unitKey: string, kind: 'team' | 'department') => {
    const vocab = kind === 'team' ? report?.vocab.teams : report?.vocab.departments;
    const nodeId = vocab?.find((v) => v.label === unitKey)?.nodeId;
    if (nodeId) {
      setViewPart({ scopeMode: kind === 'team' ? 'teams' : 'departments', orgNodeIds: [nodeId] });
    } else {
      // No matching active node → narrow by the unit's members.
      const unit = kind === 'team'
        ? report?.teamUnits.find((u) => u.key === unitKey)
        : report?.departmentUnits.find((u) => u.key === unitKey);
      if (unit) {
        setViewPart({ scopeMode: 'employees', employeeIds: [...unit.employeeIds], orgNodeIds: [] });
      }
    }
  };

  const handleClear = () => {
    setViewPart({ scopeMode: 'company', employeeIds: [], orgNodeIds: [], filters: { ...DEFAULT_FILTERS } });
  };

  const handlePrint = () => {
    if (!report) return;
    const scopeLabels =
      view.scopeMode === 'employees'
        ? view.employeeIds.map(employeeNameOf).join(' · ')
        : singleUnitLabel ?? undefined;
    openPrintReport(
      kpiInsightsToPrintModel(
        report,
        scopeLabels
          ? `${locale === 'en' ? 'Scope' : 'النطاق'}: ${scopeLabels}`
          : undefined,
      ),
    );
  };

  const handleExcelExport = () => {
    void downloadKpiReportExcel(
      'kpi-monthly',
      { monthKey: month, employeeScope: 'all', filters: insightsParams.includeArchived ? { includeArchived: 'true' } : {} },
      `kpi_report_${month}.xlsx`,
    );
  };

  return (
    <div className="space-y-5 p-1" data-active-page="kpiReports">
      <PageIdentity
        pageId="kpiReports"
        icon={<FileBarChart className="size-5" />}
        iconClassName="bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
        description={
          <>
            <T>مساحة ذكاء الأداء التشغيلي — تشرح أنماط الجودة وراء المؤشرات وتحدد مواضع التحسين ومسار المراجعة الإدارية.</T>
            <span className="block text-[11px] text-slate-500 mt-0.5">
              <T>الفترة: </T>{formatMonthKey(month, locale)}
              {monthOptions.find((o) => o.value === month)?.closed
                ? <T>{' — شهر مغلق (نتائج مجمّدة)'}</T>
                : <T>{' — شهر مفتوح'}</T>}
            </span>
          </>
        }
        actions={
          <div className="no-print flex items-center gap-1.5">
            {report && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrint}>
                <Printer className="size-4" />
                <T>طباعة</T>
              </Button>
            )}
            {technical && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExcelExport}>
                <SheetIcon className="size-4" />
                <T>Excel</T>
              </Button>
            )}
          </div>
        }
      />

      <KpiReportsControlBar
        reportType={reportType}
        onReportTypeChange={(type) => setViewPart({ reportType: type })}
        availableReportTypes={availableReportTypes}
        monthOptions={monthOptions}
        month={month}
        onMonthChange={(m) => setViewPart({ month: m })}
        valueBasis={report?.valueBasis ?? null}
        finalized={report?.finalized ?? monthOptions.find((o) => o.value === month)?.closed ?? false}
        scopeMode={view.scopeMode}
        onScopeModeChange={(mode) => setViewPart({ scopeMode: mode })}
        employeeOptions={employeeOptions}
        teamOptions={teamOptions}
        departmentOptions={departmentOptions}
        selectedEmployeeIds={view.employeeIds}
        onSelectedEmployeesChange={(ids) => setViewPart({ employeeIds: ids })}
        selectedOrgNodeIds={view.orgNodeIds}
        onSelectedOrgNodesChange={(ids) => setViewPart({ orgNodeIds: ids })}
        filters={view.filters}
        onFiltersChange={(filters) => setViewPart({ filters })}
        onClear={handleClear}
        loading={insightsQuery.isFetching}
      />

      {reportType === 'hr' && canViewHrReport ? (
        <HrPerformanceReportTab month={month} />
      ) : reportType === 'hr' ? (
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-6 text-sm text-slate-400">
            <T>تقرير الموارد البشرية غير متاح لصلاحياتك الحالية.</T>
          </CardContent>
        </Card>
      ) : insightsQuery.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-2xl bg-slate-800/40" />
          <Skeleton className="h-64 w-full rounded-2xl bg-slate-800/40" />
        </div>
      ) : insightsQuery.isError ? (
        <Card className="bg-red-950/20 border-red-800/40">
          <CardContent className="p-5 text-sm text-red-300">
            <T>تعذر تحميل مساحة التقارير.</T>
            <span className="block text-xs text-red-300/80 mt-1">
              {(insightsQuery.error as Error | null)?.message ?? ''}
            </span>
          </CardContent>
        </Card>
      ) : report ? (
        <div className="space-y-5">
          <PerformanceOverview report={report} />

          {reportType === 'employees' && (
            <EmployeePerformanceReport
              report={report}
              filters={view.filters}
              onOpenEmployeeReport={setEmployeeDialogId}
            />
          )}
          {reportType === 'teams' && (
            <TeamPerformanceReport
              report={report}
              filters={view.filters}
              onOpenEmployeeReport={setEmployeeDialogId}
              onDrillToTeam={(unit) => drillToUnit(unit.key, 'team')}
              onDrillToDepartment={(unit) => drillToUnit(unit.key, 'department')}
              singleUnitLabel={singleUnitLabel}
            />
          )}
          {reportType === 'comparison' && (
            <ComparisonReport
              report={report}
              initialEntityIds={
                view.scopeMode === 'employees'
                  ? view.employeeIds
                  : view.orgNodeIds
                    .map((nodeId) =>
                      [...report.vocab.teams, ...report.vocab.departments].find((v) => v.nodeId === nodeId)?.label,
                    )
                    .filter((label): label is string => !!label)
              }
            />
          )}

          <QualityIntelligenceSection report={report} />
          <ImprovementOpportunitiesSection report={report} employeeNameOf={employeeNameOf} />
          <ManagementAttentionSection report={report} />
          <DataQualitySection report={report} />
        </div>
      ) : !snapshotsQuery.isLoading && monthOptions.length === 0 ? (
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-6 text-sm text-slate-400">
            <T>لا توجد فترات متاحة بعد — تُضاف الأشهر تلقائيًا بعد أول إغلاق شهر.</T>
          </CardContent>
        </Card>
      ) : null}

      <KpiEmployeeReportDialog
        employeeId={employeeDialogId}
        month={month}
        employeeName={employeeDialogId ? employeeNameOf(employeeDialogId) : null}
        open={!!employeeDialogId}
        onOpenChange={(open) => {
          if (!open) setEmployeeDialogId(null);
        }}
      />
    </div>
  );
}
