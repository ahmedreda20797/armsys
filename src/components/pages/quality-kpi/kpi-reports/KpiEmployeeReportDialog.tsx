'use client';

// ══════════════════════════════════════════════════════════════
//  KpiEmployeeReportDialog — employee report drill-down (§31)
//
//  Opens from any employee row / affected-employee chip. Contains
//  the deep view (summary · components · trend · evidence) + the
//  on-demand visibility diagnose. Uses the canonical employee KPI
//  report endpoint — no second assembly.
// ══════════════════════════════════════════════════════════════

import { Printer, Stethoscope, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { openPrintReport } from '@/components/print/print-report-store';
import { employeeKpiReportToPrintModel } from '@/components/print/print-adapters';
import { useKpiEmployeeReport, useKpiVisibilityDiagnose } from '@/hooks/use-kpi-queries';
import { useAppStore } from '@/lib/store';
import type { EmployeeKpiReport } from '@/lib/kpi-reporting';
import { T } from '@/lib/i18n/T';
import { useState } from 'react';
import { EmployeeReportDetail } from './KpiEmployeeReportDetail';

export function KpiEmployeeReportDialog({
  employeeId,
  month,
  employeeName,
  open,
  onOpenChange,
}: {
  employeeId: string | null;
  month: string;
  employeeName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [diagnoseRequested, setDiagnoseRequested] = useState(false);
  const reportQuery = useKpiEmployeeReport(open ? employeeId : null, month);
  const diagnoseQuery = useKpiVisibilityDiagnose(
    open && diagnoseRequested ? employeeId : null,
    month,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl bg-slate-950 border-slate-700/60" side="left">
        <SheetHeader className="no-print">
          <SheetTitle className="flex items-center justify-between gap-2 flex-wrap">
            <span>
              <T>تقرير أداء الموظف</T>
              {employeeName ? <span className="text-brand-300"> — {employeeName}</span> : null}
            </span>
            <span className="flex items-center gap-1.5">
              {/* §EMPLOYEE-PERFORMANCE-HUB — open the full performance
                  workspace for this employee + period. */}
              {employeeId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-brand-500/30 text-brand-300 hover:bg-brand-500/10"
                  onClick={() => {
                    onOpenChange(false);
                    useAppStore.getState().navigateTo('employeePerformanceHub', undefined, { employeeId, month });
                  }}
                >
                  <Target className="h-4 w-4" />
                  <T>مركز الأداء</T>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={!employeeId}
                onClick={() => {
                  setDiagnoseRequested(true);
                  void diagnoseQuery.refetch();
                }}
              >
                <Stethoscope className="h-4 w-4" />
                <T>تشخيص الظهور</T>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={!reportQuery.data}
                onClick={() =>
                  openPrintReport(employeeKpiReportToPrintModel(
                    reportQuery.data as EmployeeKpiReport,
                    month,
                  ))
                }
              >
                <Printer className="h-4 w-4" />
                <T>طباعة / PDF</T>
              </Button>
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          {!employeeId ? (
            <p className="text-sm text-slate-500"><T>لا يوجد موظف محدد.</T></p>
          ) : reportQuery.isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-48 w-full rounded-2xl bg-slate-800/40" />
              <Skeleton className="h-64 w-full rounded-2xl bg-slate-800/40" />
            </div>
          ) : reportQuery.isError ? (
            <p className="rounded-xl border border-red-800/40 bg-red-950/20 p-4 text-sm text-red-300">
              <T>تعذر تحميل التقرير — أعد المحاولة لاحقًا.</T>
            </p>
          ) : reportQuery.data ? (
            <EmployeeReportDetail report={reportQuery.data as EmployeeKpiReport} month={month} />
          ) : null}

          {diagnoseRequested && diagnoseQuery.data ? (
            <div className="no-print rounded-xl border border-slate-700/40 bg-slate-900/50 p-3 text-xs text-slate-300">
              <p className="mb-1 font-medium text-slate-200"><T>تشخيص الظهور</T></p>
              <p>{(diagnoseQuery.data as { verdict?: string }).verdict}</p>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
