'use client';

// ══════════════════════════════════════════════════════════════
//  Smart Quality Report — Employee Performance Report UI (Phase 4)
//
//  A READ-ONLY, presentation-only report answering:
//  "What actually happened to this employee during this period?"
//
//  ARCHITECTURE (spec §1): the existing Performance Intelligence
//  dataset is the single source of truth — ONE analytical dataset
//  drives the whole report through the existing
//  usePerformanceIntelligence hook (spec §27). The UI NEVER
//  recalculates KPI values, never queries section sources
//  independently, and never invents information (spec §3).
//
//  This phase implements VERIFIED FACTS only — no Python, no AI,
//  no narratives (spec §30). The "Smart Analysis" area is a clearly
//  labeled future placeholder (spec §31).
// ══════════════════════════════════════════════════════════════

import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertOctagon,
  CalendarDays,
  FileSearch,
  Printer,
  Search,
  ShieldX,
} from 'lucide-react';
import { openPrintReport } from '@/components/print/print-report-store';
import { performanceDatasetToPrintModel } from '@/components/print/print-adapters';
import { PageIdentity } from '@/components/shared/PageIdentity';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import { useEmployees } from '@/hooks/use-queries';
import { usePerformanceIntelligence, useMonthSnapshots } from '@/hooks/use-kpi-queries';
import { usePageState } from '@/hooks/use-page-state';
import { useLanguage } from '@/lib/i18n/language-context';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import { buildMonthOptions, currentMonthKey } from '../kpi-reports-shared';
import {
  buildAttendance,
  buildComplaints,
  buildCapa,
  buildDataQuality,
  buildDeductions,
  buildEvidenceGroups,
  buildFollowUps,
  buildDeals,
  buildKpiComponents,
  buildKpiHero,
  buildObservations,
  buildReportHeader,
  buildRepeatedIssues,
  buildTrend,
  previousMonthKey,
} from './view-model';
import {
  AttendanceSection,
  CapaSection,
  ComplaintsSection,
  DataQualitySection,
  DealsSection,
  DeductionsSection,
  EvidenceSection,
  FollowUpsSection,
  KpiComponentsSection,
  KpiHeroSection,
  ObservationsSection,
  ReportHeaderSection,
  RepeatedIssuesSection,
  TrendSection,
} from './report-sections';
import { AnalyticsSection } from './AnalyticsSection';
import { AIAnalysisSection } from './AIAnalysisSection';
import {
  EvidencePreviewModal,
  type EvidencePreviewRequestState,
} from './EvidencePreviewModal';
import type { EvidenceDetailSelection } from './report-sections';
import {
  buildEvidenceNavigation,
} from '@/lib/evidence/evidence-navigation';
import {
  isEvidenceCollection,
  type EvidenceCollection,
} from '@/lib/evidence/evidence-collections';

export default function SmartQualityReportPage() {
  const { canView } = usePermissions('kpiReports');
  if (!canView) return <UnauthorizedState />;

  return <ReportBody />;
}

// ─── §25 Unauthorized state ──────────────────────────────────
function UnauthorizedState() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="w-20 h-20 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
        <ShieldX className="w-10 h-10 text-red-400" />
      </div>
      <h2 className="text-xl font-bold text-slate-200 mb-2">صلاحية غير كافية</h2>
      <p className="text-slate-400 text-center max-w-md">
        لا تملك صلاحية عرض تقرير الجودة الذكي. هذا التقرير يتطلب صلاحية تقارير KPI.
      </p>
    </div>
  );
}

// ─── Report body ─────────────────────────────────────────────
function ReportBody() {
  const { t } = useLanguage();
  // Phase 6.3 (§8/§51): Smart Quality Report is a LIVE view — the
  // dataset refetches for the selection; only the SELECTION
  // (employee + period) persists per user (never a data snapshot).
  const [reportView, setReportView] = usePageState<{
    employeeId: string;
    month: string;
  }>({
    page: 'smartQualityReport',
    slot: 'view',
    version: 1,
    initial: () => ({ employeeId: '', month: currentMonthKey() }),
    validate: (raw) =>
      raw && typeof raw === 'object'
      && typeof (raw as { employeeId?: unknown }).employeeId === 'string'
      && typeof (raw as { month?: unknown }).month === 'string'
        ? (raw as { employeeId: string; month: string })
        : null,
  });
  const employeeId = reportView.employeeId;
  const setEmployeeId = (v: string) => setReportView((s) => ({ ...s, employeeId: v }));
  const month = reportView.month;
  const setMonth = (v: string) => setReportView((s) => ({ ...s, month: v }));

  const employeesQuery = useEmployees();
  const snapshotsQuery = useMonthSnapshots();

  const monthOptions = useMemo(
    () => buildMonthOptions(snapshotsQuery.data as Array<{ monthKey: string; status: 'open' | 'closed' }> | undefined),
    [snapshotsQuery.data],
  );

  // Keep the selector valid when options load/refresh. §PERIOD-TRUTH:
  // the EFFECTIVE month drives EVERYTHING downstream — dataset query,
  // analytics and AI sections — so the period shown in the selector is
  // always the period actually being reported (a stale persisted month
  // that fell out of the options used to display one period while
  // loading another).
  const effectiveMonth = monthOptions.some((o) => o.value === month) ? month : monthOptions[0]?.value ?? month;
  const datasetQuery = usePerformanceIntelligence(employeeId || null, effectiveMonth);

  const navigateTo = useAppStore((s) => s.navigateTo);
  const visiblePageIds = usePermissions().visiblePages.map((p) => p.id);
  const visibleSet = useMemo(() => new Set(visiblePageIds), [visiblePageIds]);

  // ── Evidence Preview (Phase 5.2 §30) — modal state lives here so
  // the preview + navigation work over the whole report body.
  const [evidencePreview, setEvidencePreview] = useState<EvidencePreviewRequestState | null>(null);

  const handleViewEvidence = useCallback((selection: EvidenceDetailSelection) => {
    if (!isEvidenceCollection(selection.collection)) return;
    setEvidencePreview({
      collection: selection.collection,
      recordId: selection.recordId,
      projected: selection.projected,
      access: selection.access,
      isLoading: false,
    });
  }, []);

  const handleEvidenceNavigate = useCallback((collection: EvidenceCollection, recordId: string) => {
    if (!isEvidenceCollection(collection)) return;
    const intent = buildEvidenceNavigation(collection, recordId);
    // Respect source-page permissions (§37) — a page the viewer
    // cannot see is simply not opened.
    if (!visibleSet.has(intent.page)) return;
    // Phase 5.3 (spec §27): carry the record's OWN month (server-derived
    // meta.month) so month-filtered target pages (Quality Notes, Travel)
    // can make the exact record reachable — not just open the page.
    const recordMonth = evidencePreview?.projected?.meta?.month ?? null;
    const navParams = intent.exact && recordMonth
      ? { ...intent.navParams, month: recordMonth }
      : intent.navParams;
    setEvidencePreview(null); // close the preview — the target takes over (§33)
    navigateTo(intent.page, intent.highlightId ?? undefined, navParams);
  }, [navigateTo, visibleSet, evidencePreview]);

  // All view models derive from the ONE dataset — no second source.
  const views = useMemo(() => {
    const dataset = datasetQuery.data as EmployeePerformanceDataset | undefined;
    if (!dataset) return null;
    return {
      header: buildReportHeader(dataset),
      hero: buildKpiHero(dataset),
      components: buildKpiComponents(dataset),
      trend: buildTrend(dataset),
      observations: buildObservations(dataset),
      repeatedIssues: buildRepeatedIssues(dataset),
      deductions: buildDeductions(dataset),
      complaints: buildComplaints(dataset),
      capa: buildCapa(dataset),
      followUps: buildFollowUps(dataset),
      deals: buildDeals(dataset),
      attendance: buildAttendance(dataset),
      evidence: buildEvidenceGroups(dataset),
      dataQuality: buildDataQuality(dataset),
      generatedAt: dataset.generatedAt,
    };
  }, [datasetQuery.data]);

  // §PRINT — the dedicated clean A4 report host (not the live UI):
  // the tab's dataset projects into the shared print model adapter.
  const handlePrint = () => {
    if (!datasetQuery.data) return;
    openPrintReport(
      performanceDatasetToPrintModel(datasetQuery.data as Parameters<typeof performanceDatasetToPrintModel>[0], {
        title: 'تقرير الجودة الذكي',
      }),
    );
  };

  return (
    <div className="space-y-4 p-1">
      {/* ── §7 unified page identity (controls never print — spec §24) ── */}
      <PageIdentity
        pageId="smartQualityReport"
        icon={<FileSearch className="size-5" />}
        iconClassName="bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
        description={t('smart.identityDescription')}
        className="flex-wrap items-start no-print"
        actions={
          <Button variant="outline" size="sm" onClick={handlePrint} className="border-slate-700/50 text-slate-300 hover:bg-slate-800/60">
            <Printer className="h-4 w-4 ml-1.5" />
            {t('smart.print')}
          </Button>
        }
      />

      {/* ── §6 Period selector + employee picker ── */}
      <Card className="no-print bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3 items-end">
          <div className="space-y-1.5">
            <Label>{t('smart.employee')}</Label>
            <EmployeeSearchInput
              employees={employeesQuery.data ?? []}
              value={employeeId}
              onChange={(id) => setEmployeeId(id)}
              placeholder={t('smart.employeePlaceholder')}
              showDepartment
            />
          </div>

          <div className="space-y-1.5 min-w-[150px]">
            <Label>{t('smart.mtd')}</Label>
            <Button
              variant={effectiveMonth === currentMonthKey() ? 'secondary' : 'outline'}
              size="sm"
              className="w-full border-slate-700/50 text-slate-300"
              onClick={() => setMonth(currentMonthKey())}
            >
              <CalendarDays className="h-4 w-4 ml-1" />
              {t('smart.mtdButton')}
            </Button>
          </div>

          <div className="space-y-1.5 min-w-[150px]">
            <Label>{t('smart.lastMonth')}</Label>
            <Button
              variant={effectiveMonth === previousMonthKey(currentMonthKey()) ? 'secondary' : 'outline'}
              size="sm"
              className="w-full border-slate-700/50 text-slate-300"
              onClick={() => setMonth(previousMonthKey(currentMonthKey()))}
            >
              <CalendarDays className="h-4 w-4 ml-1" />
              {monthOptions.find((o) => o.value === previousMonthKey(currentMonthKey()))?.label ?? t('smart.lastMonth')}
            </Button>
          </div>

          <div className="space-y-1.5 min-w-[190px]">
            <Label>{t('smart.historical')}</Label>
            <Select value={effectiveMonth} onValueChange={setMonth}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Empty state: no employee selected ── */}
      {!employeeId && (
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-12 text-center text-slate-400 space-y-2">
            <Search className="h-8 w-8 mx-auto opacity-50" />
            <p>{t('smart.pickEmployee')}</p>
            <p className="text-xs text-slate-500">{t('smart.pickEmployeeHint')}</p>
          </CardContent>
        </Card>
      )}

      {/* ── §25 Loading state ── */}
      {employeeId !== '' && datasetQuery.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-36 w-full rounded-2xl bg-slate-800/40" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Skeleton className="h-44 w-full rounded-2xl bg-slate-800/40" />
            <Skeleton className="h-44 w-full rounded-2xl bg-slate-800/40" />
            <Skeleton className="h-44 w-full rounded-2xl bg-slate-800/40" />
          </div>
          <Skeleton className="h-64 w-full rounded-2xl bg-slate-800/40" />
        </div>
      )}

      {/* ── §26 Error state — clear message, NO redirect, NO zeros ── */}
      {employeeId !== '' && datasetQuery.isError && (
        <Card className="bg-red-950/20 border-red-800/40">
          <CardContent className="p-6 text-center space-y-3">
            <AlertOctagon className="h-8 w-8 mx-auto text-red-400" />
            <p className="text-red-300 text-sm font-semibold">{t('smart.loadFailed')}</p>
            <p className="text-xs text-red-200/70 font-mono" dir="ltr">
              {datasetQuery.error instanceof Error ? datasetQuery.error.message : t('smart.unknownError')}
            </p>
            <p className="text-xs text-slate-400">
              {t('smart.loadFailedNote')}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="border-red-800/50 text-red-200 hover:bg-red-900/30"
              onClick={() => datasetQuery.refetch()}
            >
              {t('smart.retry')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── The report ── */}
      {employeeId !== '' && views && (
        <div className="space-y-4 report-print">
          {/* §3 Employee header */}
          <ReportHeaderSection view={views.header} />

          {/* §4 KPI hero */}
          <KpiHeroSection view={views.hero} />

          {/* §5 Components + §7 Trend — side by side on desktop */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <KpiComponentsSection view={views.components} />
            <TrendSection view={views.trend} />
          </div>

          {/* §8-§10 Quality performance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <ObservationsSection view={views.observations} />
            <RepeatedIssuesSection view={views.repeatedIssues} />
          </div>
          <DeductionsSection view={views.deductions} />

          {/* §11-§13 Complaints / CAPA / Follow-ups */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <ComplaintsSection view={views.complaints} />
            <CapaSection view={views.capa} />
          </div>
          <FollowUpsSection view={views.followUps} />

          {/* §14-§15 Operational + attendance context */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <DealsSection view={views.deals} />
            <AttendanceSection view={views.attendance} />
          </div>

          {/* §16/§17 Evidence */}
          <EvidenceSection
            groups={views.evidence}
            canOpenPage={(page) => visibleSet.has(page)}
            onOpenPage={(page) => navigateTo(page)}
            onViewEvidence={handleViewEvidence}
          />

          {/* §18 Data quality — limitations never hidden */}
          <DataQualitySection view={views.dataQuality} />

          {/* Phase 5.3 — deterministic statistical insights (TypeScript engine,
              FACT + ANALYSIS layer; degrades independently without
              touching the facts-only sections above) */}
          <AnalyticsSection employeeId={employeeId} month={effectiveMonth} />

          {/* Phase 6.2 — Smart Quality AI (§23): mounted in the reserved
              "التحليل الذكي" spot. ON-DEMAND only, evidence-auditable via
              the SAME EvidencePreviewModal, failure-isolated from the
              facts sections above. */}
          <AIAnalysisSection
            key={`${employeeId}:${effectiveMonth}`}
            employeeId={employeeId}
            month={effectiveMonth}
            onViewEvidence={handleViewEvidence}
          />

          <p className="text-[10px] text-slate-600 font-mono text-left" dir="ltr">
            generatedAt: {views.generatedAt}
          </p>
        </div>
      )}

      <EvidencePreviewModal
        state={evidencePreview}
        onOpenChange={(open) => { if (!open) setEvidencePreview(null); }}
        onNavigate={handleEvidenceNavigate}
      />
    </div>
  );
}
