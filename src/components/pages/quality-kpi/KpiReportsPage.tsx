'use client';

// ══════════════════════════════════════════════════════════════
//  KPI Reports Page — Quality KPI Reporting Layer (Phase 2 + §10)
//
//  §10 TAB AUDIT RESULT (was 7 tabs, several functionally duplicated):
//    • الشهري / MTD / التاريخي were THREE tabs over ONE component and
//      ONE runner differing only in value basis → merged into ONE
//      "جدول الأداء" tab with an explicit basis switcher (شهري · MTD ·
//      تاريخي) — the basis banners still label the data's nature.
//    • الملخص الإداري (quality-only statistics) and التقرير الإداري
//      الشامل (quality KPI + cross-domain operational counts) kept
//      SEPARATE: different questions — "كيف أداء الجودة؟" vs
//      "كيف الأداء التشغيلي عبر كل المجالات؟". Both are labeled.
//    Each tab carries a one-line PURPOSE so a business user knows
//    what question it answers before opening it.
//  The reporting work context (tab · month · basis) persists per user.
// ══════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { FileBarChart } from 'lucide-react';
import { PageIdentity } from '@/components/shared/PageIdentity';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useMonthSnapshots } from '@/hooks/use-kpi-queries';
import { usePageState } from '@/hooks/use-page-state';
import KpiEmployeeReportTab from './KpiEmployeeReportTab';
import KpiMonthlyTableTab, { type TableTabKind } from './KpiMonthlyTableTab';
import KpiSummaryTab from './KpiSummaryTab';
import ManagementReportTab from './ManagementReportTab';
import PerformanceAnalysisTab from './PerformanceAnalysisTab';
import { buildMonthOptions, currentMonthKey, formatMonth } from './kpi-reports-shared';

type TabKey = 'table' | 'employee' | 'summary' | 'management' | 'performance';
/** Legacy tab values (pre-§10) map onto the merged table tab. */
type LegacyTabKey = 'monthly' | 'mtd' | 'historical' | TabKey;
type BasisKind = TableTabKind;

const TAB_PURPOSE: Record<TabKey, string> = {
  table: 'جدول أداء الجودة لكل موظف في الشهر — الدرجة الخام والوزن والمساهمة وحالة التقرير.',
  employee: 'ملف أداء موظف واحد في الشهر: المكونات والأدلة والاتجاه — يفتح من اختيار موظف.',
  summary: 'إحصائيات جودة الفترة: كم موظفاً متاحاً/معلقاً/غير مكتمل، المتوسطات، وأفضل وأدنى درجة.',
  management: 'التقرير الإداري الشامل: ملخص الجودة + أعداد تشغيلية (شكاوى، كابا، متابعات، خصومات HR) لكل قسم.',
  performance: 'تحليل الأداء بالوقائع: ما حدث فعلاً لكل موظف خلال الفترة (سجلات، حالات، أدلة).',
};

const BASIS_OPTIONS: Array<{ value: BasisKind; label: string; hint: string }> = [
  { value: 'monthly', label: 'الشهري', hint: 'قيمة الشهر حسب أساس الحساب الحالي' },
  { value: 'mtd', label: 'MTD', hint: 'حساب حي حتى تاريخه من بيانات الجودة الحالية' },
  { value: 'historical', label: 'تاريخي', hint: 'القيم المجمّدة من لقطة إغلاق الشهر' },
];

function normalizeView(raw: { tab?: unknown; month?: unknown; basis?: unknown } | null): {
  tab: TabKey;
  month: string;
  basis: BasisKind;
} | null {
  if (!raw || typeof raw !== 'object' || typeof raw.month !== 'string') return null;
  const tabRaw = raw.tab as string | undefined;
  let tab: TabKey = 'table';
  let basis: BasisKind = 'monthly';
  if (tabRaw === 'monthly' || tabRaw === 'mtd' || tabRaw === 'historical') {
    // Legacy 3-tab values → merged table tab with the matching basis.
    basis = tabRaw;
  } else if (tabRaw === 'employee' || tabRaw === 'summary' || tabRaw === 'management' || tabRaw === 'performance') {
    tab = tabRaw;
  }
  if (typeof raw.basis === 'string' && (raw.basis === 'monthly' || raw.basis === 'mtd' || raw.basis === 'historical')) {
    basis = raw.basis;
  }
  return { tab, month: raw.month, basis };
}

export default function KpiReportsPage() {
  // Phase 6.3 (§8/§38/§39/§50): the reporting work context — active tab
  // + selected period + table basis — persists per user across navigation.
  const [kpiReportsView, setKpiReportsView] = usePageState<{
    tab: TabKey;
    month: string;
    basis: BasisKind;
  }>({
    page: 'kpiReports',
    slot: 'view',
    version: 2,
    initial: () => ({ tab: 'table', month: currentMonthKey(), basis: 'monthly' }),
    validate: (raw) => normalizeView(raw as { tab?: unknown; month?: unknown; basis?: unknown } | null),
  });
  const tab = kpiReportsView.tab;
  const setTab = (v: TabKey) => setKpiReportsView((s) => ({ ...s, tab: v }));
  const month = kpiReportsView.month;
  const setMonth = (v: string) => setKpiReportsView((s) => ({ ...s, month: v }));
  const basis = kpiReportsView.basis;
  const setBasis = (v: BasisKind) => setKpiReportsView((s) => ({ ...s, basis: v }));
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
      {/* ── §7 unified page identity ── */}
      <PageIdentity
        pageId="kpiReports"
        icon={<FileBarChart className="size-5" />}
        iconClassName="bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
        description={
          <>
            تقارير جودة KPI فوق إطار مؤشرات الأداء القابل للتهيئة — مع تمييز واضح بين MTD والقيم المجمّدة.
            <span className="block text-[11px] text-slate-500 mt-0.5 no-print">
              الفترة الحالية: {formatMonth(effectiveMonth)}
              {monthOptions.find((o) => o.value === effectiveMonth)?.closed ? ' — شهر مغلق (FINALIZED)' : ' — شهر مفتوح'}
            </span>
          </>
        }
        actions={
          <div className="no-print">
            <Select value={effectiveMonth} onValueChange={setMonth}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {monthOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="space-y-4">
        <TabsList className="no-print bg-slate-800/50 flex-wrap h-auto">
          <TabsTrigger value="table">جدول الأداء</TabsTrigger>
          <TabsTrigger value="employee">أداء الموظف</TabsTrigger>
          <TabsTrigger value="summary">ملخص الجودة</TabsTrigger>
          <TabsTrigger value="management">التقرير الإداري الشامل</TabsTrigger>
          <TabsTrigger value="performance">تحليل الأداء</TabsTrigger>
        </TabsList>

        {/* §10 — every tab states its purpose up-front */}
        <p className="no-print text-[11px] text-slate-500 -mt-2 px-1">{TAB_PURPOSE[tab]}</p>

        <TabsContent value="table" className="space-y-3">
          {/* §16 — Period + Month TOGETHER: the basis switcher (the former
              3 duplicated tabs) sits in the same filter row as the month
              selector, so Report → Period → Month reads as one unit. */}
          <div className="no-print flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 rounded-xl border border-slate-700/60 bg-slate-950/40 p-1 w-fit">
              {BASIS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  title={opt.hint}
                  onClick={() => setBasis(opt.value)}
                  className={`px-4 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                    basis === opt.value
                      ? 'bg-brand-500/20 text-brand-200'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <Select value={effectiveMonth} onValueChange={setMonth}>
              <SelectTrigger className="h-8 w-44 text-xs bg-slate-900/60 border-slate-700/60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[10px] text-slate-500">
              {monthOptions.find((o) => o.value === effectiveMonth)?.closed ? 'شهر مغلق (FINALIZED)' : 'شهر مفتوح'}
            </span>
          </div>
          <KpiMonthlyTableTab kind={basis} month={effectiveMonth} />
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
