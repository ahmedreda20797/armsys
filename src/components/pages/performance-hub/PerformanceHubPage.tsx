'use client';

// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — مركز أداء الموظف
//
//  A READ-ONLY analytical workspace answering one managerial question:
//  "What is happening with this employee, why does it matter, what
//  evidence supports it, and what should I do next?"
//
//  ARCHITECTURE:
//    • ONE dataset (/api/performance-hub) built by the canonical
//      engines — the UI never recalculates a business metric.
//    • Selection (employee + period) persists through usePageState
//      (the existing page-state architecture — survives Back).
//    • Every insight row carries its evidence source; clicking
//      navigates through navigateTo(page, highlightId, navParams) —
//      the ONE navigation system (no new router).
//    • Risk / HR blocks are server-gated; restricted blocks arrive
//      as null and render explicit restricted states.
//    • Print routes through the shared print model host.
// ══════════════════════════════════════════════════════════════

import { useCallback, useMemo } from 'react';
import { AlertOctagon, CalendarDays, Printer, Search, ShieldX, Target } from 'lucide-react';
import { openPrintReport } from '@/components/print/print-report-store';
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
import { useMonthSnapshots, usePerformanceHub } from '@/hooks/use-kpi-queries';
import { usePageState } from '@/hooks/use-page-state';
import { useLanguage } from '@/lib/i18n/language-context';
import { T } from '@/lib/i18n/T';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import type { EmployeePerformanceHubDataset } from '@/lib/performance-hub';
import { buildMonthOptions, currentMonthKey } from '../quality-kpi/kpi-reports-shared';
import { performanceHubToPrintModel } from './hub-print';
import {
  AttentionItemsSection,
  BenchmarkSection,
  ChangesSection,
  CrossSignalsSection,
  DataQualitySection,
  DimensionsGrid,
  EmployeeContextHeader,
  EvidenceSourcesSection,
  OverviewCard,
  PatternsSection,
  RecommendationsSection,
  RiskSection,
  TimelineSection,
} from './sections';

export default function PerformanceHubPage() {
  const { canView } = usePermissions('employeePerformanceHub');
  if (!canView) return <UnauthorizedState />;
  return <HubBody />;
}

function UnauthorizedState() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="w-20 h-20 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
        <ShieldX className="w-10 h-10 text-red-400" />
      </div>
      <h2 className="text-xl font-bold text-slate-200 mb-2"><T>صلاحية غير كافية</T></h2>
      <p className="text-slate-400 text-center max-w-md">
        <T>لا تملك صلاحية عرض مركز أداء الموظف. هذه الصفحة تتطلب صلاحية ملف الموظف.</T>
      </p>
    </div>
  );
}

export type OpenSource = (page: string, highlightId: string | null, navParams: Record<string, string>) => void;

// ─── Hub body ────────────────────────────────────────────────
function HubBody() {
  const { locale } = useLanguage();
  // Deep-link seeds (§nav-params): an entry point (Employee 360, Risk
  // Center, KPI Reports, Employees, Smart Report) navigates with the
  // employee (+ optional month); the explicit seed wins over the
  // remembered state for this mount — the ObservationsPage doctrine.
  const navEmployeeId = useAppStore((s) => {
    const v = s.navParams.employeeId;
    return typeof v === 'string' && v.length > 0 ? v : null;
  });
  const navMonth = useAppStore((s) => {
    const m = s.navParams.month;
    return typeof m === 'string' && m.length === 7 && m[4] === '-' ? m : null;
  });
  const hasNavSeed = navEmployeeId !== null;
  // §PAGE-STATE — the selection (employee + period) persists per user
  // and survives internal navigation / browser Back (existing system).
  const [view, setView] = usePageState<{ employeeId: string; month: string }>({
    page: 'employeePerformanceHub',
    slot: 'view',
    version: 1,
    initial: () => ({ employeeId: navEmployeeId ?? '', month: navMonth ?? currentMonthKey() }),
    skipRestore: hasNavSeed,
    validate: (raw) =>
      raw && typeof raw === 'object'
      && typeof (raw as { employeeId?: unknown }).employeeId === 'string'
      && typeof (raw as { month?: unknown }).month === 'string'
        ? (raw as { employeeId: string; month: string })
        : null,
  });
  const employeeId = view.employeeId;
  const month = view.month;

  const employeesQuery = useEmployees();
  const snapshotsQuery = useMonthSnapshots();

  const monthOptions = useMemo(
    () => buildMonthOptions(snapshotsQuery.data as Array<{ monthKey: string; status: 'open' | 'closed' }> | undefined, locale),
    [snapshotsQuery.data, locale],
  );
  // §PERIOD-TRUTH — the EFFECTIVE month drives everything downstream.
  const effectiveMonth = monthOptions.some((o) => o.value === month) ? month : monthOptions[0]?.value ?? month;

  const hubQuery = usePerformanceHub(employeeId || null, effectiveMonth);
  const dataset = hubQuery.data as EmployeePerformanceHubDataset | undefined;

  const navigateTo = useAppStore((s) => s.navigateTo);
  const visiblePageIds = usePermissions().visiblePages.map((p) => p.id);
  const visibleSet = useMemo(() => new Set(visiblePageIds), [visiblePageIds]);

  /** Evidence deep link — permission-checked (a page the viewer cannot see is never opened). */
  const openSource = useCallback<OpenSource>((page, highlightId, navParams) => {
    if (!visibleSet.has(page)) return;
    navigateTo(page, highlightId ?? undefined, navParams);
  }, [navigateTo, visibleSet]);

  const handlePrint = useCallback(() => {
    if (!dataset) return;
    openPrintReport(performanceHubToPrintModel(dataset, locale));
  }, [dataset, locale]);

  return (
    <div className="space-y-4 p-1">
      {/* ── §7 unified page identity (controls never print) ── */}
      <PageIdentity
        pageId="employeePerformanceHub"
        icon={<Target className="size-5" />}
        iconClassName="bg-brand-500/15 border-brand-500/30 text-brand-400"
        className="flex-wrap items-start no-print"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            disabled={!dataset}
            className="border-slate-700/50 text-slate-300 hover:bg-slate-800/60"
          >
            <Printer className="h-4 w-4 ml-1.5" />
            <T>طباعة</T>
          </Button>
        }
      />

      {/* ── Selection: ONE employee selector + ONE canonical period selector ── */}
      <Card className="no-print bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-end">
          <div className="space-y-1.5">
            <Label><T>الموظف</T></Label>
            <EmployeeSearchInput
              employees={employeesQuery.data ?? []}
              value={employeeId}
              onChange={(id) => setView((s) => ({ ...s, employeeId: id }))}
              placeholder="اكتب اسم أو حرف من اسم الموظف..."
              showDepartment
              includeInactive
            />
          </div>
          <div className="space-y-1.5 min-w-[150px]">
            <Label><T>الشهر الحالي</T></Label>
            <Button
              variant={effectiveMonth === currentMonthKey() ? 'secondary' : 'outline'}
              size="sm"
              className="w-full border-slate-700/50 text-slate-300"
              onClick={() => setView((s) => ({ ...s, month: currentMonthKey() }))}
            >
              <CalendarDays className="h-4 w-4 ml-1" />
              <T>الشهر الحالي</T>
            </Button>
          </div>
          <div className="space-y-1.5 min-w-[190px]">
            <Label><T>أخرى (الأشهر المغلقة والسابقة)</T></Label>
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
        </CardContent>
      </Card>

      {/* ── Empty state ── */}
      {!employeeId && (
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-12 text-center text-slate-400 space-y-2">
            <Search className="h-8 w-8 mx-auto opacity-50" />
            <p><T>اختر موظفًا لعرض مركز أدائه</T></p>
            <p className="text-xs text-slate-500"><T>يجمع المركز الجودة والمتابعات والحضور والصفقات والمخاطر والموارد البشرية في صورة واحدة مدعومة بالأدلة.</T></p>
          </CardContent>
        </Card>
      )}

      {/* ── Loading ── */}
      {employeeId !== '' && hubQuery.isLoading && (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-28 w-full rounded-2xl bg-slate-800/40" />
          <Skeleton className="h-40 w-full rounded-2xl bg-slate-800/40" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl bg-slate-800/40" />
            ))}
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {employeeId !== '' && hubQuery.isError && (
        <Card className="bg-red-950/20 border-red-800/40">
          <CardContent className="p-6 text-center space-y-3">
            <AlertOctagon className="h-8 w-8 mx-auto text-red-400" />
            <p className="text-red-300 text-sm font-semibold"><T>تعذر تحميل مركز الأداء</T></p>
            <p className="text-xs text-red-200/70 font-mono" dir="ltr">
              {hubQuery.error instanceof Error ? hubQuery.error.message : '—'}
            </p>
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

      {/* ── The Hub ── */}
      {employeeId !== '' && dataset && (
        <div className="space-y-4 report-print">
          <EmployeeContextHeader dataset={dataset} locale={locale} />
          <OverviewCard dataset={dataset} locale={locale} />
          <DimensionsGrid dataset={dataset} locale={locale} />
          <ChangesSection dataset={dataset} locale={locale} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <PatternsSection dataset={dataset} locale={locale} onOpenSource={openSource} />
            <CrossSignalsSection dataset={dataset} locale={locale} />
          </div>
          <RiskSection dataset={dataset} locale={locale} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <AttentionItemsSection
              dataset={dataset}
              locale={locale}
              kind="strengths"
              onOpenSource={openSource}
            />
            <AttentionItemsSection
              dataset={dataset}
              locale={locale}
              kind="developmentAreas"
              onOpenSource={openSource}
            />
          </div>
          <RecommendationsSection dataset={dataset} locale={locale} onOpenSource={openSource} />
          <TimelineSection dataset={dataset} locale={locale} onOpenSource={openSource} />
          <BenchmarkSection dataset={dataset} locale={locale} />
          <EvidenceSourcesSection dataset={dataset} locale={locale} onOpenSource={openSource} />
          <DataQualitySection dataset={dataset} locale={locale} />

          <p className="text-[10px] text-slate-600 text-center pt-1 border-t border-slate-800/60">
            <T>تقرير رسمي — مصدر البيانات: قاعدة بيانات النظام للفترة المحددة. تُعرض القيم كما أنتجها المحركات الحتمية دون أي تقدير.</T>
          </p>
        </div>
      )}
    </div>
  );
}
