'use client';

// ══════════════════════════════════════════════════════════════
//  KPI Reports Page — Quality KPI Reporting Layer (Phase 2)
//
//  Five logically separated reports over the existing KPI Framework
//  (spec §3): Employee · Monthly · MTD · Historical · Management
//  Summary. The page owns ONLY the shared period selector and tab
//  shell — every number comes from the /api/kpi-reports/* services.
// ══════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { FileBarChart } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useMonthSnapshots } from '@/hooks/use-kpi-queries';
import { usePageState } from '@/hooks/use-page-state';
import KpiEmployeeReportTab from './KpiEmployeeReportTab';
import KpiMonthlyTableTab from './KpiMonthlyTableTab';
import KpiSummaryTab from './KpiSummaryTab';
import ManagementReportTab from './ManagementReportTab';
import PerformanceAnalysisTab from './PerformanceAnalysisTab';
import { buildMonthOptions, currentMonthKey, formatMonth } from './kpi-reports-shared';

type TabKey = 'employee' | 'monthly' | 'mtd' | 'historical' | 'summary' | 'management' | 'performance';

export default function KpiReportsPage() {
  // Phase 6.3 (§8/§38/§39/§50): the reporting work context — active tab
  // + selected period — persists per user across navigation.
  const [kpiReportsView, setKpiReportsView] = usePageState<{
    tab: TabKey;
    month: string;
  }>({
    page: 'kpiReports',
    slot: 'view',
    version: 1,
    initial: () => ({ tab: 'monthly', month: currentMonthKey() }),
    validate: (raw) =>
      raw && typeof raw === 'object'
      && typeof (raw as { tab?: unknown }).tab === 'string'
      && typeof (raw as { month?: unknown }).month === 'string'
        ? (raw as { tab: TabKey; month: string })
        : null,
  });
  const tab = kpiReportsView.tab;
  const setTab = (v: TabKey) => setKpiReportsView((s) => ({ ...s, tab: v }));
  const month = kpiReportsView.month;
  const setMonth = (v: string) => setKpiReportsView((s) => ({ ...s, month: v }));
  const snapshotsQuery = useMonthSnapshots();

  const monthOptions = useMemo(
    () => buildMonthOptions(snapshotsQuery.data as Array<{ monthKey: string; status: 'open' | 'closed' }> | undefined),
    [snapshotsQuery.data],
  );

  // Keep the selector valid when options load/refresh.
  const effectiveMonth = monthOptions.some((o) => o.value === month)
    ? month
    : monthOptions[0]?.value ?? month;

  return (
    <div className="space-y-5 p-1">
      {/* ── Page header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <FileBarChart className="h-6 w-6 text-emerald-400" />
            تقارير KPI
          </h1>
          <p className="text-sm text-slate-400">
            تقارير جودة KPI فوق إطار مؤشرات الأداء القابل للتهيئة — درجة خام ووزن ومساهمة، مع تمييز واضح بين MTD والقيم المجمّدة.
          </p>
        </div>
        <div className="no-print space-y-1.5 min-w-[190px]">
          <Label className="text-xs">فترة التقرير</Label>
          <p className="text-[11px] text-slate-500">
            الفترة الحالية: {formatMonth(effectiveMonth)}
            {monthOptions.find((o) => o.value === effectiveMonth)?.closed ? ' — شهر مغلق (FINALIZED)' : ' — شهر مفتوح'}
          </p>
          <Select value={effectiveMonth} onValueChange={setMonth}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="space-y-4">
        <TabsList className="no-print bg-slate-800/50 flex-wrap h-auto">
          <TabsTrigger value="monthly">الشهري</TabsTrigger>
          <TabsTrigger value="mtd">MTD</TabsTrigger>
          <TabsTrigger value="historical">التاريخي</TabsTrigger>
          <TabsTrigger value="employee">الموظف</TabsTrigger>
          <TabsTrigger value="summary">الملخص الإداري</TabsTrigger>
          <TabsTrigger value="management">التقرير الإداري الشامل</TabsTrigger>
          <TabsTrigger value="performance">تحليل الأداء</TabsTrigger>
        </TabsList>

        <TabsContent value="monthly">
          <KpiMonthlyTableTab kind="monthly" month={effectiveMonth} />
        </TabsContent>
        <TabsContent value="mtd">
          <KpiMonthlyTableTab kind="mtd" month={effectiveMonth} />
        </TabsContent>
        <TabsContent value="historical">
          <KpiMonthlyTableTab kind="historical" month={effectiveMonth} />
        </TabsContent>
        <TabsContent value="employee">
          <KpiEmployeeReportTab month={effectiveMonth} />
        </TabsContent>
        <TabsContent value="summary">
          <KpiSummaryTab month={effectiveMonth} />
        </TabsContent>
        <TabsContent value="management">
          <ManagementReportTab month={effectiveMonth} />
        </TabsContent>
        <TabsContent value="performance">
          <PerformanceAnalysisTab month={effectiveMonth} />
        </TabsContent>
      </Tabs>

      {!snapshotsQuery.isLoading && monthOptions.length === 0 && (
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-6 text-sm text-slate-400">
            لا توجد فترات متاحة بعد — تُضاف الأشهر تلقائيًا بعد أول إغلاق شهر.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
