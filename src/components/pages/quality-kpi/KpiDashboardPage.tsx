'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Gauge, Users, ArrowDownCircle, ArrowUpCircle, Clock, Trophy,
  TrendingDown, AlertCircle, BarChart3, Activity,
} from 'lucide-react';
import { ScoreRing, ScoreBadge, TrendArrow, RankMedal } from '@/components/shared/kpi';
import {
  useKpiDashboard, useObservationCategories,
} from '@/hooks/use-kpi-queries';
import type {
  KpiRangePreset, TrendResult, RankedEmployee, PerformanceFactor,
} from '@/types/quality-kpi';

// ─── Types matching the dashboard API response ────────────────
interface DashboardResponse {
  range: KpiRangePreset;
  months: string[];
  avgScore: number;
  totalEmployees: number;
  totalDeductions: number;
  totalBonuses: number;
  trend: TrendResult;
  topEmployees: RankedEmployee[];
  bottomEmployees: RankedEmployee[];
  pendingApprovals: number;
  categoryDistribution: Record<string, number>;
  performanceFactor: PerformanceFactor;
  settings: {
    defaultScore: number;
    minimumScore: number;
    allowBonus: boolean;
    maximumBonus: number;
  };
}

interface CategoryLike {
  id: string;
  name: string;
  color?: string;
}

// ─── Range options ────────────────────────────────────────────
const RANGE_OPTIONS: { value: KpiRangePreset; label: string }[] = [
  { value: 'current_month', label: 'الشهر الحالي' },
  { value: 'previous_month', label: 'الشهر السابق' },
  { value: 'last_3_months', label: 'آخر 3 أشهر' },
  { value: 'last_6_months', label: 'آخر 6 أشهر' },
  { value: 'current_year', label: 'السنة الحالية' },
];

const MONTH_LABELS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function formatMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  const idx = parseInt(m, 10) - 1;
  if (idx < 0 || idx > 11) return monthKey;
  return `${MONTH_LABELS_AR[idx]} ${y}`;
}

// ─── Stat card ────────────────────────────────────────────────
function StatCard({
  icon: Icon, label, value, accent, hint,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  accent: string;
  hint?: string;
}) {
  return (
    <Card className="bg-slate-800/30 border-slate-700/40">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`size-10 rounded-lg flex items-center justify-center shrink-0 ${accent}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-400 truncate">{label}</p>
          <p className="text-xl font-bold text-slate-100 tabular-nums">{value}</p>
          {hint && <p className="text-[11px] text-slate-500 truncate">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Leaderboard row ──────────────────────────────────────────
function LeaderRow({ emp, rank }: { emp: RankedEmployee; rank: number }) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800/50 transition-colors cursor-pointer"
      onClick={() => navigateTo('employee360', undefined, { employeeId: emp.employeeId })}
    >
      <div className="w-7 flex justify-center shrink-0">
        <RankMedal rank={rank} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-100 truncate">{emp.employeeName}</p>
        <p className="text-xs text-slate-400 truncate">{emp.department}</p>
      </div>
      <ScoreBadge score={emp.score} />
    </div>
  );
}

// ─── Category distribution bar ────────────────────────────────
function CategoryBar({ name, points, maxPoints, color }: {
  name: string;
  points: number;
  maxPoints: number;
  color: string;
}) {
  const pct = maxPoints > 0 ? Math.min(100, (points / maxPoints) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-300 truncate">{name}</span>
        <span className="text-slate-400 tabular-nums shrink-0">{points}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-700/50 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function KpiDashboardPage() {
  const { canView } = usePermissions('kpiDashboard');
  const [range, setRange] = useState<KpiRangePreset>('current_month');

  const { data, isLoading, isFetching, refetch } = useKpiDashboard({ range });
  const { data: categoriesData } = useObservationCategories();

  const dashboard = (data ?? {}) as Partial<DashboardResponse>;
  const categories = (Array.isArray(categoriesData) ? categoriesData : []) as CategoryLike[];

  // Build categoryId → name/color map for the distribution chart.
  const categoryMap = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    for (const c of categories) {
      m.set(c.id, { name: c.name, color: c.color || '#3b82f6' });
    }
    return m;
  }, [categories]);

  // Sorted category distribution (desc by points).
  const sortedCategories = useMemo(() => {
    const dist = dashboard.categoryDistribution ?? {};
    return Object.entries(dist)
      .map(([id, points]) => ({
        id,
        name: categoryMap.get(id)?.name ?? 'غير مصنف',
        color: categoryMap.get(id)?.color ?? '#64748b',
        points,
      }))
      .sort((a, b) => b.points - a.points);
  }, [dashboard.categoryDistribution, categoryMap]);

  const maxCategoryPoints = sortedCategories.length > 0 ? sortedCategories[0].points : 0;

  const monthsLabel = useMemo(() => {
    const months = dashboard.months ?? [];
    if (months.length === 0) return '';
    if (months.length === 1) return formatMonth(months[0]);
    return `${formatMonth(months[months.length - 1])} — ${formatMonth(months[0])}`;
  }, [dashboard.months]);

  if (!canView) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p>ليس لديك صلاحية للوصول إلى هذه الصفحة</p>
      </div>
    );
  }

  // ─── Loading state ───
  if (isLoading) {
    return (
      <div dir="rtl" className="space-y-4 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const avg = dashboard.avgScore ?? 0;
  const maxScore = dashboard.settings?.defaultScore ?? 100;
  const trend = dashboard.trend;
  const hasTrend = trend && trend.sampleSize > 0;

  return (
    <div dir="rtl" className="space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Gauge className="size-6 text-blue-400" />
            لوحة مؤشرات الأداء
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {monthsLabel || 'ملخص أداء الجودة'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={(v) => setRange(v as KpiRangePreset)}>
            <SelectTrigger className="w-44 bg-slate-800/50 border-slate-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            title="تحديث"
          >
            <Activity className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={Users}
          label="الموظفون المشمولون"
          value={dashboard.totalEmployees ?? 0}
          accent="bg-blue-500/10 text-blue-400"
        />
        <StatCard
          icon={ArrowDownCircle}
          label="إجمالي الخصومات"
          value={dashboard.totalDeductions ?? 0}
          accent="bg-rose-500/10 text-rose-400"
          hint="نقطة"
        />
        <StatCard
          icon={ArrowUpCircle}
          label="إجمالي المكافآت"
          value={dashboard.totalBonuses ?? 0}
          accent="bg-emerald-500/10 text-emerald-400"
          hint={dashboard.settings?.allowBonus ? `حد أقصى ${dashboard.settings.maximumBonus}` : 'معطّل'}
        />
        <StatCard
          icon={Clock}
          label="بانتظار الاعتماد"
          value={dashboard.pendingApprovals ?? 0}
          accent="bg-amber-500/10 text-amber-400"
          hint="ملاحظة"
        />
      </div>

      {/* Score + Trend row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Average score ring */}
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-5 flex flex-col items-center justify-center text-center">
            <p className="text-sm text-slate-400 mb-3">متوسط درجة الأداء</p>
            <ScoreRing score={avg} max={maxScore} size={120} />
            <p className="text-xs text-slate-500 mt-3">
              الحد الأقصى: {maxScore} · الحد الأدنى: {dashboard.settings?.minimumScore ?? 0}
            </p>
          </CardContent>
        </Card>

        {/* Trend */}
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">اتجاه الأداء</p>
              <TrendingDown className="size-4 text-slate-500" />
            </div>
            {hasTrend ? (
              <>
                <div className="flex items-center gap-3">
                  <ScoreBadge score={trend!.movingScore} />
                  <TrendArrow direction={trend!.direction} delta={trend!.momDelta} />
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-slate-500">المتوسط المتحرك</p>
                    <p className="text-slate-200 font-semibold tabular-nums">{trend!.rollingAverage}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">عدد الشهور</p>
                    <p className="text-slate-200 font-semibold tabular-nums">{trend!.sampleSize}</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <AlertCircle className="size-8 text-slate-600 mb-2" />
                <p className="text-xs text-slate-500">
                  لا توجد بيانات اتجاه بعد. يُحسب الاتجاه من الأشهر المغلقة.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Performance factor */}
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">معامل الأداء</p>
              <Badge variant="outline" className="text-blue-400 border-blue-500/30">الجودة</Badge>
            </div>
            <div>
              <p className="text-3xl font-bold text-slate-100 tabular-nums">
                {dashboard.performanceFactor
                  ? Math.round((dashboard.performanceFactor.normalized ?? 0) * 100)
                  : 0}
                <span className="text-base text-slate-400">%</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">النسبة المعيارية من الحد الأقصى</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Leaderboards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top employees */}
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 px-1 pb-2 border-b border-slate-700/40">
              <Trophy className="size-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-slate-200">الأعلى أداءً</h3>
            </div>
            {(dashboard.topEmployees ?? []).length > 0 ? (
              <motion.div
                initial="hidden"
                animate="show"
                variants={{ show: { transition: { staggerChildren: 0.04 } } }}
                className="space-y-1"
              >
                {(dashboard.topEmployees ?? []).slice(0, 10).map((emp, i) => (
                  <motion.div
                    key={emp.employeeId}
                    variants={{ hidden: { opacity: 0, x: 10 }, show: { opacity: 1, x: 0 } }}
                  >
                    <LeaderRow emp={emp} rank={i + 1} />
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <EmptyLeaderboard label="لا يوجد موظفون في هذه الفترة. تظهر القائمة بعد إغلاق الشهر." />
            )}
          </CardContent>
        </Card>

        {/* Bottom employees */}
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 px-1 pb-2 border-b border-slate-700/40">
              <TrendingDown className="size-4 text-rose-400" />
              <h3 className="text-sm font-semibold text-slate-200">يحتاجون تحسيناً</h3>
            </div>
            {(dashboard.bottomEmployees ?? []).length > 0 ? (
              <div className="space-y-1">
                {(dashboard.bottomEmployees ?? []).slice(0, 10).map((emp) => (
                  <LeaderRow key={emp.employeeId} emp={emp} rank={emp.rank} />
                ))}
              </div>
            ) : (
              <EmptyLeaderboard label="لا توجد بيانات. تظهر القائمة بعد إغلاق الشهر." />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Category distribution */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 px-1">
            <BarChart3 className="size-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-200">توزيع الملاحظات حسب الفئة</h3>
          </div>
          {sortedCategories.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
              {sortedCategories.map((cat) => (
                <CategoryBar
                  key={cat.id}
                  name={cat.name}
                  points={cat.points}
                  maxPoints={maxCategoryPoints}
                  color={cat.color}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <BarChart3 className="size-8 text-slate-600 mb-2" />
              <p className="text-xs text-slate-500">لا توجد ملاحظات معتمدة في هذه الفترة</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyLeaderboard({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Trophy className="size-8 text-slate-600 mb-2" />
      <p className="text-xs text-slate-500 max-w-xs">{label}</p>
    </div>
  );
}
