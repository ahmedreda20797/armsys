'use client';

// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — GROUP REPORT (§GROUP-REPORTING)
//  (مركز أداء الموظف — تقرير المجموعة)
//
//  Three reporting modes over the same canonical single-employee
//  dataset (reuse engines, no duplication):
//
//  A. Individual Reports — generate a separate report for each
//     selected employee (existing single-employee hub dataset).
//
//  B. Consolidated Group Report — one analytical report for the
//     entire selected population (group dataset aggregation).
//
//  C. Comparison Report — dimension-by-dimension comparisons
//     between selected employees/teams/departments/companies/managers
//     (GROUPED BY REAL ORG MEMBERSHIP, never the arbitrary selection).
//
//  Selection (post body): arbitrary mixed employeeIds + orgNodeIds
//  (teams/departments/companies/managers). Server validates against
//  authorized scope, dedups, caps, and surfaces out-of-scope rejects.
// ══════════════════════════════════════════════════════════════

import { useMemo, useState, useCallback } from 'react';
import { AlertTriangle, ChevronLeft, ClipboardList, FileText, Printer, Search, ShieldX, Target, Users } from 'lucide-react';
import { openPrintReport } from '@/components/print/print-report-store';
import { PageIdentity } from '@/components/shared/PageIdentity';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useEmployees, useOrgNodesForAssignment } from '@/hooks/use-queries';
import { useMonthSnapshots, usePerformanceGroupReport, usePerformanceHub } from '@/hooks/use-kpi-queries';
import { KpiEntityMultiSelect } from '../quality-kpi/kpi-reports/KpiEntityMultiSelect';
import { orgNodeTypeLabel } from '@/lib/organization/types';
import { usePageState } from '@/hooks/use-page-state';
import { useLanguage } from '@/lib/i18n/language-context';
import { T } from '@/lib/i18n/T';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import type { PerformanceGroupReport, EmployeePerformanceHubDataset } from '@/lib/performance-hub';
import { performanceGroupToPrintModel, performanceHubToPrintModel } from './hub-print';
import {
  PerformanceGroupLabels,
  pick,
} from './hub-labels';
import { periodLabel } from './hub-view';
import type { Locale } from '@/lib/i18n/dictionary';
import { formatPercentage } from '@/lib/i18n/format';
import type { OpenSource } from './PerformanceHubPage';

export default function PerformanceHubGroupPage() {
  const { canView } = usePermissions('employeePerformanceHub');
  if (!canView) return <UnauthorizedState />;
  return <GroupBody />;
}

function UnauthorizedState() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="w-20 h-20 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
        <ShieldX className="w-10 h-10 text-red-400" />
      </div>
      <h2 className="text-xl font-bold text-slate-200 mb-2"><T>صلاحية غير كافية</T></h2>
      <p className="text-slate-400 text-center max-w-md">
        <T>لا تملك صلاحية عرض تقارير المجموعة في مركز أداء الموظف.</T>
      </p>
    </div>
  );
}

// ─── Report modes ────────────────────────────────────────────────
type ReportMode = 'individual' | 'consolidated' | 'comparison';

interface ModeDescriptor {
  key: ReportMode;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const MODES: ModeDescriptor[] = [
  {
    key: 'individual',
    label: 'تقارير فردية',
    description: 'تقرير مستقل لكل موظف مختار',
    icon: <FileText className="size-5" />,
  },
  {
    key: 'consolidated',
    label: 'تقرير مجمع',
    description: 'تحليل واحد للمجموعة كاملة',
    icon: <Users className="size-5" />,
  },
  {
    key: 'comparison',
    label: 'تقرير مقارنة',
    description: 'مقارنة أبعاد بين الموظفين والفرق',
    icon: <ClipboardList className="size-5" />,
  },
];

// ─── Group body ──────────────────────────────────────────────────
function GroupBody() {
  const { locale } = useLanguage();
  const navEmployeeId = useAppStore((s) => {
    const v = s.navParams.employeeId;
    return typeof v === 'string' && v.length > 0 ? v : null;
  });
  const navMonth = useAppStore((s) => {
    const m = s.navParams.month;
    return typeof m === 'string' && m.length === 7 && m[4] === '-' ? m : null;
  });
  const hasNavSeed = navEmployeeId !== null;

  const [view, setView] = usePageState<{
    month: string;
    selection: { employeeIds: string[]; orgNodeIds: string[] };
    mode: ReportMode;
  }>({
    page: 'employeePerformanceHubGroup',
    slot: 'view',
    version: 2,
    initial: () => ({
      month: navMonth ?? currentMonthKey(),
      // §nav-params — a deep-linked employee seeds the selection.
      selection: { employeeIds: navEmployeeId ? [navEmployeeId] : [], orgNodeIds: [] },
      mode: navEmployeeId ? 'individual' : 'consolidated',
    }),
    skipRestore: hasNavSeed,
    validate: (raw) =>
      raw && typeof raw === 'object'
      && typeof (raw as { month?: unknown }).month === 'string'
      && typeof (raw as { selection?: unknown }).selection === 'object'
      && typeof (raw as { mode?: unknown }).mode === 'string'
        ? (raw as { month: string; selection: { employeeIds: string[]; orgNodeIds: string[] }; mode: ReportMode })
        : null,
  });

  const [selection, setSelection] = useState(view.selection);
  const [mode, setMode] = useState<ReportMode>(view.mode);
  /** §MODE-A — the individual report currently displayed (a member of the selection). */
  const [activeEmployeeId, setActiveEmployeeId] = useState<string | null>(navEmployeeId);

  // Persist selection + mode to page state
  const persistSelection = useCallback(
    (next: { employeeIds: string[]; orgNodeIds: string[] }) => {
      setSelection(next);
      setView((s) => ({ ...s, selection: next }));
    },
    [setView],
  );
  const persistMode = useCallback(
    (next: ReportMode) => {
      setMode(next);
      setView((s) => ({ ...s, mode: next }));
    },
    [setView],
  );

  const month = view.month;
  // The displayed individual report: the active employee, else the
  // first selected one (never outside the selection).
  const displayEmployeeId =
    activeEmployeeId && selection.employeeIds.includes(activeEmployeeId)
      ? activeEmployeeId
      : selection.employeeIds[0] ?? null;

  const employeesQuery = useEmployees();
  const snapshotsQuery = useMonthSnapshots();
  const totalSelected = selection.employeeIds.length + selection.orgNodeIds.length;
  // §CUSTOM-SELECTION — org-tree node options (teams/departments/
  // companies) for the subtree picker (lazy: loaded when needed).
  const orgNodesQuery = useOrgNodesForAssignment(true);

  const monthOptions = useMemo(
    () => buildMonthOptions(snapshotsQuery.data as Array<{ monthKey: string; status: 'open' | 'closed' }> | undefined, locale),
    [snapshotsQuery.data, locale],
  );
  const effectiveMonth = monthOptions.some((o) => o.value === month) ? month : monthOptions[0]?.value ?? month;

  const navigateTo = useAppStore((s) => s.navigateTo);
  const visiblePageIds = usePermissions().visiblePages.map((p) => p.id);
  const visibleSet = useMemo(() => new Set(visiblePageIds), [visiblePageIds]);

  const openSource = useCallback<OpenSource>((page, highlightId, navParams) => {
    if (!visibleSet.has(page)) return;
    navigateTo(page, highlightId ?? undefined, navParams);
  }, [navigateTo, visibleSet]);

  // ── Selection option sets (server-authorized lists only) ──
  const employeeOptions = useMemo(() => {
    const list = (employeesQuery.data ?? []) as Array<{ id: string; name: string; department?: string | null }>;
    return list.map((e) => ({
      id: e.id,
      label: e.name,
      hint: e.department ?? null,
    }));
  }, [employeesQuery.data]);

  const orgNodeOptions = useMemo(() => {
    const nodes = orgNodesQuery.data?.nodes ?? [];
    return nodes
      .filter((n) => n.status === 'active')
      .map((n) => ({
        id: n.id,
        label: n.name,
        hint: orgNodeTypeLabel(n.type, locale),
      }));
  }, [orgNodesQuery.data, locale]);

  const employeeNameById = useMemo(
    () => new Map(((employeesQuery.data ?? []) as Array<{ id: string; name: string }>).map((e) => [e.id, e.name])),
    [employeesQuery.data],
  );

  // ── Single-employee hub (mode A: individual) ──
  const hubQuery = usePerformanceHub(displayEmployeeId, effectiveMonth);
  const singleDataset = hubQuery.data as EmployeePerformanceHubDataset | undefined;

  // ── Group report (modes B/C — also seeds mode A's member switcher) ──
  const groupQuery = usePerformanceGroupReport({
    month: effectiveMonth,
    selection,
    compare: true,
    limit: 50,
    enabled: totalSelected > 0,
  });
  const groupReport = groupQuery.data as PerformanceGroupReport | undefined;

  // §MODE-A — the member list to switch between: the group report's
  // resolved population when available, else the explicit selection.
  const individualMembers: Array<{ id: string; name: string }> = useMemo(() => {
    if (groupReport && groupReport.population.members.length > 0) {
      return groupReport.population.members.map((m) => ({ id: m.employeeId, name: m.employeeName }));
    }
    return selection.employeeIds.map((id) => ({ id, name: employeeNameById.get(id) ?? id }));
  }, [groupReport, selection.employeeIds, employeeNameById]);

  const handlePrint = useCallback(() => {
    if (mode === 'individual' && singleDataset) {
      openPrintReport(performanceHubToPrintModel(singleDataset, locale));
    } else if (groupReport) {
      openPrintReport(performanceGroupToPrintModel(groupReport, locale));
    }
  }, [mode, singleDataset, groupReport, locale]);

  return (
    <div className="space-y-4 p-1">
      {/* ── §7 unified page identity ── */}
      <PageIdentity
        pageId="employeePerformanceHubGroup"
        icon={<Target className="size-5" />}
        iconClassName="bg-brand-500/15 border-brand-500/30 text-brand-400"
        className="flex-wrap items-start no-print"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              disabled={mode === 'individual' ? !singleDataset : !groupReport}
              className="border-slate-700/50 text-slate-300 hover:bg-slate-800/60"
            >
              <Printer className="h-4 w-4 ml-1.5" />
              <T>طباعة</T>
            </Button>
          </div>
        }
      />

      {/* ── Selection: TWO multi-selects (employees + org subtrees) + period + mode tabs ── */}
      <Card className="no-print bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label><T>موظفون (اختيار فردي متعدد)</T></Label>
              <KpiEntityMultiSelect
                options={employeeOptions}
                selected={selection.employeeIds}
                onChange={(next) => persistSelection({ ...selection, employeeIds: next })}
                placeholder="أضف موظفين..."
                searchPlaceholder="ابحث بالاسم أو الكود..."
              />
            </div>
            <div className="space-y-1.5">
              <Label><T>فرق / أقسام / شركات (الشجرة التنظيمية)</T></Label>
              <KpiEntityMultiSelect
                options={orgNodeOptions}
                selected={selection.orgNodeIds}
                onChange={(next) => persistSelection({ ...selection, orgNodeIds: next })}
                placeholder="أضف فريقًا أو قسمًا أو شركة..."
                searchPlaceholder="ابحث في الهيكل التنظيمي..."
              />
            </div>
          </div>
          <p className="text-xs text-slate-400">
            <T>المختار:</T> {totalSelected} {locale === 'en' ? (totalSelected === 1 ? 'item' : 'items') : 'عنصر'}
            {mode !== 'individual' && <span className="text-slate-500"> — <T>الحد الأقصى 50 موظفًا لكل تقرير</T></span>}
          </p>

          {/* Period + mode tabs */}
          <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-3 items-end">
            <div className="space-y-1.5 min-w-[190px]">
              <Label><T>الفترة</T></Label>
              <Select
                value={effectiveMonth}
                onValueChange={(v) => setView((s) => ({ ...s, month: v }))}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {monthOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label><T>وضع التقرير</T></Label>
              <div className="flex flex-wrap gap-2">
                {MODES.map((m) => (
                  <Button
                    key={m.key}
                    variant={mode === m.key ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => persistMode(m.key)}
                    className="gap-1.5"
                    title={m.description}
                  >
                    {m.icon}
                    <span className="hidden sm:inline">{pick(locale, [m.label, m.label] as const)}</span>
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* §MODE-A — member switcher (individual reports over the selection) */}
          {mode === 'individual' && individualMembers.length > 0 && (
            <div className="space-y-1.5 border-t border-slate-800/60 pt-3">
              <Label><T>تقرير الموظف</T> ({individualMembers.length})</Label>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto arm-scroll">
                {individualMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setActiveEmployeeId(m.id)}
                    className={`px-2 py-0.5 rounded-full border text-[11px] max-w-[220px] truncate ${
                      displayEmployeeId === m.id
                        ? 'border-brand-500/40 bg-brand-500/20 text-brand-200'
                        : 'border-slate-700/50 bg-slate-900/40 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Empty / Loading / Error ── */}
      {mode === 'individual' && !displayEmployeeId && (
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-12 text-center text-slate-400 space-y-2">
            <Search className="h-8 w-8 mx-auto opacity-50" />
            <p><T>اختر موظفًا لعرض تقريره الفردي</T></p>
          </CardContent>
        </Card>
      )}

      {totalSelected === 0 && mode !== 'individual' && (
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-12 text-center text-slate-400 space-y-2">
            <Users className="h-8 w-8 mx-auto opacity-50" />
            <p><T>اختر موظفين أو عقدًا تنظيمية واحدة على الأقل للمقارنة/التقرير المجمع</T></p>
          </CardContent>
        </Card>
      )}

      {mode === 'individual' && displayEmployeeId && hubQuery.isLoading && (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-28 w-full rounded-2xl bg-slate-800/40" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl bg-slate-800/40" />
            ))}
          </div>
        </div>
      )}

      {mode !== 'individual' && groupQuery.isLoading && (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-20 w-full rounded-2xl bg-slate-800/40" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl bg-slate-800/40" />
            ))}
          </div>
        </div>
      )}

      {mode === 'individual' && displayEmployeeId && hubQuery.isError && (
        <Card className="bg-red-950/20 border-red-800/40">
          <CardContent className="p-6 text-center space-y-3">
            <AlertTriangle className="h-8 w-8 mx-auto text-red-400" />
            <p className="text-red-300 text-sm font-semibold"><T>تعذر تحميل التقرير الفردي</T></p>
            <Button
              variant="outline"
              size="sm"
              className="border-red-800/50 text-red-200 hover:bg-red-900/30"
              onClick={() => hubQuery.refetch()}
            >
              <T>إعادة المحاولة</T>
            </Button>
          </CardContent>
        </Card>
      )}

      {mode !== 'individual' && groupQuery.isError && (
        <Card className="bg-red-950/20 border-red-800/40">
          <CardContent className="p-6 text-center space-y-3">
            <AlertTriangle className="h-8 w-8 mx-auto text-red-400" />
            <p className="text-red-300 text-sm font-semibold"><T>تعذر تحميل تقرير المجموعة</T></p>
            <Button
              variant="outline"
              size="sm"
              className="border-red-800/50 text-red-200 hover:bg-red-900/30"
              onClick={() => groupQuery.refetch()}
            >
              <T>إعادة المحاولة</T>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Render the active mode ── */}
      {mode === 'individual' && displayEmployeeId && singleDataset && (
        <div className="space-y-4 report-print">
          <EmployeeContextHeader dataset={singleDataset} locale={locale} />
          <OverviewCard dataset={singleDataset} locale={locale} />
          <DimensionsGrid dataset={singleDataset} locale={locale} />
          <ChangesSection dataset={singleDataset} locale={locale} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <PatternsSection dataset={singleDataset} locale={locale} onOpenSource={openSource} />
            <CrossSignalsSection dataset={singleDataset} locale={locale} />
          </div>
          <RiskSection dataset={singleDataset} locale={locale} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <AttentionItemsSection
              dataset={singleDataset}
              locale={locale}
              kind="strengths"
              onOpenSource={openSource}
            />
            <AttentionItemsSection
              dataset={singleDataset}
              locale={locale}
              kind="developmentAreas"
              onOpenSource={openSource}
            />
          </div>
          <RecommendationsSection dataset={singleDataset} locale={locale} onOpenSource={openSource} />
          <TimelineSection dataset={singleDataset} locale={locale} onOpenSource={openSource} />
          <BenchmarkSection dataset={singleDataset} locale={locale} />
          <EvidenceSourcesSection dataset={singleDataset} locale={locale} onOpenSource={openSource} />
          <DataQualitySection dataset={singleDataset} locale={locale} />
        </div>
      )}

      {mode === 'consolidated' && groupReport && (
        <ConsolidatedReportView
          report={groupReport}
          locale={locale}
          onOpenSource={openSource}
        />
      )}

      {mode === 'comparison' && groupReport && (
        <ComparisonReportView
          report={groupReport}
          locale={locale}
          onOpenSource={openSource}
        />
      )}

      <p className="text-[10px] text-slate-600 text-center pt-1 border-t border-slate-800/60">
        <T>تقرير رسمي — مصدر البيانات: قاعدة بيانات النظام للفترة المحددة. تُعرض القيم كما أنتجها المحركات الحتمية دون أي تقدير.</T>
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Mode A — Individual: reuse the single-employee sections
// ══════════════════════════════════════════════════════════════
import {
  EmployeeContextHeader,
  OverviewCard,
  DimensionsGrid,
  ChangesSection,
  PatternsSection,
  CrossSignalsSection,
  RiskSection,
  AttentionItemsSection,
  RecommendationsSection,
  TimelineSection,
  BenchmarkSection,
  EvidenceSourcesSection,
  DataQualitySection,
} from './sections';
import { currentMonthKey, buildMonthOptions } from '../quality-kpi/kpi-reports-shared';
// ════════════════════════════════════════════════════════════════
//  Mode B — Consolidated Group Report
// ═══════════════════════════════════════════════════════════════

function ConsolidatedReportView({
  report,
  locale,
  onOpenSource,
}: {
  report: PerformanceGroupReport;
  locale: Locale;
  onOpenSource: OpenSource;
}) {
  return (
    <div className="space-y-4 report-print">
      {/* Population header */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-100">{pick(locale, ['تقرير المجموعة المجمع', 'Consolidated Group Report'])}</h3>
            <span className="text-xs text-slate-400">{pick(locale, ['فترة', 'Period'])}: {periodLabel(report.period.monthKey, locale)}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-slate-300">
            <div><span className="text-slate-500">{pick(locale, ['الموظفون المطلوبون', 'Requested employees'])}: </span>{report.population.requestedEmployeeIds.length}</div>
            <div><span className="text-slate-500">{pick(locale, ['العقد التنظيمية المطلوبة', 'Requested org nodes'])}: </span>{report.population.requestedOrgNodeIds.length}</div>
            <div><span className="text-slate-500">{pick(locale, ['بعد إزالة التكرار', 'After dedup'])}: </span>{report.population.deduplicatedCount}</div>
            <div><span className="text-slate-500">{pick(locale, ['ببيانات', 'With data'])}: </span>{report.coverage.membersWithData} / {report.population.members.length}</div>
          </div>
          {(report.population.outOfScopeEmployeeIds.length > 0 || report.population.outOfScopeOrgNodeIds.length > 0) && (
            <div className="text-xs text-amber-300 border-t border-slate-700/50 pt-2">
              <span className="font-medium">{pick(locale, ['خارج النطاق (مُستبعدة):', 'Out of scope (excluded):'])}</span>{' '}
              {report.population.outOfScopeEmployeeIds.length > 0 && <span> {pick(locale, ['موظفون', 'employees'])}: {report.population.outOfScopeEmployeeIds.length}</span>}
              {report.population.outOfScopeOrgNodeIds.length > 0 && <span> {pick(locale, ['عقد', 'nodes'])}: {report.population.outOfScopeOrgNodeIds.length}</span>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Overview distribution */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 space-y-3">
          <h4 className="text-sm font-semibold text-slate-200">{pick(locale, ['توزيع الحالة العامة', 'Overview Distribution'])}</h4>
          <div className="flex flex-wrap gap-2">
            {([
              ['IMPROVING', 'يتحسن', 'Improving'],
              ['STABLE', 'مستقر', 'Stable'],
              ['NEEDS_COACHING', 'يحتاج توجيه', 'Needs Coaching'],
              ['PERFORMANCE_IMPROVEMENT_REVIEW', 'مراجعة تحسين', 'PIR'],
              ['MANAGEMENT_REVIEW', 'مراجعة إدارية', 'Mgmt Review'],
              ['INSUFFICIENT_DATA', 'بيانات غير كافية', 'Insufficient'],
            ] as const).map(([key, ar, en]) => {
              const count = report.overviewDistribution[key] ?? 0;
              if (count === 0) return null;
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] font-medium"
                >
                  {pick(locale, [ar, en])}: <span className="tabular-nums">{count}</span>
                </span>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Dimension rollups */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 space-y-3">
          <h4 className="text-sm font-semibold text-slate-200">{pick(locale, ['ملخص الأبعاد', 'Dimension Rollups'])}</h4>
          <div className="overflow-x-auto arm-scroll">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-slate-500 border-b border-slate-700/40">
                  <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['البعد', 'Dimension'])}</th>
                  <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['ببيانات', 'With Value'])}</th>
                  <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['المتوسط', 'Avg'])}</th>
                  <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['قوي/مستقر', 'Strong/Stable'])}</th>
                  <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['يحتاج انتباه', 'Needs Attention'])}</th>
                  <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['متراجع', 'Declining'])}</th>
                  <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['غير قابل للقياس', 'Not Measurable'])}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {report.dimensionRollups.map((d) => {
                  const dimLabel = pick(locale, PerformanceGroupLabels[d.key] ?? [d.key, d.key] as const);
                  return (
                    <tr key={d.key}>
                      <td className="py-1.5 px-2 text-slate-300">{dimLabel}</td>
                      <td className="py-1.5 px-2 text-slate-400 tabular-nums">{d.membersWithValue} / {d.membersWithValue + d.insufficientDataCount + d.notMeasurableCount + Object.values(d.statusCounts).reduce((a, b) => a + b, 0)}</td>
                      <td className="py-1.5 px-2 text-slate-200 tabular-nums">{d.averageValue !== null ? (d.averageValue.toFixed(1)) : '—'}</td>
                      <td className="py-1.5 px-2 text-emerald-300 tabular-nums">{d.statusCounts.STRONG + d.statusCounts.STABLE}</td>
                      <td className="py-1.5 px-2 text-amber-300 tabular-nums">{d.statusCounts.NEEDS_ATTENTION}</td>
                      <td className="py-1.5 px-2 text-red-300 tabular-nums">{d.statusCounts.DECLINING}</td>
                      <td className="py-1.5 px-2 text-violet-300 tabular-nums">{d.notMeasurableCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Shared strengths / common weaknesses */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-4 space-y-2">
            <h4 className="text-sm font-semibold text-emerald-300">{pick(locale, ['نقاط القوة المشتركة', 'Shared Strengths'])}</h4>
            {report.sharedStrengths.length === 0 ? (
              <p className="text-xs text-slate-500">{pick(locale, ['لا توجد نقاط قوة مشتركة', 'No shared strengths'])}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {report.sharedStrengths.slice(0, 8).map((s) => (
                  <span key={s.key} className="px-2 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 text-xs">
                    {pick(locale, PerformanceGroupLabels[s.key] ?? [s.key, s.key] as const)} ({s.memberCount})
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-4 space-y-2">
            <h4 className="text-sm font-semibold text-amber-300">{pick(locale, ['نقاط الضعف المشتركة', 'Common Weaknesses'])}</h4>
            {report.commonWeaknesses.length === 0 ? (
              <p className="text-xs text-slate-500">{pick(locale, ['لا توجد نقاط ضعف مشتركة', 'No common weaknesses'])}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {report.commonWeaknesses.slice(0, 8).map((w) => (
                  <span key={w.key} className="px-2 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs">
                    {pick(locale, PerformanceGroupLabels[w.key] ?? [w.key, w.key] as const)} ({w.memberCount})
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Repeated problems */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 space-y-3">
          <h4 className="text-sm font-semibold text-slate-200">{pick(locale, ['المشكلات المتكررة (عبر المجموعة)', 'Repeated Problems (Group)'])}</h4>
          {report.repeatedProblems.length === 0 ? (
            <p className="text-xs text-slate-500">{pick(locale, ['لا توجد مشكلات متكررة', 'No repeated problems'])}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {report.repeatedProblems.slice(0, 10).map((p) => (
                <span key={p.label} className="px-2 py-1 rounded-full border border-red-500/30 bg-red-500/10 text-red-200 text-xs">
                  {p.label} ({p.memberCount} {pick(locale, ['موظف', 'employees'])})
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Risk distribution */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 space-y-3">
          <h4 className="text-sm font-semibold text-slate-200">{pick(locale, ['توزيع المخاطر', 'Risk Distribution'])}</h4>
          {Object.keys(report.riskDistribution).length === 0 ? (
            <p className="text-xs text-slate-500">{pick(locale, ['لا توجد بيانات مخاطر', 'No risk data'])}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(['critical', 'high', 'medium', 'low'] as const).map((level) => {
                const count = report.riskDistribution[level] ?? 0;
                if (count === 0) return null;
                const colors: Record<string, string> = { critical: 'red', high: 'orange', medium: 'amber', low: 'slate' };
                return (
                  <span key={level} className={`px-2 py-1 rounded-full border text-[11px] font-medium ${colors[level]}-300 border-${colors[level]}-500/30 bg-${colors[level]}-500/10`}>
                    {pick(locale, PerformanceGroupLabels[level] ?? [level, level] as const)}: {count}
                  </span>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Improving / deteriorating trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-4 space-y-2">
            <h4 className="text-sm font-semibold text-emerald-300">{pick(locale, ['مؤشرات التحسن', 'Improving Trends'])}</h4>
            {report.improving.length === 0 ? (
              <p className="text-xs text-slate-500">{pick(locale, ['لا توجد مؤشرات تحسن', 'No improving trends'])}</p>
            ) : (
              <div className="max-h-48 overflow-y-auto arm-scroll space-y-1">
                {report.improving.slice(0, 15).map((t, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-1.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                    <span className="truncate">{t.employeeName}</span>
                    <span className="text-emerald-200 font-medium">+{t.delta?.toFixed(1) ?? '—'} {t.unit}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-4 space-y-2">
            <h4 className="text-sm font-semibold text-red-300">{pick(locale, ['مؤشرات التدهور', 'Deteriorating Trends'])}</h4>
            {report.deteriorating.length === 0 ? (
              <p className="text-xs text-slate-500">{pick(locale, ['لا توجد مؤشرات تدهور', 'No deteriorating trends'])}</p>
            ) : (
              <div className="max-h-48 overflow-y-auto arm-scroll space-y-1">
                {report.deteriorating.slice(0, 15).map((t, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-1.5 rounded bg-red-500/10 border border-red-500/20">
                    <span className="truncate">{t.employeeName}</span>
                    <span className="text-red-200 font-medium">{t.delta?.toFixed(1) ?? '—'} {t.unit}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Attention list */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 space-y-3">
          <h4 className="text-sm font-semibold text-slate-200">{pick(locale, ['قائمة الانتباه (تحتاج مراجعة)', 'Attention List'])}</h4>
          {report.attentionList.length === 0 ? (
            <p className="text-xs text-slate-500">{pick(locale, ['لا توجد موظفين في قائمة الانتباه', 'No employees needing attention'])}</p>
          ) : (
            <div className="overflow-x-auto arm-scroll">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-500 border-b border-slate-700/40">
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['الموظف', 'Employee'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['الحالة', 'Status'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['يحتاج انتباه', 'Needs Attention'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['متراجع', 'Declining'])}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {report.attentionList.map((a, i) => (
                    <tr key={i}>
                      <td className="py-1.5 px-2 text-slate-300">{a.employeeName}</td>
                      <td className="py-1.5 px-2 text-slate-400">{pick(locale, PerformanceGroupLabels[a.overviewStatus] ?? [a.overviewStatus, a.overviewStatus] as const)}</td>
                      <td className="py-1.5 px-2 text-amber-300">{a.needsAttention.map((k) => pick(locale, PerformanceGroupLabels[k] ?? [k, k] as const)).join(', ')}</td>
                      <td className="py-1.5 px-2 text-red-300">{a.declining.map((k) => pick(locale, PerformanceGroupLabels[k] ?? [k, k] as const)).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data quality notes */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 space-y-1">
          <h4 className="text-sm font-semibold text-slate-200">{pick(locale, ['ملاحظات جودة البيانات', 'Data Quality Notes'])}</h4>
          {report.dataQualityNotes.length === 0 ? (
            <p className="text-xs text-slate-500">{pick(locale, ['لا توجد ملاحظات جوهرية', 'No material notes'])}</p>
          ) : (
            <ul className="text-xs text-slate-400 space-y-0.5 list-disc list-inside">
              {report.dataQualityNotes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
//  Mode C — Comparison Report (by REAL org membership)
// ═══════════════════════════════════════════════════════════════

function ComparisonReportView({
  report,
  locale,
  onOpenSource,
}: {
  report: PerformanceGroupReport;
  locale: Locale;
  onOpenSource: OpenSource;
}) {
  return (
    <div className="space-y-4 report-print">
      {/* Unit comparisons */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 space-y-3">
          <h3 className="text-lg font-bold text-slate-100">{pick(locale, ['مقارنة الوحدات التنظيمية', 'Organizational Unit Comparison'])}</h3>
          <p className="text-xs text-slate-400">{pick(locale, ['مقارنة أبعاد حسب العضوية الفعلية في الفرق/الأقسام/الشركات/المدراء (وليس الاختيار العشوائي)', 'Dimensions compared by ACTUAL org membership (teams/departments/companies/managers), never the arbitrary selection.'])}</p>
          {!report.comparison || report.comparison.units.length === 0 ? (
            <p className="text-xs text-slate-500">{pick(locale, ['لا توجد وحدات للمقارنة', 'No units to compare'])}</p>
          ) : (
            <div className="overflow-x-auto arm-scroll">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-500 border-b border-slate-700/40">
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['النوع', 'Type'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['الوحدة', 'Unit'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['الأعضاء', 'Members'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['ببيانات', 'With Data'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['الجودة', 'Quality'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['تنفيذ الحجز', 'Booking Exec.'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['متابعة الإجراءات', 'Action F/U'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['الحضور', 'Attendance'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['التقفيلات', 'Closures'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['انتباه', 'Attention'])}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {report.comparison!.units.map((u, i) => (
                    <tr key={i}>
                      <td className="py-1.5 px-2 text-slate-500 font-medium">{pick(locale, PerformanceGroupLabels[u.unitType] ?? [u.unitType, u.unitType] as const)}</td>
                      <td className="py-1.5 px-2 text-slate-300">{u.label}</td>
                      <td className="py-1.5 px-2 text-slate-400 tabular-nums">{u.memberCount}</td>
                      <td className="py-1.5 px-2 text-slate-400 tabular-nums">{u.membersWithValue}</td>
                      <td className="py-1.5 px-2 tabular-nums">{u.avgQuality !== null ? formatPercentage(u.avgQuality, { locale, maximumFractionDigits: 1 }) : '—'}</td>
                      <td className="py-1.5 px-2 tabular-nums">{u.avgBookingCompletion !== null ? formatPercentage(u.avgBookingCompletion, { locale, maximumFractionDigits: 1 }) : '—'}</td>
                      <td className="py-1.5 px-2 tabular-nums">{u.avgActionFollowUpCompletion !== null ? formatPercentage(u.avgActionFollowUpCompletion, { locale, maximumFractionDigits: 1 }) : '—'}</td>
                      <td className="py-1.5 px-2 tabular-nums">{u.avgAttendance !== null ? formatPercentage(u.avgAttendance, { locale, maximumFractionDigits: 1 }) : '—'}</td>
                      <td className="py-1.5 px-2 tabular-nums">{u.closedDealsTotal}</td>
                      <td className="py-1.5 px-2 tabular-nums">{u.attentionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manager analysis */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 space-y-3">
          <h3 className="text-lg font-bold text-slate-100">{pick(locale, ['تحليل المدراء', 'Manager Analysis'])}</h3>
          <p className="text-xs text-slate-400">{pick(locale, ['تقسيم المجموعة حسب المدير الفعلي (أقرب جد فريق) — اختيار عشوائي لا يُختصر بفريق مُدار', 'Grouped by the ACTUAL manager (nearest team ancestor), never by arbitrary selection.'])}</p>
          {report.managerAnalysis === null || report.managerAnalysis.length === 0 ? (
            <p className="text-xs text-slate-500">{pick(locale, ['لا توجد بيانات مدراء', 'No manager data'])}</p>
          ) : (
            <div className="overflow-x-auto arm-scroll">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-slate-500 border-b border-slate-700/40">
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['المدير', 'Manager'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['الأعضاء', 'Members'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['التوزيع', 'Distribution'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['يحتاجون تدخلاً', 'Need Intervention'])}</th>
                    <th className="text-start py-1.5 px-2 font-medium">{pick(locale, ['أبعاد متراجعة', 'Declining Dims'])}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {report.managerAnalysis!.map((m, i) => (
                    <tr key={i}>
                      <td className="py-1.5 px-2 text-slate-300">{m.manager}</td>
                      <td className="py-1.5 px-2 tabular-nums">{m.memberCount}</td>
                      <td className="py-1.5 px-2">
                        {Object.entries(m.overviewDistribution).map(([status, count]) => (
                          <span key={status} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border">
                            {pick(locale, PerformanceGroupLabels[status] ?? [status, status] as const)}: {count}
                          </span>
                        ))}
                      </td>
                      <td className="py-1.5 px-2 text-red-300">{m.needsIntervention.join(', ') || '—'}</td>
                      <td className="py-1.5 px-2 text-amber-300">
                        {Object.entries(m.decliningDimensionCounts).map(([dim, count]) => (
                          <span key={dim} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-amber-500/30 bg-amber-500/10">
                            {pick(locale, PerformanceGroupLabels[dim] ?? [dim, dim] as const)}: {count}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data quality notes */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 space-y-1">
          <h4 className="text-sm font-semibold text-slate-200">{pick(locale, ['ملاحظات جودة البيانات', 'Data Quality Notes'])}</h4>
          {report.dataQualityNotes.length === 0 ? (
            <p className="text-xs text-slate-500">{pick(locale, ['لا توجد ملاحظات جوهرية', 'No material notes'])}</p>
          ) : (
            <ul className="text-xs text-slate-400 space-y-0.5 list-disc list-inside">
              {report.dataQualityNotes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}