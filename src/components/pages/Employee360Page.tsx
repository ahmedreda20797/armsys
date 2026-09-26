'use client';

// ══════════════════════════════════════════════════════════════
//  Employee 360 — Executive Employee Profile (REBUILD)
//
//  ONE page, ONE data model, ONE authorization model:
//    • the API (/api/employee-360/[id]) returns the canonical
//      Employee360ViewModel — every metric is a canonical service
//      output (KPI engine, performance-intelligence dataset, HR
//      decision support, org tree, stored attendance results);
//      section gating + field redaction are enforced server-side.
//    • the page is a presentation layer: sections, hierarchy,
//      period control, drill-downs — zero business calculations.
//    • the reporting period is explicit and part of the cache
//      identity (instant cached restore + background revalidate).
//    • data states are never conflated: no-data ≠ zero ≠ unknown
//      ≠ no-permission ≠ configuration-required.
// ══════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, ArrowRight, Loader2, UserCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import { useEmployee360 } from '@/hooks/use-queries';
import { queryKeys } from '@/lib/cache/query-keys';
import { useQueryClient } from '@tanstack/react-query';
import { DataFreshnessIndicator } from '@/components/shared/DataFreshnessIndicator';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatMonthKey } from '@/lib/i18n/format';
import { PeriodBar } from '@/components/pages/employee360/PeriodBar';
import { Employee360Header } from '@/components/pages/employee360/Employee360Header';
import { ExecutiveSummary } from '@/components/pages/employee360/ExecutiveSummary';
import { PerformanceSection } from '@/components/pages/employee360/PerformanceSection';
import { DealsSection } from '@/components/pages/employee360/DealsSection';
import { EmployeePerformanceSection } from '@/components/pages/employee360/EmployeePerformanceSection';
import {
  QualitySection,
  AttendanceSection,
  FollowUpsSection,
  ComplaintsCapaSection,
  HrDeductionsSection,
  RequestsSection,
  ObservationsSummarySection,
} from '@/components/pages/employee360/OpsSections';
import { DecisionSupportSection, AttentionSection } from '@/components/pages/employee360/DecisionSupportSection';
import { OrganizationSection, EmployeeDetailsSection } from '@/components/pages/employee360/OrgDetailsSection';
import { TimelineSection } from '@/components/pages/employee360/TimelineSection';
import { NoPermissionState } from '@/components/pages/employee360/ui';
import type { Employee360Data } from '@/lib/employee-360/client-types';

// ─── Animated page shell ─────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="space-y-5" aria-busy>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-lg" />
          <Skeleton className="h-7 w-44 rounded-lg" />
        </div>
        <Skeleton className="size-9 rounded-xl" />
      </div>
      <Skeleton className="h-36 rounded-2xl" />
      <Skeleton className="h-10 rounded-xl" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-52 rounded-2xl" />
      <Skeleton className="h-40 rounded-2xl" />
    </div>
  );
}

function EmployeeNotFound({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="mb-6 flex size-20 items-center justify-center rounded-full border border-border bg-muted/50">
        <UserCircle className="size-10 text-muted-foreground/60" />
      </div>
      <h2 className="mb-2 text-xl font-bold text-foreground"><T>الموظف غير موجود</T></h2>
      <p className="mb-6 text-muted-foreground"><T>لم يتم العثور على بيانات الموظف المطلوب</T></p>
      <Button onClick={onBack} className="bg-linear-to-r from-brand-600 to-brand-700 text-white">
        <ArrowRight className="me-2 size-4" />
        <T>رجوع</T>
      </Button>
    </div>
  );
}

function ErrorState({ message, onRetry, onBack }: { message: string; onRetry: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="mb-6 flex size-16 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10">
        <AlertCircle className="size-8 text-amber-500" />
      </div>
      <h2 className="mb-2 text-xl font-bold text-foreground"><T>خطأ</T></h2>
      <p className="mb-6 text-muted-foreground">{message}</p>
      <div className="flex gap-3">
        <Button onClick={onRetry} className="bg-linear-to-r from-brand-600 to-brand-700 text-white">
          <Loader2 className="me-1 size-4" />
          <T>إعادة المحاولة</T>
        </Button>
        <Button onClick={onBack} variant="outline" className="border-border">
          <ArrowRight className="me-2 size-4" />
          <T>رجوع</T>
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────

export default function Employee360Page({ employeeId: propEmployeeId, onClose }: {
  employeeId?: string;
  onClose?: () => void;
} = {}) {
  const { locale } = useLanguage();
  const { canView } = usePermissions('employees');
  const storeNavParams = useAppStore((s) => s.navParams);
  const storeGoBack = useAppStore((s) => s.goBack);
  const employeeId = propEmployeeId || storeNavParams.employeeId || '';
  const handleClose = onClose || storeGoBack;

  const queryClient = useQueryClient();
  const [month, setMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // ── Cache-backed profile snapshot (§27): cached data renders
  //    immediately and revalidates when stale; nothing blanks. ──
  const e360Query = useEmployee360(employeeId, month, canView);
  const data = (e360Query.data && !('__notFound' in e360Query.data)
    ? e360Query.data
    : null) as Employee360Data | null;
  const notFound = Boolean(e360Query.data && (e360Query.data as { __notFound?: boolean }).__notFound === true);
  const loading = canView && !!employeeId && e360Query.isLoading && !e360Query.data;
  const error = canView && e360Query.isError && !e360Query.data
    ? (e360Query.error instanceof Error ? e360Query.error.message : 'فشل في تحميل بيانات الموظف')
    : null;

  useEffect(() => {
    if (!employeeId) handleClose();
  }, [employeeId, handleClose]);

  const refresh = useMemo(() => async () => {
    if (!employeeId) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.employee360(employeeId) });
  }, [queryClient, employeeId]);

  const periodLabel = formatMonthKey(data?.period.monthKey ?? month, locale);

  // ═══ Permission denied ═══
  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="mb-6 flex size-16 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
          <XCircle className="size-8 text-red-500" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-foreground"><T>ليس لديك صلاحية</T></h2>
        <p className="mb-6 text-muted-foreground"><T>لا تملك صلاحية عرض ملف الموظف</T></p>
        <Button onClick={handleClose} className="bg-linear-to-r from-brand-600 to-brand-700 text-white">
          <ArrowRight className="me-2 size-4" />
          <T>رجوع</T>
        </Button>
      </div>
    );
  }

  if (loading) return <PageSkeleton />;
  if (notFound) return <EmployeeNotFound onBack={handleClose} />;
  if (error || !data) {
    return <ErrorState message={error || 'لا توجد بيانات'} onRetry={() => void refresh()} onBack={handleClose} />;
  }

  const s = data.sections;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      // Deterministic subtree exit — without an explicit exit the
      // overlay panel's unmount (AnimatePresence) can hang, leaving an
      // invisible pointer-blocking layer over the workspace.
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      className="space-y-4 print:space-y-3"
    >
      {/* Sticky context bar — stays useful while scrolling */}
      <div className="sticky top-0 z-10 -mx-1 bg-background/85 px-1 py-2 backdrop-blur-sm print:static">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-brand-600 to-brand-800 text-white">
              <UserCircle className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold leading-tight text-foreground">
                {data.employee?.name ?? <T>ملف الموظف 360°</T>}
              </h1>
              <p className="text-[11px] text-muted-foreground">
                <T>ملف الموظف 360°</T> · {periodLabel}
                {data.executiveSummary?.overall.state === 'value' && data.executiveSummary.overall.weightedTotal !== null && (
                  <> · <span className="font-semibold text-foreground" dir="ltr">
                    <T>التقييم</T> {data.executiveSummary.overall.weightedTotal}
                  </span></>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="close"
          >
            <XCircle className="size-4" />
          </button>
        </div>
      </div>

      {/* Reporting period — explicit, above everything period-sensitive */}
      <div className="e360-noprint"><PeriodBar
        month={month}
        onChange={setMonth}
        isFetching={e360Query.isFetching && !e360Query.isLoading}
        freshness={<DataFreshnessIndicator revalidating={e360Query.isFetching && !e360Query.isLoading} />}
      /></div>

      {/* ── WHO + WHERE ── identity header (basicInfo gate) ── */}
      {data.employee ? (
        <Employee360Header employee={data.employee} organization={data.organization} />
      ) : (
        <section className="rounded-2xl border border-border/60 bg-card/80 px-5 py-6">
          <NoPermissionState />
        </section>
      )}

      {/* ── HOW IS THE EMPLOYEE PERFORMING + first signals ── */}
      {data.executiveSummary && data.employee && (
        <ExecutiveSummary data={data.executiveSummary} monthKey={data.period.monthKey} employeeId={data.employee.id} />
      )}

      {/* ── Needs attention (canonical risk gate) ── */}
      {s.risk && <AttentionSection items={data.attention} />}

      {/* ── PERFORMANCE OVERVIEW ── canonical KPI engine ── */}
      {s.performance && data.kpi && data.trend ? (
        <PerformanceSection
          kpi={data.kpi}
          trend={data.trend}
          targetScore={data.executiveSummary?.overall.targetScore ?? null}
          periodLabel={periodLabel}
        />
      ) : s.performance ? (
        <section className="rounded-2xl border border-border/60 bg-card/80 px-5 py-6">
          <NoPermissionState />
        </section>
      ) : null}

      {/* ── Stored monthly history + career (progressive disclosure,
          its own cache identity via the employee-performance reader) ── */}
      {s.performance && data.employee && (
        <details className="group rounded-2xl border border-border/60 bg-card/80">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5">
            <span className="text-sm font-semibold text-foreground"><T>السجل الشهري المخزن والمسار الوظيفي</T></span>
            <span className="text-[11px] text-muted-foreground"><T>نتائج الحضور / الجودة / HR المخزنة</T></span>
          </summary>
          <div className="border-t border-border/50 px-5 py-4">
            <EmployeePerformanceSection employeeId={employeeId} />
          </div>
        </details>
      )}

      {/* ── DEAL PERFORMANCE ── §DEAL-DATES dimensions ── */}
      {s.deals && data.deals && data.employee && (
        <DealsSection
          deals={data.deals}
          employeeId={data.employee.id}
          monthKey={data.period.monthKey}
          periodLabel={periodLabel}
        />
      )}

      {/* ── OPERATIONAL SECTIONS ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {s.attendance && data.attendance && (
          <div className="xl:col-span-2"><AttendanceSection attendance={data.attendance} periodLabel={periodLabel} /></div>
        )}
        {s.quality && data.quality && (
          <div className="xl:col-span-2">
            <QualitySection quality={data.quality} periodLabel={periodLabel} />
          </div>
        )}
        {s.observations && data.quality && (
          <div className="xl:col-span-2">
            <ObservationsSummarySection
              observations={data.quality.observations}
              employeeId={employeeId}
              monthKey={data.period.monthKey}
              periodLabel={periodLabel}
            />
          </div>
        )}
        {s.followUps && data.followUps && data.employee && (
          <FollowUpsSection followUps={data.followUps} employeeId={data.employee.id} periodLabel={periodLabel} />
        )}
        {s.requests && data.requests && <RequestsSection requests={data.requests} periodLabel={periodLabel} />}
        {s.complaints && s.capa && data.complaints && data.capa && data.employee && (
          <div className="xl:col-span-2">
            <ComplaintsCapaSection
              complaints={data.complaints}
              capa={data.capa}
              employeeId={data.employee.id}
              periodLabel={periodLabel}
            />
          </div>
        )}
        {s.hrDeductions && data.hrDeductions && (
          <div className="xl:col-span-2"><HrDeductionsSection hr={data.hrDeductions} monthKey={data.period.monthKey} /></div>
        )}
      </div>

      {/* ── DECISION SUPPORT ── canonical HR-safe projection ── */}
      {s.decisionSupport && data.decisionSupport && (
        <DecisionSupportSection decision={data.decisionSupport} />
      )}

      {/* ── ORGANIZATION CONTEXT + DETAILS (progressive disclosure) ── */}
      <div className="space-y-4">
        {s.organization && data.organization && data.employee && (
          <OrganizationSection organization={data.organization} employeeId={data.employee.id} />
        )}
        {data.employee && <EmployeeDetailsSection employee={data.employee} />}
      </div>

      {/* ── EVIDENCE / TIMELINE ── */}
      {s.timeline && <TimelineSection events={data.timeline} periodLabel={periodLabel} />}

      {/* Debug data-source map (§26 diagnostics — dev only) */}
      {process.env.NODE_ENV === 'development' && (
        <details className="rounded-xl border border-dashed border-border/60 px-4 py-3 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer font-medium">Data source map (dev diagnostics)</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap" dir="ltr">{JSON.stringify({
            period: data.period,
            sections: data.sections,
            activity: data.activity,
            evidence: 'performance-intelligence dataset + hr-decision report',
          }, null, 2)}</pre>
        </details>
      )}
    </motion.div>
  );
}
